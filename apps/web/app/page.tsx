import type { MeResponse } from '@simorgh/contracts';
import { api } from '../lib/api';
import { Shell } from './Shell';

export default async function Dashboard() {
  const me = await api<MeResponse>('/api/v1/auth/me', {}, '/');
  return (
    <Shell me={me}>
      <div className="grid">
        <section className="panel">
          <h2>حساب کاربری</h2>
          <p className="muted" dir="ltr" style={{ textAlign: 'right' }}>{me.user.email}</p>
          <p>{me.tenant ? `شرکت: ${me.tenant.name} (${me.tenant.code})` : 'نشست پلتفرم (بدون شرکت)'}</p>
        </section>
        <section className="panel">
          <h2>مجوزهای شما ({me.permissions.length})</h2>
          <div className="chips">
            {me.permissions.map((p) => (
              <span key={p} className="chip">{p}</span>
            ))}
          </div>
        </section>
      </div>
    </Shell>
  );
}
