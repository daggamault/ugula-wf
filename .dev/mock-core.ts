import type { MockClaimState } from '@ugula/billing/mock-waystar';
import { type Credentials, isBasicAuthorized } from './mock-auth.ts';
import type { Responders } from './mock-responder.ts';

export const CORE_PATH = '/core/realtime';

type CoreDeps = {
  credentials: Credentials;
  respond: Pick<Responders, 'eligibility' | 'claimStatus'>;
  stateOf: (claimNumber: string) => MockClaimState;
  now: () => Date;
  log: (line: string) => void;
};

const reply = (fields: Record<string, string>) => {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  return new Response(form);
};

const answer = async (req: Request, { respond, stateOf, now, log }: CoreDeps) => {
  const form = await req.formData();
  const field = (name: string) => String(form.get(name) ?? '');
  const base = {
    ProcessingMode: 'RealTime',
    PayloadID: field('PayloadID'),
    TimeStamp: now().toISOString(),
    SenderID: 'WAYSTAR',
    ReceiverID: field('SenderID'),
    CORERuleVersion: '2.2.0'
  };
  const answers: Record<string, [string, (x12: string) => string]> = {
    X12_270_Request_005010X279A1: [
      'X12_271_Response_005010X279A1',
      (x12) => respond.eligibility(x12, now())[0] ?? ''
    ],
    X12_276_Request_005010X212: [
      'X12_277_Response_005010X212',
      (x12) => respond.claimStatus(x12, now(), stateOf)
    ]
  };
  const handler = answers[field('PayloadType')];
  if (!handler) {
    return reply({
      ...base,
      PayloadType: 'CoreEnvelopeError',
      ErrorCode: 'PayloadTypeNotSupported',
      ErrorMessage: field('PayloadType')
    });
  }
  try {
    const [payloadType, respondWith] = handler;
    const payload = respondWith(field('Payload'));
    log(`real-time ${field('PayloadType')} ${base.PayloadID} answered`);
    return reply({
      ...base,
      PayloadType: payloadType,
      Payload: payload,
      ErrorCode: 'Success',
      ErrorMessage: ''
    });
  } catch (e) {
    return reply({
      ...base,
      PayloadType: 'CoreEnvelopeError',
      ErrorCode: 'Payload',
      ErrorMessage: e instanceof Error ? e.message : String(e)
    });
  }
};

export const handleCore = async (req: Request, deps: CoreDeps) => {
  if (req.method !== 'POST' || new URL(req.url).pathname !== CORE_PATH) {
    return new Response(null, { status: 404 });
  }
  if (!isBasicAuthorized(deps.credentials, req.headers.get('authorization'))) {
    return new Response(null, { status: 401, headers: { 'www-authenticate': 'Basic' } });
  }
  return answer(req, deps);
};
