import { posix } from 'node:path';
import { WAYSTAR_EXTENSIONS } from '@ugula/billing/mock-waystar';

export const UPLOAD = '/upload';
export const DOWNLOAD = '/download';

const PARTIAL_UPLOAD = /\.(part|tmp|filepart)$/i;

type UploadKind = keyof typeof WAYSTAR_EXTENSIONS;

const KINDS = Object.keys(WAYSTAR_EXTENSIONS) as UploadKind[];

export const isInboundUpload = (path: string) =>
  posix.dirname(path) === UPLOAD && !PARTIAL_UPLOAD.test(path);

export const routeUpload = (name: string): { kind: UploadKind } | { error: string } => {
  const dot = name.lastIndexOf('.');
  if ((dot > 0 ? name.slice(0, dot) : name).includes('.')) {
    return { error: 'file names may not contain extra periods' };
  }
  const ext = name.slice(dot).toUpperCase();
  const kind = KINDS.find((k) => WAYSTAR_EXTENSIONS[k] === ext);
  return kind ? { kind } : { error: 'upload 837P files as .CLP, 270 as .ELG and 276 as .CLS' };
};
