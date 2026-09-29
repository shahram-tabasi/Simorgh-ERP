import type { MeResponse, RoleSummary } from '@simorgh/contracts';
import { api } from '../../lib/api';
import { Shell } from '../Shell';

export default async function RolesPage() {
  const [me, roles] = await Promise.all([
    api<MeResponse>('/api/v1/auth/me', {}, '/roles'),
    api<RoleSummary[]>('/api/v1/core/roles', {}, '/roles'),
  ]);
  return (
    <Shell me={me}>
      <h1 style={{ fontSize: 20 }}>نقش‌ها و سطوح دسترسی</h1>
      <div className="table-wrap panel">
        <table>
          <thead>
            <tr>
              <th>نقش</th>
              <th>کلید</th>
              <th>مجوزها</th>
            </tr>
          </thead>
          <tbody>
            {roles.map((r) => (
              <tr key={r.id}>
                <td>
                  {r.name}
                  {r.isSystem ? <span className="muted"> (سیستمی)</span> : null}
                </td>
                <td dir="ltr">{r.key}</td>
                <td>
                  <div className="chips">
                    {r.permissions.map((p) => (
                      <span key={p.key} className="chip">{p.key}</span>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}
