import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextFetchEvent, NextRequest, NextResponse } from 'next/server';

const isPublicRoute = createRouteMatcher(['/sign-in(.*)', '/sign-up(.*)', '/share(.*)']);
const clerkDisabled = process.env.NEXT_PUBLIC_DISABLE_CLERK === 'true';

const authProxy = clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    await auth.protect();
  }
});

export default function proxy(req: NextRequest, event: NextFetchEvent) {
  if (clerkDisabled) return NextResponse.next();
  return authProxy(req, event);
}

export const config = {
  matcher: ['/((?!.+\\.[\\w]+$|_next).*)', '/', '/(api|trpc)(.*)'],
};
