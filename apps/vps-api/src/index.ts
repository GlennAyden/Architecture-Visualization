import { createVpsApiServer, getPortFromEnv, loadOptionsFromEnv } from './http.js';
import { existsSync, readFileSync } from 'node:fs';

function loadEnvFile(path: string) {
  if (!existsSync(path)) return;
  const lines = readFileSync(path, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    const rawValue = trimmed.slice(separator + 1).trim();
    if (!key || process.env[key] !== undefined) continue;
    process.env[key] = rawValue.replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
  }
}

loadEnvFile('.env.local');
loadEnvFile('.env');

const port = getPortFromEnv();
const server = createVpsApiServer(loadOptionsFromEnv());

server.listen(port, '127.0.0.1', () => {
  console.log(`arch-viz-vps-api listening on 127.0.0.1:${port}`);
});
