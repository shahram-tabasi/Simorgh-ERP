import { Injectable } from '@nestjs/common';
import type { Tx } from '@simorgh/db';
import type { TenantContext } from '../http/context.js';
import { WorkflowBody, type WorkflowDefinition } from './definitions.js';

export type WorkflowOutcome = 'approved' | 'rejected' | 'cancelled';

export interface WorkflowCompletion {
  instanceId: string;
  docType: string;
  docId: string;
  outcome: WorkflowOutcome;
  /** Who made the final decision (or cancelled). */
  actorUserId: string;
  comment: string | null;
}

/** Runs inside the deciding transaction: the document changes with the decision or not at all. */
export type CompletionHandler = (tx: Tx, ctx: TenantContext, done: WorkflowCompletion) => Promise<void>;

/**
 * Definitions shipped in code and the document handlers behind them. A
 * module registers its flow at start-up; the kernel never imports modules.
 */
@Injectable()
export class WorkflowRegistry {
  private readonly defs = new Map<string, WorkflowDefinition>();
  private readonly handlers = new Map<string, CompletionHandler>();

  register(def: WorkflowDefinition, onComplete: CompletionHandler): void {
    WorkflowBody.parse(def);
    if (this.defs.has(def.key)) throw new Error(`workflow ${def.key} registered twice`);
    this.defs.set(def.key, def);
    this.handlers.set(def.docType, onComplete);
  }

  definition(key: string): WorkflowDefinition {
    const def = this.defs.get(key);
    if (!def) throw new Error(`unknown workflow ${key}`);
    return def;
  }

  handler(docType: string): CompletionHandler | undefined {
    return this.handlers.get(docType);
  }
}
