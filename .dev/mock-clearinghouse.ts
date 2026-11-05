import { createServer } from 'node:http';
import { MOCK_HOST_KEY } from '@ugula/billing';
import {
  respondToClaimStatus,
  respondToClaims,
  respondToEligibility
} from '@ugula/billing/mock-waystar';
import ssh2 from 'ssh2';
import { credentialsMatch } from './mock-auth.ts';
import { parseMockConfig } from './mock-config.ts';
import { CORE_PATH, handleCore } from './mock-core.ts';
import { createMockFiles } from './mock-files.ts';
import { stableHostKey } from './mock-host-key.ts';
import { createResponder } from './mock-responder.ts';
import { createSftpHandlers } from './mock-sftp.ts';
import { DOWNLOAD, UPLOAD } from './mock-uploads.ts';

const config = parseMockConfig(process.env);
const { host, credentials } = config;
const now = () => new Date();
const log = (line: string) =>
  process.stdout.write(`[mock-clearinghouse] ${now().toISOString()} ${line}\n`);
const respond = {
  claims: respondToClaims,
  eligibility: respondToEligibility,
  claimStatus: respondToClaimStatus
};

const files = createMockFiles(credentials.username, () => Math.floor(now().getTime() / 1000), [
  UPLOAD,
  DOWNLOAD
]);
const responder = createResponder({
  files,
  respond,
  now,
  later: (run, ms) => void setTimeout(run, ms),
  log,
  remitDelayMs: config.remitDelayMs,
  eraUnenrolled: config.eraUnenrolled
});

new ssh2.Server({ hostKeys: [stableHostKey()] }, (client) => {
  client
    .on('authentication', (ctx) => {
      if (
        ctx.method === 'password' &&
        credentialsMatch(credentials, { username: ctx.username, password: ctx.password })
      ) {
        ctx.accept();
      } else {
        ctx.reject(['password']);
      }
    })
    .on('ready', () => {
      client.on('session', (accept) => {
        accept().on('sftp', (acceptSftp) => {
          const sftp = acceptSftp();
          const h = createSftpHandlers(sftp, files, responder.received);
          sftp
            .on('REALPATH', h.realpath)
            .on('STAT', h.stat)
            .on('LSTAT', h.stat)
            .on('FSTAT', h.fstat)
            .on('SETSTAT', h.setstat)
            .on('FSETSTAT', h.setstat)
            .on('OPEN', h.open)
            .on('READ', h.read)
            .on('WRITE', h.write)
            .on('CLOSE', h.close)
            .on('OPENDIR', h.opendir)
            .on('READDIR', h.readdir)
            .on('REMOVE', h.remove)
            .on('MKDIR', h.mkdir)
            .on('RMDIR', h.rmdir)
            .on('RENAME', h.rename);
        });
      });
    })
    .on('error', (e) => log(`client error: ${e.message}`));
}).listen(config.port, host, () => {
  log(
    `SFTP on ${host}:${config.port} as ${credentials.username}, host key ${MOCK_HOST_KEY}; 835s after ${config.remitDelayMs / 1000}s`
  );
});

createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const method = req.method ?? 'GET';
  const reply = await handleCore(
    new Request(`http://${host}${req.url ?? '/'}`, {
      method,
      headers: {
        'content-type': req.headers['content-type'] ?? '',
        authorization: req.headers.authorization ?? ''
      },
      body: method === 'GET' || method === 'HEAD' ? null : Buffer.concat(chunks)
    }),
    { credentials, respond, stateOf: responder.stateOf, now, log }
  );
  res.writeHead(reply.status, Object.fromEntries(reply.headers));
  res.end(Buffer.from(await reply.arrayBuffer()));
}).listen(config.realtimePort, host, () => {
  log(
    `CORE real-time eligibility and claim status on http://${host}:${config.realtimePort}${CORE_PATH}`
  );
});
