/**
 * Event envelope published to Kafka (architecture §20). The message value is
 * this object as JSON; the key is `subject.id`; the headers repeat the fields
 * a consumer needs to route or filter without parsing the value.
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

// The module part is letters only: topic names use dots, and Kafka's metrics
// treat '.' and '_' alike, so a module name with '_' could collide with another.
const TYPE_RE = /^([a-z]+)\.[a-z_]+\.[a-z_]+$/;

/**
 * The Kafka topic an event type is published to: one topic per module,
 * `erp.<module>.events` — `core.role.changed` goes to `erp.core.events`.
 *
 * One topic per module (not per event type) keeps every event about one
 * subject in one partition, so a consumer sees a document's history in order.
 */
export function eventTopic(type: string): string {
  const m = TYPE_RE.exec(type);
  if (!m) throw new Error(`invalid event type "${type}" (expected <module>.<entity>.<verb>)`);
  return `erp.${m[1]}.events`;
}

/** Kafka header names carried by every event. */
export const EventHeaders = {
  id: 'event-id',
  type: 'event-type',
  version: 'event-version',
  tenant: 'tenant-id',
  correlation: 'correlation-id',
} as const;

/** Events emitted by the kernel. */
export const CoreEvents = {
  tenantProvisioned: 'core.tenant.provisioned',
  memberAdded: 'core.member.added',
  roleAssigned: 'core.role.assigned',
  roleChanged: 'core.role.changed',
  attachmentStored: 'core.attachment.stored',
  orgUnitChanged: 'core.org_unit.changed',
  workflowStarted: 'core.workflow.started',
  approvalRequested: 'core.approval.requested',
  workflowCompleted: 'core.workflow.completed',
  inboxItemCreated: 'core.inbox_item.created',
  taskAssigned: 'core.task.assigned',
} as const;
