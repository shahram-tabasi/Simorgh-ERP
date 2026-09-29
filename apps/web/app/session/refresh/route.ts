import type { TokenPair } from '@simorgh/contracts';
import { cookies } from 'next/headers';
import type { NextRequest } from 'next/server';
import { publicApi } from '../../../lib/api';
import { clearSession, REFRESH_COOKIE, storeSession } from '../../../lib/session';

// A relative Location keeps the browser on the origin it used. Building an
// absolute URL from req.url would use the server's bind address (0.0.0.0, or
// the internal host behind a reverse proxy) and strand the session cookies there.
function redirectTo(path: string): Response {
  return new Response(null, { status: 303, headers: { location: path, 'cache-control': 'no-store' } });
}

/** Exchanges the refresh cookie for a new session, then returns to `next`. */
export async function GET(req: NextRequest) {
  const next = req.nextUrl.searchParams.get('next') ?? '/';
  const safeNext = next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') ? next : '/';
  const refreshToken = (await cookies()).get(REFRESH_COOKIE)?.value;

  if (refreshToken) {
    const res = await publicApi('/api/v1/auth/refresh', { refreshToken }).catch(() => null);
    if (res?.ok) {
      await storeSession((await res.json()) as TokenPair);
      return redirectTo(safeNext);
    }
  }
  await clearSession();
  return redirectTo('/login');
}
