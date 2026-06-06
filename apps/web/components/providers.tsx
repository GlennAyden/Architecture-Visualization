'use client';

import { ReactNode } from 'react';
import { ClerkProvider, useAuth } from '@clerk/nextjs';
import { ConvexProviderWithClerk } from 'convex/react-clerk';
import { ConvexProvider, ConvexReactClient } from 'convex/react';

const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
const clerkDisabled = process.env.NEXT_PUBLIC_DISABLE_CLERK === 'true';

export function Providers({ children }: { children: ReactNode }) {
  if (clerkDisabled) {
    return (
      <ClerkProvider>
        <ConvexProvider client={convex}>{children}</ConvexProvider>
      </ClerkProvider>
    );
  }

  return (
    <ClerkProvider>
      <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
        {children}
      </ConvexProviderWithClerk>
    </ClerkProvider>
  );
}
