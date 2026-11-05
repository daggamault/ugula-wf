import { posix } from 'node:path';
import {
  downloadName,
  type MockClaimState,
  readInterchange,
  type respondToClaimStatus,
  type respondToClaims,
  type respondToEligibility
} from '@ugula/billing/mock-waystar';
import type { MockFiles } from './mock-files.ts';
import { DOWNLOAD, isInboundUpload, routeUpload } from './mock-uploads.ts';

export type Responders = {
  claims: typeof respondToClaims;
  eligibility: typeof respondToEligibility;
  claimStatus: typeof respondToClaimStatus;
};

type ResponderDeps = {
  files: MockFiles;
  respond: Responders;
  now: () => Date;
  later: (run: () => void, ms: number) => void;
  log: (line: string) => void;
  remitDelayMs: number;
  eraUnenrolled: ReadonlySet<string>;
};

const PICKUP_DELAY_MS = 2000;

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const createResponder = ({
  files,
  respond,
  now,
  later,
  log,
  remitDelayMs,
  eraUnenrolled
}: ResponderDeps) => {
  const states = new Map<string, MockClaimState>();
  let seq = 0;

  const stateOf = (claimNumber: string) => states.get(claimNumber) ?? 'unknown';

  const deliver = (clientId: string, type: string, ext: string, text: string) => {
    seq += 1;
    const path = `${DOWNLOAD}/${downloadName(clientId, type, now(), seq)}${ext}`;
    files.put(path, text);
    log(`wrote ${path}`);
  };

  const answerClaims = (text: string, clientId: string, name: string) => {
    const r = respond.claims(text, now(), (payerId) => !eraUnenrolled.has(payerId));
    if (r.ta1) {
      log(`rejected ${name}: ${r.error}`);
      deliver(clientId, 'TA1', '.TA1', r.ta1);
      return;
    }
    log(
      `picked up ${name}${r.inbound ? ` (GS06 ${r.inbound.groupControlNumber}, ${r.inbound.claims.length} claims)` : ` (unreadable: ${r.error})`}`
    );
    deliver(clientId, '999', '.999', r.ack999);
    for (const n of r.accepted) states.set(n, 'accepted');
    for (const n of r.rejected) states.set(n, 'rejected');
    if (r.ack277) {
      log(
        `277CA accepted ${r.accepted.join(', ') || 'none'}; rejected ${r.rejected.join(', ') || 'none'}`
      );
      deliver(clientId, '277CA', '.277', r.ack277);
    }
    const remit = r.remit835;
    if (!remit) return;
    log(`835 due in ${remitDelayMs / 1000}s`);
    const remitted = (r.inbound?.claims ?? []).filter(
      (c) => r.accepted.includes(c.claimNumber) && !eraUnenrolled.has(c.payer?.id ?? '')
    );
    later(() => {
      deliver(clientId, 'ERA', '.835', remit);
      for (const c of remitted) states.set(c.claimNumber, 'paid');
    }, remitDelayMs);
  };

  const answerEligibility = (text: string, clientId: string, name: string) => {
    const answers = respond.eligibility(text, now());
    log(`picked up ${name} (${answers.length} inquiries)`);
    for (const a of answers) deliver(clientId, '271', '.271', a);
  };

  const answerClaimStatus = (text: string, clientId: string, name: string) => {
    deliver(clientId, 'CLAIMSTATUS', '.277', respond.claimStatus(text, now(), stateOf));
    log(`picked up ${name}`);
  };

  const answers = {
    claims: answerClaims,
    eligibility: answerEligibility,
    claimStatus: answerClaimStatus
  };

  const pickUp = (path: string) => {
    const file = files.files.get(path);
    if (!file) return;
    files.files.delete(path);
    const name = posix.basename(path);
    const text = file.data.toString('utf8');
    const route = routeUpload(name);
    if ('error' in route) return log(`rejected ${name}: ${route.error}`);
    try {
      answers[route.kind](text, readInterchange(text)?.sender || 'UNKNOWN', name);
    } catch (e) {
      log(`rejected ${name}: ${messageOf(e)}`);
    }
  };

  const received = (path: string) => {
    if (isInboundUpload(path)) later(() => pickUp(path), PICKUP_DELAY_MS);
  };

  return { received, stateOf };
};
