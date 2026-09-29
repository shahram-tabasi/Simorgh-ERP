import 'server-only';
import type { Problem } from '@simorgh/contracts';
import { redirect } from 'next/navigation';
import { accessToken } from './session';

export const API_URL = process.env.API_URL ?? 'http://localhost:4000';

export class ApiProblem extends Error {
  constructor(readonly problem: Problem) {
    super(problem.title);
  }
}

/** Calls the ERP API as the signed-in user; an expired session goes through /session/refresh. */
export async function api<T>(path: string, init: RequestInit = {}, returnTo = '/'): Promise<T> {
  const token = await accessToken();
  if (!token) redirect(`/session/refresh?next=${encodeURIComponent(returnTo)}`);
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { ...init.headers, authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    cache: 'no-store',
  });
  if (res.status === 401) redirect(`/session/refresh?next=${encodeURIComponent(returnTo)}`);
  if (!res.ok) throw new ApiProblem((await res.json()) as Problem);
  return (res.status === 204 ? undefined : await res.json()) as T;
}

/** Unauthenticated call (login, refresh). */
export async function publicApi(path: string, body: unknown): Promise<Response> {
  return fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
}
