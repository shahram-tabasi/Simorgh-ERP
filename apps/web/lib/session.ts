import 'server-only';
import type { TokenPair } from '@simorgh/contracts';
import { cookies } from 'next/headers';

// The browser holds the tokens only as httpOnly cookies: page scripts never
// see them. The refresh token is sent only to /session, where it is used.
export const ACCESS_COOKIE = 'sim_at';
export const REFRESH_COOKIE = 'sim_rt';
// Secure cookies need HTTPS (or localhost). An on-prem install served over
// plain HTTP inside a LAN sets COOKIE_SECURE=false — and should get TLS soon.
const secure = (process.env.COOKIE_SECURE ?? (process.env.NODE_ENV === 'production' ? 'true' : 'false')) === 'true';

export async function storeSession(pair: TokenPair): Promise<void> {
  const jar = await cookies();
  jar.set(ACCESS_COOKIE, pair.accessToken, { httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: pair.expiresIn });
  jar.set(REFRESH_COOKIE, pair.refreshToken, { httpOnly: true, sameSite: 'strict', secure, path: '/session', maxAge: 30 * 86_400 });
}

export async function clearSession(): Promise<void> {
  const jar = await cookies();
  jar.delete(ACCESS_COOKIE);
  jar.set(REFRESH_COOKIE, '', { path: '/session', maxAge: 0 });
}

export async function accessToken(): Promise<string | undefined> {
  return (await cookies()).get(ACCESS_COOKIE)?.value;
}
