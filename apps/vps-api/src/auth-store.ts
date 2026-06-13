import Database from 'better-sqlite3';
import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const PASSWORD_KEY_LENGTH = 64;
const DEFAULT_SESSION_DAYS = 30;

export interface LocalUser {
  id: string;
  email: string;
  createdAt: number;
  updatedAt: number;
}

export interface LocalSession {
  token: string;
  user: LocalUser;
  expiresAt: number;
}

interface LocalUserRow {
  id: string;
  email: string;
  password_hash: string;
  created_at: number;
  updated_at: number;
}

interface LocalSessionRow {
  user_id: string;
  email: string;
  created_at: number;
  updated_at: number;
  expires_at: number;
}

interface CreateStoreOptions {
  dbPath: string;
  now?: () => number;
  sessionDays?: number;
}

interface CredentialsInput {
  email: string;
  password: string;
}

export interface LocalAuthStore {
  hasUsers(): boolean;
  createFirstUser(input: CredentialsInput): Promise<LocalUser>;
  createSession(input: CredentialsInput): Promise<LocalSession | null>;
  getSession(token: string): LocalSession | null;
  deleteSession(token: string): void;
  close(): void;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function assertEmail(email: string) {
  if (!email.includes('@') || email.length > 254) {
    throw new Error('A valid email is required');
  }
}

function assertPassword(password: string) {
  if (password.length < 8) {
    throw new Error('Password must be at least 8 characters');
  }
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('base64url');
}

function rowToUser(
  row: Pick<LocalUserRow, 'id' | 'email' | 'created_at' | 'updated_at'>,
): LocalUser {
  return {
    id: row.id,
    email: row.email,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('base64url');
  const key = (await scrypt(password, salt, PASSWORD_KEY_LENGTH)) as Buffer;
  return `scrypt:${salt}:${key.toString('base64url')}`;
}

async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const [scheme, salt, encodedKey] = storedHash.split(':');
  if (scheme !== 'scrypt' || !salt || !encodedKey) return false;
  const expected = Buffer.from(encodedKey, 'base64url');
  const actual = (await scrypt(password, salt, expected.length)) as Buffer;
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function createLocalAuthStore({
  dbPath,
  now = () => Date.now(),
  sessionDays = DEFAULT_SESSION_DAYS,
}: CreateStoreOptions): LocalAuthStore {
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  db.exec(`
    create table if not exists local_users (
      id text primary key,
      email text unique not null,
      password_hash text not null,
      created_at integer not null,
      updated_at integer not null
    );

    create table if not exists local_sessions (
      token_hash text primary key,
      user_id text not null,
      expires_at integer not null,
      created_at integer not null,
      last_seen_at integer,
      foreign key(user_id) references local_users(id) on delete cascade
    );
  `);

  return {
    hasUsers() {
      const row = db.prepare('select 1 as exists_flag from local_users limit 1').get();
      return row !== undefined;
    },

    async createFirstUser({ email, password }) {
      const normalizedEmail = normalizeEmail(email);
      assertEmail(normalizedEmail);
      assertPassword(password);
      if (this.hasUsers()) throw new Error('A local user already exists');

      const timestamp = now();
      const user: LocalUserRow = {
        id: `local_${randomBytes(16).toString('base64url')}`,
        email: normalizedEmail,
        password_hash: await hashPassword(password),
        created_at: timestamp,
        updated_at: timestamp,
      };

      try {
        db.prepare(
          `insert into local_users (id, email, password_hash, created_at, updated_at)
           values (@id, @email, @password_hash, @created_at, @updated_at)`,
        ).run(user);
      } catch (error) {
        if (this.hasUsers()) throw new Error('A local user already exists', { cause: error });
        throw error;
      }

      return rowToUser(user);
    },

    async createSession({ email, password }) {
      const normalizedEmail = normalizeEmail(email);
      const user = db.prepare('select * from local_users where email = ?').get(normalizedEmail) as
        | LocalUserRow
        | undefined;
      if (!user) return null;
      if (!(await verifyPassword(password, user.password_hash))) return null;

      const token = randomBytes(32).toString('base64url');
      const timestamp = now();
      const expiresAt = timestamp + sessionDays * 24 * 60 * 60 * 1000;

      db.prepare(
        `insert into local_sessions (token_hash, user_id, expires_at, created_at, last_seen_at)
         values (?, ?, ?, ?, ?)`,
      ).run(hashSessionToken(token), user.id, expiresAt, timestamp, timestamp);

      return {
        token,
        user: rowToUser(user),
        expiresAt,
      };
    },

    getSession(token) {
      const hash = hashSessionToken(token);
      const row = db
        .prepare(
          `select
             local_users.id as user_id,
             local_users.email as email,
             local_users.created_at as created_at,
             local_users.updated_at as updated_at,
             local_sessions.expires_at as expires_at
           from local_sessions
           join local_users on local_users.id = local_sessions.user_id
           where local_sessions.token_hash = ?`,
        )
        .get(hash) as LocalSessionRow | undefined;
      if (!row) return null;
      if (row.expires_at <= now()) {
        db.prepare('delete from local_sessions where token_hash = ?').run(hash);
        return null;
      }

      db.prepare('update local_sessions set last_seen_at = ? where token_hash = ?').run(
        now(),
        hash,
      );

      return {
        token,
        user: {
          id: row.user_id,
          email: row.email,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        },
        expiresAt: row.expires_at,
      };
    },

    deleteSession(token) {
      db.prepare('delete from local_sessions where token_hash = ?').run(hashSessionToken(token));
    },

    close() {
      db.close();
    },
  };
}
