import { Injectable } from '@nestjs/common';
import type { Tx } from '@simorgh/db';
import { sql } from 'drizzle-orm';
import { ApiError } from '../http/api-error.js';

/**
 * Document numbers (architecture §10). The counter row is locked by the
 * UPDATE inside the caller's transaction, so a rolled-back document gives its
 * number back — which is what makes a `gapless` series gapless.
 */
@Injectable()
export class NumberingService {
  async next(tx: Tx, docType: string, legalEntityId: string | null, periodKey = ''): Promise<string> {
    try {
      const res = await tx.execute<{ no: string }>(
        sql`select core.next_number(${docType}, ${legalEntityId}::uuid, ${periodKey}) as no`,
      );
      return res.rows[0]!.no;
    } catch (err) {
      // drizzle wraps the driver error; the database's message is on `cause`
      const e = err as Error & { cause?: Error };
      if (`${e.message} ${e.cause?.message ?? ''}`.includes('number series not configured')) {
        throw ApiError.badRequest('NUMBER_SERIES_MISSING', `No number series for ${docType}`);
      }
      throw err;
    }
  }
}
