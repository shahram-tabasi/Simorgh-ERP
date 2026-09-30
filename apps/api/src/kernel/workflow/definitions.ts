import { z } from 'zod';

/**
 * Approval flow definitions (architecture §11.2): data, not code, so a tenant
 * can change who approves what without a release. Modules ship a default in
 * code; each tenant runs its own copy (core.wf_definitions).
 *
 * Supported now: serial steps, each open to anyone its assignee rules name
 * (the first decision closes the step), with optional conditions and
 * separation of duties. Parallel all/quorum steps, SLA timers and "return
 * for correction" come later without changing this shape.
 */

const Assignee = z.discriminatedUnion('kind', [
  /** Everyone holding the permission at a scope that reaches the subject. */
  z.object({ kind: z.literal('permission'), key: z.string().min(3) }),
  /** The manager of the subject's unit (or of the nearest unit above that has one). */
  z.object({ kind: z.literal('org_unit_manager') }),
  z.object({ kind: z.literal('user'), userId: z.uuid() }),
  /** Everyone holding the tenant role with this key. */
  z.object({ kind: z.literal('role'), key: z.string().min(1) }),
]);
export type AssigneeRule = z.infer<typeof Assignee>;

const Condition = z.object({
  field: z.string().min(1),
  op: z.enum(['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in']),
  value: z.unknown(),
});
export type Condition = z.infer<typeof Condition>;

const Step = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
  label: z.object({ fa: z.string(), en: z.string() }),
  assignees: z.array(Assignee).min(1),
  /** All must hold for the step to run; otherwise it is skipped. */
  when: z.array(Condition).optional(),
  /** Whoever decided these earlier steps may not decide this one. */
  sod: z.array(z.string()).optional(),
});
export type StepDef = z.infer<typeof Step>;

export const WorkflowBody = z
  .object({ steps: z.array(Step).min(1) })
  .refine((b) => new Set(b.steps.map((s) => s.id)).size === b.steps.length, 'step ids must be unique');
export type WorkflowBody = z.infer<typeof WorkflowBody>;

export interface WorkflowDefinition extends WorkflowBody {
  key: string;
  version: number;
  docType: string;
}

/** Evaluates `when` against the data the document gave the workflow. */
export function conditionsHold(when: readonly Condition[] | undefined, data: Record<string, unknown>): boolean {
  return (when ?? []).every(({ field, op, value }) => {
    const v = field.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], data);
    switch (op) {
      case 'eq':
        return v === value;
      case 'ne':
        return v !== value;
      case 'in':
        return Array.isArray(value) && value.includes(v);
      default: {
        if (typeof v !== 'number' || typeof value !== 'number') return false;
        return op === 'gt' ? v > value : op === 'gte' ? v >= value : op === 'lt' ? v < value : v <= value;
      }
    }
  });
}
