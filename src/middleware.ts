import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { agentForKey, presentedKey } from '@/lib/agent-auth';

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Agent API: authorized ONLY by a per-agent key (AGENT_API_KEYS), nothing else. This runs before the dev bypass
  // so local dev exercises the same path, and it stamps the verified agent id over anything the client sent.
  if (pathname.startsWith('/api/agent/')) {
    const agent = agentForKey(process.env.AGENT_API_KEYS, presentedKey(request.headers));
    if (!agent) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const headers = new Headers(request.headers);
    headers.set('x-agent-id', agent);
    return NextResponse.next({ request: { headers } });
  }

  // DEV-ONLY local bypass (never active on Vercel preview/prod builds).
  if (process.env.NODE_ENV === 'development') {
    return NextResponse.next();
  }

  // Skip auth for NextAuth routes, assets, and the login page
  if (
    pathname.startsWith('/api/auth/') ||
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/favicon.ico') ||
    pathname === '/login'
  ) {
    return NextResponse.next();
  }

  // Allow internal agent calls with shared secret
  const internalSecret = request.headers.get('x-internal-secret');
  if (internalSecret && internalSecret === process.env.INTERNAL_API_SECRET) {
    return NextResponse.next();
  }

  // Check NextAuth JWT session
  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
  if (!token) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.redirect(new URL('/login', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
