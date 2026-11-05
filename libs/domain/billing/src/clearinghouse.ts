export const CLEARINGHOUSE_VENDORS = ['waystar', 'mock', 'custom-sftp'] as const;

export type ClearinghouseVendor = (typeof CLEARINGHOUSE_VENDORS)[number];

export const AFTER_DOWNLOAD = ['delete', 'keep'] as const;

export type AfterDownload = (typeof AFTER_DOWNLOAD)[number];

export const FILE_EXTENSION_PATTERN = '^\\.[A-Za-z0-9]{1,10}$';

export const HOST_KEY_PATTERN = '^SHA256:[A-Za-z0-9+/]{43}$';

export const MOCK_HOST_KEY = 'SHA256:VM159e2IEtdtiYxUoqIC5u7Z7D57F/k83MgfOvFrDdM';

export type ClearinghouseExtensions = { claims: string; eligibility: string; claimStatus: string };

export const WAYSTAR_EXTENSIONS: ClearinghouseExtensions = {
  claims: '.CLP',
  eligibility: '.ELG',
  claimStatus: '.CLS'
};

export type ClearinghouseSettings = {
  host: string;
  port: number;
  hostKey: string;
  uploadPath: string;
  downloadPaths: string[];
  extensions: ClearinghouseExtensions;
  afterDownload: AfterDownload;
  realtimeUrl: string | null;
};

type VendorPreset = Omit<ClearinghouseSettings, 'hostKey'> & {
  label: string;
  hostKey: string | null;
  receiverId: string | null;
};

const WAYSTAR_FOLDERS = { uploadPath: '/upload', downloadPaths: ['/download'] };

export const VENDOR_PRESETS: Record<ClearinghouseVendor, VendorPreset> = {
  waystar: {
    label: 'Waystar',
    host: 'sshftp.waystar.com',
    port: 22,
    hostKey: null,
    ...WAYSTAR_FOLDERS,
    extensions: WAYSTAR_EXTENSIONS,
    afterDownload: 'delete',
    realtimeUrl: null,
    receiverId: 'WAYSTAR'
  },
  mock: {
    label: 'Mock clearinghouse (development)',
    host: 'localhost',
    port: 2223,
    hostKey: MOCK_HOST_KEY,
    ...WAYSTAR_FOLDERS,
    extensions: WAYSTAR_EXTENSIONS,
    afterDownload: 'delete',
    realtimeUrl: 'http://localhost:2224/core/realtime',
    receiverId: 'WAYSTAR'
  },
  'custom-sftp': {
    label: 'Other SFTP clearinghouse',
    host: '',
    port: 22,
    hostKey: null,
    uploadPath: '/',
    downloadPaths: ['/'],
    extensions: { claims: '.txt', eligibility: '.txt', claimStatus: '.txt' },
    afterDownload: 'delete',
    realtimeUrl: null,
    receiverId: null
  }
};

export type ClearinghouseFile = { path: string; name: string; size: number; modifiedAt: Date };

export type RealtimeAnswer = { ok: true; text: string } | { ok: false; error: string };

export type Clearinghouse = {
  submitClaims: (baseName: string, x12: Uint8Array) => Promise<string>;
  submitEligibility: (baseName: string, x12: Uint8Array) => Promise<string>;
  submitClaimStatus: (baseName: string, x12: Uint8Array) => Promise<string>;
  checkEligibility: ((x12: string) => Promise<RealtimeAnswer>) | null;
  checkClaimStatus: ((x12: string) => Promise<RealtimeAnswer>) | null;
  inbox: <T>(work: (inbox: ClearinghouseInbox) => Promise<T>) => Promise<T>;
  afterDownload: AfterDownload;
};

export type ClearinghouseInbox = {
  list: () => Promise<ClearinghouseFile[]>;
  download: (path: string) => Promise<Uint8Array>;
  remove: (path: string) => Promise<void>;
};

export type BatchTransport = {
  upload: (name: string, bytes: Uint8Array) => Promise<string>;
  session: <T>(work: (inbox: ClearinghouseInbox) => Promise<T>) => Promise<T>;
};

export type RealtimeReply =
  | { ok: true; payloadType: string; payload: string }
  | { ok: false; error: string };

export type RealtimeTransport = (payloadType: string, payload: string) => Promise<RealtimeReply>;

export const CORE_PAYLOADS = {
  eligibility: {
    request: 'X12_270_Request_005010X279A1',
    response: 'X12_271_Response_005010X279A1'
  },
  claimStatus: {
    request: 'X12_276_Request_005010X212',
    response: 'X12_277_Response_005010X212'
  }
} as const;

const realtimeOf =
  (send: RealtimeTransport, { request, response }: { request: string; response: string }) =>
  async (x12: string): Promise<RealtimeAnswer> => {
    const reply = await send(request, x12);
    if (!reply.ok) return reply;
    return reply.payloadType === response && reply.payload.trim()
      ? { ok: true, text: reply.payload }
      : { ok: false, error: `The clearinghouse answered ${reply.payloadType || 'nothing'}` };
  };

export const createClearinghouse = ({
  batch,
  realtime,
  extensions,
  afterDownload
}: {
  batch: BatchTransport;
  realtime: RealtimeTransport | null;
  extensions: ClearinghouseExtensions;
  afterDownload: AfterDownload;
}): Clearinghouse => {
  const submit = (extension: string) => async (baseName: string, x12: Uint8Array) => {
    const name = `${baseName}${extension}`;
    await batch.upload(name, x12);
    return name;
  };
  return {
    submitClaims: submit(extensions.claims),
    submitEligibility: submit(extensions.eligibility),
    submitClaimStatus: submit(extensions.claimStatus),
    checkEligibility: realtime ? realtimeOf(realtime, CORE_PAYLOADS.eligibility) : null,
    checkClaimStatus: realtime ? realtimeOf(realtime, CORE_PAYLOADS.claimStatus) : null,
    inbox: batch.session,
    afterDownload
  };
};

export const EXCHANGE_FILES = { claims: '837P', eligibility: '270', claimStatus: '276' } as const;

export const exchangeFileName = (
  kind: keyof typeof EXCHANGE_FILES,
  controlNumber: number,
  id: string
) =>
  `${EXCHANGE_FILES[kind]}-${String(controlNumber).padStart(9, '0')}-${id.replaceAll('-', '').slice(0, 8)}`;
