import { createHash } from 'node:crypto';
import { inTenant, createDb, createPool } from '@simorgh/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NumberingService } from '../src/kernel/numbering/numbering.service.js';
import { createTestApp, MemoryStorage, platformToken, provisionTenant, seedPlatformAdmin, type TenantFixture, type TestApp } from './harness.js';

describe('audit, outbox, numbering and attachments', () => {
  let t: TestApp;
  let acme: TenantFixture;
  let globex: TenantFixture;
  const storage = new MemoryStorage();

  beforeAll(async () => {
    t = await createTestApp({ storage });
    await seedPlatformAdmin(t);
    const pt = await platformToken(t);
    acme = await provisionTenant(t, pt, 'acme');
    globex = await provisionTenant(t, pt, 'globex');
  });
  afterAll(() => t.close());

  const outbox = async (tenantId: string) =>
    (await t.owner.query('select type, subject_type, payload from core.outbox_events where tenant_id = $1 order by occurred_at', [tenantId])).rows;

  describe('audit + outbox are written with the change, or not at all', () => {
    it('provisioning left an audit entry and a tenant.provisioned event in the new tenant', async () => {
      const audit = await t.request('GET', '/api/v1/core/audit?entityType=core.tenant', { token: acme.ownerToken });
      expect(audit.body.map((a: { action: string }) => a.action)).toContain('core.tenant.provision');
      const events = await outbox(acme.id);
      expect(events[0]).toMatchObject({ type: 'core.tenant.provisioned', subject_type: 'core.tenant' });
      expect(events[0].payload.actor.user_id).toBeTruthy();
    });

    it('a rejected change leaves neither audit nor event behind', async () => {
      const before = (await outbox(acme.id)).length;
      const body = { key: 'dup', name: 'Dup', permissions: [] };
      expect((await t.request('POST', '/api/v1/core/roles', { token: acme.ownerToken, body })).status).toBe(201);
      const again = await t.request('POST', '/api/v1/core/roles', { token: acme.ownerToken, body });
      expect(again.status).toBe(409);
      expect((await outbox(acme.id)).length).toBe(before + 1);
      const audits = await t.owner.query(`select count(*)::int n from core.audit_log where tenant_id = $1 and action = 'core.role.create'`, [acme.id]);
      expect(audits.rows[0].n).toBe(1);
    });

    it('one tenant cannot read another’s audit trail', async () => {
      const r = await t.request('GET', '/api/v1/core/audit', { token: globex.ownerToken });
      expect(r.body.every((a: { tenantId: string }) => a.tenantId === globex.id)).toBe(true);
    });
  });

  describe('document numbering', () => {
    it('hands out consecutive numbers and gives a rolled-back number back', async () => {
      const series = await t.request('POST', '/api/v1/core/number-series', {
        token: acme.ownerToken,
        body: { docType: 'sales.order', legalEntityId: acme.legalEntityId, periodKey: '1405', prefix: 'SO-1405-', gapless: true },
      });
      expect(series.status).toBe(201);

      const pool = createPool(t.db.appUrl, 2);
      const db = createDb(pool);
      const numbering = new NumberingService();
      const scope = { tenantId: acme.id, userId: acme.ownerId };
      const next = () => inTenant(db, scope, (tx) => numbering.next(tx, 'sales.order', acme.legalEntityId, '1405'));

      expect(await next()).toBe('SO-1405-000001');
      await expect(
        inTenant(db, scope, async (tx) => {
          await numbering.next(tx, 'sales.order', acme.legalEntityId, '1405');
          throw new Error('document failed to save');
        }),
      ).rejects.toThrow('document failed to save');
      expect(await next()).toBe('SO-1405-000002'); // no gap

      // another tenant has no such series, and cannot use acme's
      await expect(
        inTenant(db, { tenantId: globex.id }, (tx) => numbering.next(tx, 'sales.order', acme.legalEntityId, '1405')),
      ).rejects.toMatchObject({ code: 'NUMBER_SERIES_MISSING' });
      await pool.end();
    });
  });

  describe('attachments', () => {
    const content = Buffer.from('%PDF-1.7 fake drawing');
    const sha256 = createHash('sha256').update(content).digest('hex');
    const ownerId = '01a0ee80-0000-7000-8000-000000000001';

    it('records a pending upload, then stores it once the bytes match', async () => {
      const ticket = await t.request('POST', '/api/v1/core/attachments/uploads', {
        token: acme.ownerToken,
        body: { ownerType: 'eng.design', ownerId, fileName: 'SLD رویژن ۲.pdf', mimeType: 'application/pdf', sizeBytes: content.length, sha256 },
      });
      expect(ticket.status).toBe(201);
      const id = ticket.body.attachmentId;

      const early = await t.request('POST', `/api/v1/core/attachments/${id}/complete`, { token: acme.ownerToken });
      expect(early.body.code).toBe('UPLOAD_MISSING');

      const [{ storage_key }] = (await t.owner.query('select storage_key from core.attachments where id = $1', [id])).rows;
      expect(storage_key.startsWith(`${acme.id}/eng.design/${ownerId}/`)).toBe(true);
      storage.put(storage_key, content.length, sha256);

      const done = await t.request('POST', `/api/v1/core/attachments/${id}/complete`, { token: acme.ownerToken });
      expect(done.status).toBe(200);
      expect(done.body.status).toBe('stored');

      const list = await t.request('GET', `/api/v1/core/attachments?ownerType=eng.design&ownerId=${ownerId}`, { token: acme.ownerToken });
      expect(list.body).toHaveLength(1);
      const dl = await t.request('GET', `/api/v1/core/attachments/${id}/download`, { token: acme.ownerToken });
      expect(dl.body.url).toContain(storage_key);

      // globex cannot see or fetch it
      expect((await t.request('GET', `/api/v1/core/attachments/${id}/download`, { token: globex.ownerToken })).status).toBe(404);
      expect((await outbox(acme.id)).some((e) => e.type === 'core.attachment.stored')).toBe(true);
    });

    it('refuses to store a file that differs from what was declared', async () => {
      const ticket = await t.request('POST', '/api/v1/core/attachments/uploads', {
        token: acme.ownerToken,
        body: { ownerType: 'eng.design', ownerId, fileName: 'x.pdf', mimeType: 'application/pdf', sizeBytes: content.length, sha256 },
      });
      const [{ storage_key }] = (await t.owner.query('select storage_key from core.attachments where id = $1', [ticket.body.attachmentId])).rows;
      storage.put(storage_key, content.length + 1, sha256);
      const r = await t.request('POST', `/api/v1/core/attachments/${ticket.body.attachmentId}/complete`, { token: acme.ownerToken });
      expect(r.body.code).toBe('UPLOAD_MISMATCH');
    });
  });
});
