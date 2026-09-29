'use server';

import type { Problem, TokenPair } from '@simorgh/contracts';
import { redirect } from 'next/navigation';
import { publicApi } from '../../lib/api';
import { storeSession } from '../../lib/session';

export interface LoginState {
  error?: string;
  // React resets a form after its action runs; these put back what the person
  // typed (never the password) so a typo does not cost them the whole form.
  tenant?: string;
  email?: string;
}

const MESSAGES: Record<string, string> = {
  INVALID_CREDENTIALS: 'ایمیل، گذرواژه یا کد شرکت درست نیست.',
  ACCOUNT_LOCKED: 'به دلیل تلاش‌های ناموفق، حساب موقتاً قفل شده است. کمی بعد دوباره امتحان کنید.',
  VALIDATION_FAILED: 'لطفاً همهٔ خانه‌ها را درست پر کنید.',
};

export async function loginAction(_: LoginState, form: FormData): Promise<LoginState> {
  const tenant = String(form.get('tenant') ?? '').trim().toLowerCase();
  const body = {
    email: String(form.get('email') ?? '').trim(),
    password: String(form.get('password') ?? ''),
    ...(tenant ? { tenant } : {}),
  };
  const typed = { tenant, email: body.email };
  let res: Response;
  try {
    res = await publicApi('/api/v1/auth/login', body);
  } catch {
    return { ...typed, error: 'ارتباط با سرور برقرار نشد.' };
  }
  if (!res.ok) {
    const problem = (await res.json().catch(() => null)) as Problem | null;
    return { ...typed, error: MESSAGES[problem?.code ?? ''] ?? 'ورود ناموفق بود.' };
  }
  await storeSession((await res.json()) as TokenPair);
  redirect('/');
}
