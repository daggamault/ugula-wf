import { randomUUID } from 'node:crypto';
import { importsPrefix } from '@ugula/storage';

export type UploadedFile = {
  name: string;
  type: string;
  bytes: Uint8Array;
};

export const FORM_OVERHEAD_BYTES = 64 * 1024;

export const safeName = (name: string) =>
  name
    .replace(/[^\w.-]+/g, '_')
    .replace(/^[._]+/, '')
    .slice(-120) || 'upload';

export const uploadKey = (tenantId: string, name: string, folder = '') =>
  `${importsPrefix(tenantId)}${folder}${randomUUID()}/${safeName(name)}`;
