import type { MeResponse } from '@simorgh/contracts';
import Link from 'next/link';
import { logoutAction } from './actions';

export function Shell({ me, children }: { me: MeResponse; children: React.ReactNode }) {
  const can = (p: string) => me.permissions.includes(p);
  return (
    <div className="shell">
      <header className="topbar">
        <div>
          <strong>سیمرغ ERP</strong>
          <span className="muted"> · {me.tenant ? me.tenant.name : 'کنسول پلتفرم'}</span>
        </div>
        <nav>
          <Link href="/">پیشخوان</Link>
          {can('core.role.view') ? <Link href="/roles">نقش‌ها</Link> : null}
          <span className="muted">{me.user.displayName}</span>
          <form action={logoutAction}>
            <button className="link" type="submit">خروج</button>
          </form>
        </nav>
      </header>
      {children}
    </div>
  );
}
