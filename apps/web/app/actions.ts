'use server';

import { redirect } from 'next/navigation';
import { API_URL } from '../lib/api';
import { accessToken, clearSession } from '../lib/session';

export async function logoutAction(): Promise<void> {
  const token = await accessToken();
  if (token) {
    await fetch(`${API_URL}/api/v1/auth/logout`, { method: 'POST', headers: { authorization: `Bearer ${token}` } }).catch(() => undefined);
  }
  await clearSession();
  redirect('/login');
}
