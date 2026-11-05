import {
  AFTER_DOWNLOAD,
  CLEARINGHOUSE_VENDORS,
  FILE_EXTENSION_PATTERN,
  HOST_KEY_PATTERN
} from '@ugula/billing';
import * as v from 'valibot';

const remotePath = (pattern: RegExp, message: string) =>
  v.pipe(v.string(), v.trim(), v.regex(pattern, message), v.maxLength(255));

const extension = v.pipe(
  v.string(),
  v.trim(),
  v.regex(new RegExp(FILE_EXTENSION_PATTERN), 'Use an extension such as .CLP')
);

export const connectionSchema = v.object({
  vendor: v.picklist(CLEARINGHOUSE_VENDORS),
  enabled: v.boolean(),
  sftpHost: v.pipe(
    v.string(),
    v.trim(),
    v.regex(/^[A-Za-z0-9.-]{1,253}$/, 'Enter a host name such as sshftp.waystar.com')
  ),
  sftpPort: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(65535)),
  sftpHostKey: v.pipe(
    v.string(),
    v.trim(),
    v.regex(
      new RegExp(HOST_KEY_PATTERN),
      'Enter the SHA256 host key fingerprint your clearinghouse gives you, such as SHA256:…'
    )
  ),
  sftpUsername: v.pipe(
    v.string(),
    v.trim(),
    v.nonEmpty('Enter the SFTP username'),
    v.maxLength(255)
  ),
  secret: v.nullable(v.pipe(v.string(), v.nonEmpty('Enter the password'), v.maxLength(1024))),
  uploadPath: remotePath(/^\/\P{Cc}*$/u, 'Paths start with /'),
  downloadPaths: v.pipe(
    v.array(remotePath(/^\/[^\p{Cc},]*$/u, 'Paths start with / and have no commas')),
    v.minLength(1),
    v.maxLength(10)
  ),
  claimExtension: extension,
  eligibilityExtension: extension,
  claimStatusExtension: extension,
  afterDownload: v.picklist(AFTER_DOWNLOAD),
  realtimeUrl: v.nullable(
    v.pipe(v.string(), v.trim(), v.url(), v.regex(/^https?:\/\//, 'Use an http or https URL'))
  )
});

export type ConnectionInput = v.InferOutput<typeof connectionSchema>;
