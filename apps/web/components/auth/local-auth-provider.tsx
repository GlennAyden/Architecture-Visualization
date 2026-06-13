'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { usePathname, useRouter } from 'next/navigation';

interface LocalAuthUser {
  id: string;
  email: string;
}

interface AuthMeResponse {
  authenticated: boolean;
  setupRequired: boolean;
  user: LocalAuthUser | null;
}

interface LocalAuthContextValue {
  isLoading: boolean;
  user: LocalAuthUser | null;
  setupRequired: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const LocalAuthContext = createContext<LocalAuthContextValue | null>(null);

function isPublicPath(pathname: string): boolean {
  return (
    pathname.startsWith('/sign-in') ||
    pathname.startsWith('/sign-up') ||
    pathname.startsWith('/setup') ||
    pathname.startsWith('/share')
  );
}

export function LocalAuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useState<LocalAuthUser | null>(null);
  const [setupRequired, setSetupRequired] = useState(false);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/auth/me', { cache: 'no-store' });
      const data = (await response.json()) as AuthMeResponse;
      setUser(data.authenticated && data.user ? data.user : null);
      setSetupRequired(Boolean(data.setupRequired));
    } catch {
      setUser(null);
      setSetupRequired(false);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (isLoading) return;
    if (user && (pathname.startsWith('/sign-in') || pathname.startsWith('/setup'))) {
      router.replace('/projects');
      return;
    }
    if (
      !user &&
      setupRequired &&
      !pathname.startsWith('/setup') &&
      !pathname.startsWith('/share')
    ) {
      router.replace('/setup');
      return;
    }
    if (!user && !setupRequired && !isPublicPath(pathname)) {
      router.replace('/sign-in');
    }
  }, [isLoading, pathname, router, setupRequired, user]);

  const logout = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    setUser(null);
    router.replace('/sign-in');
  }, [router]);

  const value = useMemo(
    () => ({
      isLoading,
      user,
      setupRequired,
      refresh,
      logout,
    }),
    [isLoading, logout, refresh, setupRequired, user],
  );

  return <LocalAuthContext.Provider value={value}>{children}</LocalAuthContext.Provider>;
}

export function useLocalAuth() {
  const value = useContext(LocalAuthContext);
  if (!value) throw new Error('useLocalAuth must be used within LocalAuthProvider');
  return value;
}

export function useConvexLocalAuth() {
  const { isLoading, user } = useLocalAuth();

  const fetchAccessToken = useCallback(async (_args?: { forceRefreshToken: boolean }) => {
    const response = await fetch('/api/auth/convex-token', { cache: 'no-store' });
    if (!response.ok) return null;
    const data = (await response.json()) as { token?: string };
    return data.token ?? null;
  }, []);

  return useMemo(
    () => ({
      isLoading,
      isAuthenticated: user !== null,
      fetchAccessToken,
    }),
    [fetchAccessToken, isLoading, user],
  );
}
