'use client';

import { useQuery } from 'convex/react';
import { UserButton } from '@clerk/nextjs';
import { api } from '../../../convex/_generated/api';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export default function Home() {
  const me = useQuery(api.profiles.getMe);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <div className="absolute right-4 top-4">
        <UserButton />
      </div>
      <h1 className="text-3xl font-semibold">Architecture Visualization</h1>
      <p className="text-muted-foreground">Phase 0 setup — wiring verified.</p>
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Auth + Convex check</CardTitle>
          <CardDescription>End-to-end Clerk JWT validation through Convex.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm">
            <strong>Convex query result:</strong>{' '}
            {me === undefined ? 'loading…' : JSON.stringify(me)}
          </p>
          <Button className="mt-4" variant="outline">
            Sample Button
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
