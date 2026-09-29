/**
 * Event envelope published on the `erp.events` topic exchange (architecture §20).
 * The routing key is `type`.
 */
export interface EventEnvelope<T = unknown> {
  id: string;
  type: string;
  version: number;
  occurred_at: string;
  tenant_id: string;
  legal_entity_id?: string | null;
  actor: { user_id: string | null; via: 'web' | 'api' | 'agent' | 'system' | 'integration' };
  correlation_id: string | null;
  subject: { type: string; id: string; no?: string | null };
  data: T;
}

export const EVENTS_EXCHANGE = 'erp.events';

/** Events emitted by the kernel. */
export const CoreEvents = {
  tenantProvisioned: 'core.tenant.provisioned',
  memberAdded: 'core.member.added',
  roleAssigned: 'core.role.assigned',
  roleChanged: 'core.role.changed',
  attachmentStored: 'core.attachment.stored',
} as const;
