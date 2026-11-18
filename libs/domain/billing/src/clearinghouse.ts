export const CLEARINGHOUSE_VENDORS = ['waystar', 'mock', 'custom-sftp'] as const;

export type ClearinghouseVendor = (typeof CLEARINGHOUSE_VENDORS)[number];

export const AFTER_DOWNLOAD = ['delete', 'keep'] as const;

export type AfterDownload = (typeof AFTER_DOWNLOAD)[number];

export const FILE_EXTENSION_PATTERN = '^\\.[A-Za-z0-9]{1,10}$';

export const HOST_KEY_PATTERN = '^SHA256:[A-Za-z0-9+/]{43}$';

export const MOCK_HOST_KEY = 'SHA256:VM159e2IEtdtiYxUoqIC5u7Z7D57F/k83MgfOvFrDdM';

type ClearinghouseExtensions = { claims: string; eligibility: string; claimStatus: string };

export const WAYSTAR_EXTENSIONS: ClearinghouseExtensions = {
  claims: '.CLP',
  eligibility: '.ELG',
  claimStatus: '.CLS'
};

type ClearinghouseSettings = {
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
