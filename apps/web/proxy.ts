import { NextRequest, NextResponse } from 'next/server';

const publicPrefixes = ['/sign-in', '/sign-up', '/setup', '/share', '/api/auth', '/api/hermes'];

function isPublicPath(pathname: string): boolean {
  return publicPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export default function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (isPublicPath(pathname)) return NextResponse.next();

  const cookieName = process.env.AUTH_COOKIE_NAME ?? 'arch_viz_session';
  if (req.cookies.has(cookieName)) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = '/sign-in';
  url.search = '';
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!.+\\.[\\w]+$|_next).*)', '/', '/(api|trpc)(.*)'],
};
