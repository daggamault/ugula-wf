import { BlockList, isIP } from 'node:net';
import type { ConnectionInput } from './schemas.ts';

const PRIVATE_V4 = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 3]
] as const;

const PRIVATE_V6 = [
  ['::', 127],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8]
] as const;

const blocked = new BlockList();
for (const [net, prefix] of PRIVATE_V4) blocked.addSubnet(net, prefix, 'ipv4');
for (const [net, prefix] of PRIVATE_V6) blocked.addSubnet(net, prefix, 'ipv6');

const LOCAL_NAMES = /(^|\.)(localhost|local|internal|home\.arpa)$/;

export const isPrivateHost = (hostname: string) => {
  const host = hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '');
  const family = isIP(host);
  if (family === 4) return blocked.check(host, 'ipv4');
  if (family === 6) return blocked.check(host, 'ipv6');
  return host === '' || LOCAL_NAMES.test(host);
};

const hostOf = (host: string) => {
  try {
    return new URL(`http://${host}`).hostname;
  } catch {
    return '';
  }
};

export const endpointIssue = (c: ConnectionInput, allowLocal: boolean): string | null => {
  if (allowLocal) return null;
  if (c.vendor === 'mock') return 'The mock clearinghouse is only for development';
  if (isPrivateHost(hostOf(c.sftpHost))) return 'The SFTP host must be a public server';
  if (c.realtimeUrl) {
    const url = new URL(c.realtimeUrl);
    if (url.protocol !== 'https:') return 'The real-time URL must use https';
    if (isPrivateHost(url.hostname)) return 'The real-time URL must be a public server';
  }
  return null;
};
