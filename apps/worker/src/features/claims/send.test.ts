import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseKeyring, type SftpAccount, sealSecret } from '@ugula/clearinghouse';
import { createRecordingDb } from '@ugula/db/testing';
import type { CompiledQuery } from 'kysely';
import { createClaimSender, fileNameOf } from './send.ts';

const CLAIM_ID = '0195f2a4-0000-7000-8000-000000000001';

const AGENCY = '0195f2a4-0000-7000-8000-0000000000aa';

const keyring = parseKeyring(Buffer.alloc(32, 7).toString('base64'));

const CLAIM_ROW = {
  id: CLAIM_ID,
  number: '20261001-0012',
  revision: 2,
  status: 'approved',
  service_date: '2026-10-01',
  loaded_miles: '7.4',
  transport_reason: 'A',
  condition_codes: [],
  weight_pounds: null,
  patient_first_name: 'Ada',
  patient_last_name: 'Lovelace',
  patient_birth_date: '1950-12-10',
  patient_sex: 'F',
  patient_address_line: '1 Elm St',
  patient_city: 'Dayton',
  patient_state: 'OH',
  patient_postal_code: '45402',
  pickup_name: null,
  pickup_address_line: '1 Elm St',
  pickup_city: 'Dayton',
  pickup_state: 'OH',
  pickup_postal_code: '45402',
  destination_name: 'Miami Valley Hospital',
  destination_address_line: '1 Wyoming St',
  destination_city: 'Dayton',
  destination_state: 'OH',
  destination_postal_code: '45409',
  prior_authorization: null,
  is_signature_on_file: true,
  note: null,
  diagnoses: ['R079'],
  coverages: [
    {
      payer_name: 'Medicare',
      directory_name: 'Medicare Part B',
      payer_code: 'DEMOMCR',
      claim_filing: 'MB',
      member_id: '1EG4TE5MK73',
      group_id: null,
      relationship: '18',
      insured_first_name: null,
      insured_last_name: null,
      status: 'pending',
      adjudication: null
    }
  ],
  lines: [{ code: 'A0427', modifiers: ['RH'], units: '1', total_cents: 85_000 }]
};

const PROFILE_ROW = {
  organization_name: 'Metro EMS',
  npi: '1234567893',
  tax_id: '123456789',
  address_line: '1 Main St',
  city: 'Springfield',
  state: 'IL',
  postal_code: '627011234',
  phone: '2175550100',
  submitter_id: 'SUB-01',
  receiver_id: 'WAYSTAR',
  receiver_name: null,
  is_production: false
};

const CONNECTION_ROW = {
  sftp_host: 'localhost',
  sftp_port: 2223,
  sftp_host_key: 'SHA256:mock',
  sftp_username: 'ugula',
  sftp_secret: sealSecret(keyring, 'secret', AGENCY),
  upload_path: '/upload',
  claim_extension: '.CLP'
};

type Rows = {
  status?: string;
  reserved?: object | null;
  claim?: object;
  connection?: object | null;
};

const setup = ({
  status = 'approved',
  reserved = null,
  claim = CLAIM_ROW,
  connection = CONNECTION_ROW
}: Rows = {}) => {
  const uploads: [SftpAccount, string, string][] = [];
  const { db, queries } = createRecordingDb((q: CompiledQuery) => {
    if (q.sql.startsWith('select "agency_id" from "workflow_runs"')) return [{ agency_id: AGENCY }];
    if (q.sql.startsWith('select "status", "revision" from "claims"'))
      return [{ status, revision: 2 }];
    if (q.sql.startsWith('select "id", "revision", "coverage_position"'))
      return reserved ? [reserved] : [];
    if (q.sql.includes('from "claims" as "c"')) return [claim];
    if (q.sql.includes('from "billing_profiles"')) return [PROFILE_ROW];
    if (q.sql.includes('from "clearinghouse_connections"')) return connection ? [connection] : [];
    if (q.sql.startsWith('select coalesce(max(control_number)')) return [{ next: 42 }];
    if (q.sql.startsWith('insert into "claim_submissions"')) {
      return [
        {
          id: 's-1',
          revision: q.parameters[2],
          coverage_position: q.parameters[3],
          control_number: q.parameters[4],
          file_name: q.parameters[5],
          content: q.parameters[6]
        }
      ];
    }
    return [];
  });
  const send = createClaimSender({
    db,
    keyring,
    upload: async (account, path, content) => void uploads.push([account, path, content]),
    now: () => new Date('2026-10-23T14:05:09Z')
  });
  return { send, queries, uploads };
};

describe('fileNameOf', () => {
  it('names the file by submitter and control number with no extra periods', () => {
    assert.equal(fileNameOf('SUB-01.x', 42, '.CLP'), 'SUB01x000000042.CLP');
  });
});

describe('createClaimSender', () => {
  it('builds the 837P under the next control number, uploads it and marks the claim sent', async () => {
    const { send, queries, uploads } = setup();
    assert.deepEqual(await send('r1', CLAIM_ID), {
      outcome: 'sent',
      fileName: 'SUB01000000042.CLP',
      controlNumber: 42
    });
    const [upload] = uploads;
    assert.ok(upload);
    const [account, path, content] = upload;
    assert.deepEqual(account, {
      host: 'localhost',
      port: 2223,
      hostKey: 'SHA256:mock',
      username: 'ugula',
      password: 'secret'
    });
    assert.equal(path, '/upload/SUB01000000042.CLP');
    assert.match(content, /^ISA\*/);
    assert.match(content, /CLM\*20261001-0012\*850\*/);
    assert.match(content, /ISA\*.*\*000000042\*/);
    const sql = queries.map((q) => q.sql);
    assert.ok(sql.some((q) => q.includes('pg_advisory_xact_lock')));
    const marked = queries.find((q) => q.sql.startsWith('update "claims"'));
    assert.ok(marked?.parameters.includes('submitted'));
    assert.match(marked?.sql ?? '', /"revision" = \$\d+ and "status" in \(\$\d+, \$\d+, \$\d+\)$/);
    const payer = queries.find((q) => q.sql.startsWith('update "claim_coverages"'));
    assert.deepEqual(payer?.parameters.slice(0, 2), ['sent', null]);
    assert.deepEqual(payer?.parameters.slice(-2), [CLAIM_ID, 1]);
    assert.ok(sql.some((q) => q.startsWith('update "claim_submissions" set "sent_at" = now()')));
  });

  it('bills the next payer once the first has paid, with what the first paid', async () => {
    const paid = {
      ...CLAIM_ROW.coverages[0],
      status: 'paid',
      adjudication: {
        paidCents: 60_000,
        adjustedCents: 25_000,
        paidOn: '2026-10-20',
        adjustments: [
          { group: 'CO', reason: '45', cents: 10_000 },
          { group: 'PR', reason: '2', cents: 15_000 }
        ],
        lines: []
      }
    };
    const blue = {
      ...CLAIM_ROW.coverages[0],
      payer_name: 'Blue Plan',
      directory_name: 'Blue Plan',
      payer_code: 'DEMOBCBS',
      claim_filing: 'BL',
      member_id: 'XGB1'
    };
    const { send, queries, uploads } = setup({
      status: 'submitted',
      claim: { ...CLAIM_ROW, coverages: [paid, blue] }
    });
    assert.equal((await send('r1', CLAIM_ID)).outcome, 'sent');
    const content = uploads[0]?.[2] ?? '';
    assert.match(content, /NM1\*PR\*2\*BLUE PLAN\*{5}PI\*DEMOBCBS/);
    assert.match(content, /AMT\*D\*600~/);
    const reserved = queries.find((q) => q.sql.startsWith('insert into "claim_submissions"'));
    assert.equal(reserved?.parameters[3], 2);
  });

  it('uploads the file it already built for the revision when retried, under the same number', async () => {
    const { send, queries, uploads } = setup({
      reserved: {
        id: 's-1',
        revision: 2,
        coverage_position: 1,
        control_number: 7,
        file_name: 'SUB01000000007.CLP',
        content: 'ISA*built~'
      }
    });
    assert.deepEqual(await send('r1', CLAIM_ID), {
      outcome: 'sent',
      fileName: 'SUB01000000007.CLP',
      controlNumber: 7
    });
    assert.equal(uploads[0]?.[2], 'ISA*built~');
    assert.ok(!queries.some((q) => q.sql.startsWith('insert into "claim_submissions"')));
  });

  it('sends nothing for a claim not approved, paid by the patient, not ready, or with its payer', async () => {
    const notApproved = setup({ status: 'needs_review' });
    assert.deepEqual(await notApproved.send('r1', CLAIM_ID), { outcome: 'nothingToSend' });
    const selfPay = setup({ claim: { ...CLAIM_ROW, coverages: [] } });
    assert.deepEqual(await selfPay.send('r1', CLAIM_ID), { outcome: 'selfPay' });
    const lacking = setup({ claim: { ...CLAIM_ROW, diagnoses: [] } });
    assert.deepEqual(await lacking.send('r1', CLAIM_ID), {
      outcome: 'notReady',
      issues: ['The claim has no diagnosis']
    });
    const waiting = setup({
      status: 'submitted',
      claim: { ...CLAIM_ROW, coverages: [{ ...CLAIM_ROW.coverages[0], status: 'sent' }] }
    });
    assert.deepEqual(await waiting.send('r1', CLAIM_ID), { outcome: 'nothingToSend' });
    for (const s of [notApproved, selfPay, lacking, waiting]) assert.deepEqual(s.uploads, []);
  });

  it('stops for a person to fix it when the agency has no clearinghouse connection', async () => {
    const { send, uploads } = setup({ connection: null });
    await assert.rejects(send('r1', CLAIM_ID), /no active clearinghouse connection/);
    assert.deepEqual(uploads, []);
  });

  it('refuses a claim id that is not an id', async () => {
    await assert.rejects(setup().send('r1', 'c-1'), /Claim c-1 does not exist/);
  });
});
