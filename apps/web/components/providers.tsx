'use client';

import { ReactNode } from 'react';
import { ConvexProviderWithAuth, ConvexReactClient } from 'convex/react';

import { LocalAuthProvider, useConvexLocalAuth } from '@/components/auth/local-auth-provider';

const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

export function Providers({ children }: { children: ReactNode }) {
  return (
    <LocalAuthProvider>
      <ConvexProviderWithAuth client={convex} useAuth={useConvexLocalAuth}>
        {children}
      </ConvexProviderWithAuth>
    </LocalAuthProvider>
  );
}
