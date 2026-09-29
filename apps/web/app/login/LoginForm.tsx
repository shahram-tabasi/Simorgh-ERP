'use client';

import { useActionState } from 'react';
import { loginAction, type LoginState } from './actions';

export function LoginForm() {
  const [state, action, pending] = useActionState<LoginState, FormData>(loginAction, {});
  return (
    <form className="stack" action={action}>
      <label>
        کد شرکت
        <input name="tenant" dir="ltr" autoComplete="organization" placeholder="ekc" defaultValue={state.tenant} key={`t-${state.tenant}`} />
      </label>
      <label>
        ایمیل
        <input name="email" type="email" dir="ltr" autoComplete="username" required defaultValue={state.email} key={`e-${state.email}`} />
      </label>
      <label>
        گذرواژه
        <input name="password" type="password" dir="ltr" autoComplete="current-password" required />
      </label>
      {state.error ? <p className="error" role="alert">{state.error}</p> : null}
      <button type="submit" disabled={pending}>{pending ? 'در حال ورود…' : 'ورود'}</button>
    </form>
  );
}
