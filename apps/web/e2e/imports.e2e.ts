import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import {
  claimState,
  draftClaim,
  fileClaim,
  reviewed,
  step,
  uploadEncounters,
  workTask,
  workUntil
} from './shared/claims.ts';
import { expectClaim, lineCodes } from './shared/expect.ts';
import {
  api,
  go,
  rowWith,
  type Session,
  SUITE_MS,
  signIn,
  uniqueId,
  until
} from './shared/session.ts';

const batch = uniqueId('E2E-IMP');
const revised = uniqueId('E2E-IMP');
const kept = uniqueId('E2E-IMP');

let s: Session;

const claimsFor = async (pcr: string) =>
  (
    await api<{ items: { id: string }[] }>(
      s,
      `/api/claims?number=${encodeURIComponent(pcr)}&status=all`
    )
  ).items;

describe('imports split files into reports and revise claims', { timeout: SUITE_MS }, () => {
  before(async () => {
    s = await signIn();
    await uploadEncounters(s, batch, 'batch-three-reports');
    await uploadEncounters(s, revised, 'bls-emergency-commercial');
    await uploadEncounters(s, kept, 'bls-emergency-commercial');
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
    for (const n of [1, 2, 3]) await rowWith(s.page, `${batch}-${n}`).first().waitFor();
  });

  it('works each report in the file by its own classification and files the billable ones', async () => {
    const transported = await reviewed(s, await draftClaim(s, `${batch}-1`));
    expectClaim(transported, {
      classification: 'emergency',
      level: 'BLS',
      emergency: true,
      lines: [
        ['A0429', 1],
        ['A0425', 8.3]
      ],
      originDestination: 'SH'
    });
    assert.deepEqual(lineCodes((await fileClaim(s, transported.claim.id)).file), [
      'HC:A0429:SH',
      'HC:A0425:SH'
    ]);
    await workUntil(
      s,
      await draftClaim(s, `${batch}-2`),
      [step('Confirm Not Billable', 'Skip Claim')],
      'void'
    );
    const treated = await reviewed(s, await draftClaim(s, `${batch}-3`));
    expectClaim(treated, {
      classification: 'treatNoTransport',
      level: 'ALS1',
      emergency: true,
      lines: [['A0998', 1]]
    });
    assert.deepEqual(lineCodes((await fileClaim(s, treated.claim.id)).file), ['HC:A0998:GY']);
  });

  it('turns a corrected report into a revision of its claim and files the rebuilt claim', async () => {
    const claimId = await draftClaim(s, revised);
    const first = await reviewed(s, claimId);
    assert.deepEqual(
      first.claim.lines.map((l) => [l.code, Number(l.units)]),
      [
        ['A0429', 1],
        ['A0425', 8.3]
      ]
    );
    await uploadEncounters(s, revised, 'bls-emergency-commercial-corrected');
    await workTask(
      s,
      claimId,
      step('Review updated PCR', 'Apply Update', async (d) => {
        await d.page().getByText('Destination odometer').first().waitFor();
      }),
      ['Review claim']
    );
    const rebuilt = await reviewed(s, claimId);
    assert.equal(rebuilt.claim.id, claimId, 'the revision reworks the same claim');
    expectClaim(rebuilt, {
      classification: 'emergency',
      level: 'BLS',
      emergency: true,
      lines: [
        ['A0429', 1],
        ['A0425', 10.1]
      ],
      originDestination: 'SH'
    });
    assert.equal(
      (await claimsFor(revised)).length,
      1,
      'a corrected report never opens a second claim'
    );
    const { file } = await fileClaim(s, claimId);
    assert.match(file, /SV1\*HC:A0425:SH\*[\d.]+\*UN\*10\.1\*/);
    assert.match(file, /CR1\*{3,4}A\*DH\*10\.1~/);
  });

  it('keeps the claim as it is when a biller acknowledges a corrected report without applying it', async () => {
    const claimId = await draftClaim(s, kept);
    await reviewed(s, claimId);
    await uploadEncounters(s, kept, 'bls-emergency-commercial-corrected');
    await workTask(s, claimId, step('Review updated PCR', 'Acknowledge'), ['Review claim']);
    const { claim } = await claimState(s, claimId);
    assert.equal(claim.status, 'needs_review');
    assert.equal(Number(claim.lines[1]?.units), 8.3);
    assert.equal((await claimsFor(kept)).length, 1);
    assert.match((await fileClaim(s, claimId)).file, /SV1\*HC:A0425:SH\*[\d.]+\*UN\*8\.3\*/);
  });
});
