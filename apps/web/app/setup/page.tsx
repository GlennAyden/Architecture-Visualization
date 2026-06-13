'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { BrandMark } from '@/components/brand-mark';
import { useLocalAuth } from '@/components/auth/local-auth-provider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function SetupPage() {
  const router = useRouter();
  const { isLoading, setupRequired, user, refresh } = useLocalAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (isLoading) return;
    if (user) router.replace('/projects');
    else if (!setupRequired) router.replace('/sign-in');
  }, [isLoading, router, setupRequired, user]);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    if (password !== confirmPassword) {
      setError('Password confirmation does not match');
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch('/api/auth/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(data.error ?? 'Setup failed');
        return;
      }
      await refresh();
      router.replace('/projects');
    } catch {
      setError('Setup failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="dark flex min-h-screen items-center justify-center bg-zinc-950 px-6 py-10 text-zinc-100">
      <div className="w-full max-w-sm rounded-lg border border-white/10 bg-zinc-900/70 p-6 shadow-2xl shadow-black/30">
        <div className="mb-6 space-y-2">
          <BrandMark className="text-zinc-100" />
          <h1 className="text-xl font-semibold tracking-tight">Setup admin lokal</h1>
          <p className="text-sm text-zinc-400">Buat akun pertama untuk membuka Arch Viz.</p>
        </div>

        <form className="space-y-4" onSubmit={onSubmit}>
          <div className="grid gap-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              required
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              required
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="confirm-password">Confirm password</Label>
            <Input
              id="confirm-password"
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              autoComplete="new-password"
              required
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={submitting || isLoading}>
            {submitting ? 'Membuat...' : 'Create admin'}
          </Button>
        </form>
      </div>
    </main>
  );
}
