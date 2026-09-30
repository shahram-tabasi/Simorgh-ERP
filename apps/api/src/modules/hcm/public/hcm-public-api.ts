import { Injectable } from '@nestjs/common';
import { leaveRequests, type Tx } from '@simorgh/db';
import { and, eq, gte, inArray, lte } from 'drizzle-orm';

export interface ApprovedLeave {
  userId: string;
  kind: 'leave' | 'mission' | 'hourly';
  fromDate: string;
  toDate: string;
  fromTime: string | null;
  toTime: string | null;
  effectiveDays: number;
}

@Injectable()
export class HcmPublicApi {
  /** Approved leave of these people overlapping [from, to], inside the caller's transaction. */
  async approvedLeave(tx: Tx, userIds: string[], from: string, to: string): Promise<ApprovedLeave[]> {
    if (!userIds.length) return [];
    return tx
      .select({
        userId: leaveRequests.userId,
        kind: leaveRequests.kind,
        fromDate: leaveRequests.fromDate,
        toDate: leaveRequests.toDate,
        fromTime: leaveRequests.fromTime,
        toTime: leaveRequests.toTime,
        effectiveDays: leaveRequests.effectiveDays,
      })
      .from(leaveRequests)
      .where(
        and(
          inArray(leaveRequests.userId, userIds),
          eq(leaveRequests.status, 'approved'),
          lte(leaveRequests.fromDate, to),
          gte(leaveRequests.toDate, from),
        ),
      );
  }
}
