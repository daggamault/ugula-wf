import { CLEARINGHOUSE_RECOVERED, CLEARINGHOUSE_SIGNAL, isFailing } from '@ugula/billing';
import { type Db, emitEvent, signalRuns } from '@ugula/db';
import type { RunQueueClient } from '@ugula/run-queue';
import type { PollTarget } from '../../shared/clearinghouse.ts';

export const CLEARINGHOUSE_FAILED_EVENT = 'clearinghouse.failed';

export const CLEARINGHOUSE_RECOVERED_EVENT = 'clearinghouse.recovered';

const ERROR_LENGTH = 500;

export type PollOutcome = { at: Date; error: string | null };

export type RecordHealth = (
  target: Pick<PollTarget, 'connection' | 'agencyIds'>,
  outcome: PollOutcome
) => Promise<void>;

export const createHealthRecorder =
  ({ db, boss }: { db: Db; boss: RunQueueClient }): RecordHealth =>
  async ({ connection, agencyIds }, { at, error }) => {
    if (!agencyIds?.length) return;
    const message = error === null ? null : error.slice(0, ERROR_LENGTH) || 'Unknown error';
    await db.transaction().execute(async (tx) => {
      const rows = await tx
        .selectFrom('clearinghouse_connections')
        .select(['agency_id', 'last_polled_at', 'last_error_at'])
        .where('agency_id', 'in', agencyIds)
        .orderBy('agency_id')
        .forUpdate()
        .execute();
      if (!rows.length) return;
      await tx
        .updateTable('clearinghouse_connections')
        .set(message === null ? { last_polled_at: at } : { last_error: message, last_error_at: at })
        .where(
          'agency_id',
          'in',
          rows.map((r) => r.agency_id)
        )
        .execute();
      for (const r of rows) {
        const failed = isFailing({ lastPolledAt: r.last_polled_at, lastErrorAt: r.last_error_at });
        if (failed === (message !== null)) continue;
        const agencyId = r.agency_id;
        if (message !== null) {
          await emitEvent(tx, {
            agencyId,
            type: CLEARINGHOUSE_FAILED_EVENT,
            payload: { connection, error: message }
          });
          continue;
        }
        await emitEvent(tx, {
          agencyId,
          type: CLEARINGHOUSE_RECOVERED_EVENT,
          payload: { connection }
        });
        await signalRuns(tx, boss, {
          agencyId,
          name: CLEARINGHOUSE_SIGNAL,
          keys: [CLEARINGHOUSE_RECOVERED],
          payload: { connection }
        });
      }
    });
  };
