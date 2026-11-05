import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { expectClaim } from './shared/expect.ts';
import {
  api,
  claimStatusIs,
  completeTask,
  draftClaim,
  go,
  type Session,
  SUITE_MS,
  signIn,
  uniqueId,
  until,
  uploadEncounters,
  workTasksUntil
} from './shared/session.ts';

const batch = uniqueId('E2E-IMP');
const revised = uniqueId('E2E-IMP');

let s: Session;

describe('imports split files into reports and revise claims', { timeout: SUITE_MS }, () => {
  before(async () => {
    s = await signIn();
    await uploadEncounters(s, batch, 'batch-three-reports');
    await uploadEncounters(s, revised, 'bls-emergency-commercial');
  });

  after(async () => {
    await s?.browser.close();
  });

  it('opens one draft claim per report in a file and lists each on the import', async () => {
    const imports = await until(
      s.page,
      () =>
        api<{ items: { id: string; file_name: string; report_count: number }[] }>(
          s,
          `/api/imports?q=${encodeURIComponent(batch)}`
        ),
      (r) => r.items.some((i) => i.file_name === `${batch}.xml` && i.report_count === 3),
      'the import to count its reports'
    );
    const id = imports.items.find((i) => i.file_name === `${batch}.xml`)?.id;
    await go(s.page, `/imports/${id}`);
    for (const n of [1, 2, 3]) {
      await s.page
        .getByRole('row')
        .filter({ hasText: `${batch}-${n}` })
        .first()
        .waitFor();
    }
  });

  it('works each report in the file by its own trip type', async () => {
    const transported = await workTasksUntil(s, await draftClaim(s, `${batch}-1`), 'needs_review');
    expectClaim(transported, {
      tripType: 'emergency',
      level: 'BLS',
      emergency: true,
      lines: [
        ['A0429', 1],
        ['A0425', 8.3]
      ],
      originDestination: 'SH'
    });
    const cancelled = await draftClaim(s, `${batch}-2`);
    await completeTask(s, cancelled, 'Confirm no claim', { outcome: 'Skip' });
    await claimStatusIs(s, cancelled, 'void');
    const treated = await workTasksUntil(s, await draftClaim(s, `${batch}-3`), 'needs_review');
    expectClaim(treated, {
      tripType: 'treatNoTransport',
      level: 'ALS1',
      emergency: true,
      lines: [['A0998', 1]]
    });
  });

  it('turns a corrected report into a revision of its claim and rebuilds it on approval', async () => {
    const claimId = await draftClaim(s, revised);
    const first = await workTasksUntil(s, claimId, 'needs_review');
    assert.deepEqual(
      first.claim.lines.map((l) => [l.code, Number(l.units)]),
      [
        ['A0429', 1],
        ['A0425', 8.3]
      ]
    );
    await uploadEncounters(s, revised, 'bls-emergency-commercial-corrected');
    await completeTask(s, claimId, 'Review updated PCR', {
      outcome: 'Apply Update',
      check: async () => {
        await s.page.getByText('Destination odometer').first().waitFor();
      }
    });
    await claimStatusIs(s, claimId, 'draft');
    const rebuilt = await workTasksUntil(s, claimId, 'needs_review');
    assert.equal(rebuilt.claim.id, claimId, 'the revision reworks the same claim');
    expectClaim(rebuilt, {
      tripType: 'emergency',
      level: 'BLS',
      emergency: true,
      lines: [
        ['A0429', 1],
        ['A0425', 10.1]
      ],
      originDestination: 'SH'
    });
    const claims = await api<{ items: { id: string }[] }>(
      s,
      `/api/claims?number=${encodeURIComponent(revised)}&status=all`
    );
    assert.equal(claims.items.length, 1, 'a corrected report never opens a second claim');
  });
});
