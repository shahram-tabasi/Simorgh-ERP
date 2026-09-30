import { Global, Module } from '@nestjs/common';
import { CalendarController } from './calendar/calendar.controller.js';
import { CalendarService } from './calendar/calendar.service.js';
import { KartablController } from './inbox/inbox.controller.js';
import { InboxService } from './inbox/inbox.service.js';
import { OrgUnitsController } from './org/org.controller.js';
import { OrgService } from './org/org.service.js';
import { ScopeService } from './org/scope.service.js';
import { TasksController } from './tasks/tasks.controller.js';
import { TasksService } from './tasks/tasks.service.js';
import { WorkflowController } from './workflow/workflow.controller.js';
import { WorkflowEngine } from './workflow/workflow.engine.js';
import { WorkflowRegistry } from './workflow/workflow.registry.js';

/**
 * The kernel's collaboration layer (M2): organisation tree and data scope,
 * work calendar, approval workflows, kartabl and work tasks. Global, because
 * every business module routes approvals and reads the calendar.
 */
@Global()
@Module({
  controllers: [OrgUnitsController, CalendarController, WorkflowController, KartablController, TasksController],
  providers: [ScopeService, OrgService, CalendarService, WorkflowRegistry, WorkflowEngine, InboxService, TasksService],
  exports: [ScopeService, OrgService, CalendarService, WorkflowRegistry, WorkflowEngine],
})
export class KernelWorkModule {}
