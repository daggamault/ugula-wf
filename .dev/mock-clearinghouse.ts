import { createECDH, createHash, createPrivateKey, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { posix } from 'node:path';
import { MOCK_HOST_KEY } from '@ugula/billing';
import {
  downloadName,
  type MockClaimState,
  readInterchange,
  respondToClaimStatus,
  respondToClaims,
  respondToEligibility,
  WAYSTAR_EXTENSIONS
} from '@ugula/billing/mock-waystar';
import { hostKeyFingerprint } from '@ugula/clearinghouse';
import ssh2, { type Attributes, type FileEntry, type SFTPWrapper } from 'ssh2';

const { Server, utils } = ssh2;
const { OPEN_MODE, STATUS_CODE } = utils.sftp;

const env = (name: string, fallback?: string) => {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '') throw new Error(`${name} is required`);
  return value;
};

const HOST = env('CLEARINGHOUSE_SFTP_HOST', 'localhost');
const PORT = Number(env('CLEARINGHOUSE_SFTP_PORT'));
const USERNAME = env('CLEARINGHOUSE_SFTP_USERNAME');
const PASSWORD = env('CLEARINGHOUSE_SFTP_PASSWORD');
const REMIT_DELAY_MS = Number(env('CLEARINGHOUSE_REMIT_DELAY_SECONDS', '20')) * 1000;
const REALTIME_PORT = Number(env('CLEARINGHOUSE_REALTIME_PORT', '2224'));
const ERA_UNENROLLED = new Set(
  (process.env.CLEARINGHOUSE_ERA_UNENROLLED ?? '')
    .split(',')
    .map((p) => p.trim().toUpperCase())
    .filter(Boolean)
);

const UPLOAD = '/upload';
const DOWNLOAD = '/download';
const PICKUP_DELAY_MS = 2000;
const PARTIAL_UPLOAD = /\.(part|tmp|filepart)$/i;

const log = (line: string) =>
  process.stdout.write(`[mock-clearinghouse] ${new Date().toISOString()} ${line}\n`);

type File = { data: Buffer; mtime: number };

const dirs = new Map<string, number>();
const files = new Map<string, File>();

const now = () => Math.floor(Date.now() / 1000);

const norm = (p: string) => posix.resolve('/', p || '.');

for (const dir of ['/', UPLOAD, DOWNLOAD]) dirs.set(dir, now());

const attrsOf = (p: string): Attributes | null => {
  const file = files.get(p);
  if (file) {
    return {
      mode: 0o100644,
      uid: 0,
      gid: 0,
      size: file.data.length,
      atime: file.mtime,
      mtime: file.mtime
    };
  }
  const dir = dirs.get(p);
  return dir === undefined
    ? null
    : { mode: 0o040755, uid: 0, gid: 0, size: 4096, atime: dir, mtime: dir };
};

const MONTHS = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ');

const longname = (name: string, a: Attributes) => {
  const d = new Date(a.mtime * 1000);
  const when = `${MONTHS[d.getMonth()]} ${String(d.getDate()).padStart(2)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const kind = (a.mode & 0o170000) === 0o040000 ? 'drwxr-xr-x' : '-rw-r--r--';
  return `${kind} 1 ${USERNAME} ${USERNAME} ${String(a.size).padStart(8)} ${when} ${name}`;
};

const entriesOf = (dir: string): FileEntry[] => {
  const prefix = dir === '/' ? '/' : `${dir}/`;
  const children = [...dirs.keys(), ...files.keys()].filter(
    (p) => p !== dir && p.startsWith(prefix) && !p.slice(prefix.length).includes('/')
  );
  return ['.', '..', ...children].flatMap((p) => {
    const path = p === '.' ? dir : p === '..' ? posix.dirname(dir) : p;
    const attrs = attrsOf(path);
    const filename = p.startsWith('/') ? posix.basename(p) : p;
    return attrs ? [{ filename, longname: longname(filename, attrs), attrs }] : [];
  });
};

const put = (p: string, text: string) => files.set(p, { data: Buffer.from(text), mtime: now() });

const baseOf = (p: string) => {
  const name = posix.basename(p);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
};

const claimStates = new Map<string, MockClaimState>();

const stateOf = (claimNumber: string) => claimStates.get(claimNumber) ?? 'unknown';

let seq = 0;

const deliver = (clientId: string, type: string, ext: string, text: string) => {
  seq += 1;
  const path = `${DOWNLOAD}/${downloadName(clientId, type, new Date(), seq)}${ext}`;
  put(path, text);
  log(`wrote ${path}`);
};

const answerClaims = (text: string, clientId: string, name: string) => {
  const r = respondToClaims(text, new Date(), (payerId) => !ERA_UNENROLLED.has(payerId));
  if (r.ta1) {
    log(`rejected ${name}: ${r.error}`);
    deliver(clientId, 'TA1', '.TA1', r.ta1);
    return;
  }
  log(
    `picked up ${name}${r.inbound ? ` (GS06 ${r.inbound.groupControlNumber}, ${r.inbound.claims.length} claims)` : ` (unreadable: ${r.error})`}`
  );
  deliver(clientId, '999', '.999', r.ack999);
  for (const n of r.accepted) claimStates.set(n, 'accepted');
  for (const n of r.rejected) claimStates.set(n, 'rejected');
  if (r.ack277) {
    log(
      `277CA accepted ${r.accepted.join(', ') || 'none'}; rejected ${r.rejected.join(', ') || 'none'}`
    );
    deliver(clientId, '277CA', '.277', r.ack277);
  }
  const remit = r.remit835;
  if (remit) {
    log(`835 due in ${REMIT_DELAY_MS / 1000}s`);
    const remitted = (r.inbound?.claims ?? []).filter(
      (c) => r.accepted.includes(c.claimNumber) && !ERA_UNENROLLED.has(c.payer?.id ?? '')
    );
    setTimeout(() => {
      deliver(clientId, 'ERA', '.835', remit);
      for (const c of remitted) claimStates.set(c.claimNumber, 'paid');
    }, REMIT_DELAY_MS);
  }
};

const answerEligibility = (text: string, clientId: string, name: string) => {
  try {
    const answers = respondToEligibility(text, new Date());
    log(`picked up ${name} (${answers.length} inquiries)`);
    for (const a of answers) deliver(clientId, '271', '.271', a);
  } catch (e) {
    log(`rejected ${name}: ${e instanceof Error ? e.message : String(e)}`);
  }
};

const answerClaimStatus = (text: string, clientId: string, name: string) => {
  try {
    deliver(clientId, 'CLAIMSTATUS', '.277', respondToClaimStatus(text, new Date(), stateOf));
    log(`picked up ${name}`);
  } catch (e) {
    log(`rejected ${name}: ${e instanceof Error ? e.message : String(e)}`);
  }
};

const handleUpload = (p: string) => {
  const file = files.get(p);
  if (!file) return;
  files.delete(p);
  const name = posix.basename(p);
  const text = file.data.toString('utf8');
  const clientId = readInterchange(text)?.sender || 'UNKNOWN';
  const ext = name.slice(name.lastIndexOf('.')).toUpperCase();
  if (baseOf(p).includes('.')) {
    log(`rejected ${name}: file names may not contain extra periods`);
    return;
  }
  if (ext === WAYSTAR_EXTENSIONS.claims) answerClaims(text, clientId, name);
  else if (ext === WAYSTAR_EXTENSIONS.eligibility) answerEligibility(text, clientId, name);
  else if (ext === WAYSTAR_EXTENSIONS.claimStatus) answerClaimStatus(text, clientId, name);
  else log(`rejected ${name}: upload 837P files as .CLP, 270 as .ELG and 276 as .CLS`);
};

const isInboundUpload = (p: string) => posix.dirname(p) === UPLOAD && !PARTIAL_UPLOAD.test(p);

const scheduleUpload = (p: string) => {
  if (isInboundUpload(p)) setTimeout(() => handleUpload(p), PICKUP_DELAY_MS);
};

type Handle =
  | { kind: 'file'; path: string; wrote: boolean }
  | { kind: 'dir'; path: string; read: boolean };

const serve = (sftp: SFTPWrapper) => {
  const handles = new Map<number, Handle>();
  let next = 0;
  const open = (h: Handle) => {
    const id = next++;
    handles.set(id, h);
    const buf = Buffer.alloc(4);
    buf.writeUInt32BE(id);
    return buf;
  };
  const handleOf = (buf: Buffer) =>
    buf.length === 4 ? handles.get(buf.readUInt32BE(0)) : undefined;
  const ok = (id: number) => sftp.status(id, STATUS_CODE.OK);
  const missing = (id: number) => sftp.status(id, STATUS_CODE.NO_SUCH_FILE);
  const denied = (id: number) =>
    sftp.status(id, STATUS_CODE.PERMISSION_DENIED, 'Write-only folder');
  const fail = (id: number, message: string) => sftp.status(id, STATUS_CODE.FAILURE, message);
  const stat = (id: number, p: string) => {
    const attrs = attrsOf(norm(p));
    if (attrs) sftp.attrs(id, attrs);
    else missing(id);
  };

  sftp
    .on('REALPATH', (id, p) => {
      const path = norm(p);
      sftp.name(id, [{ filename: path, longname: path, attrs: {} as Attributes }]);
    })
    .on('STAT', stat)
    .on('LSTAT', stat)
    .on('FSTAT', (id, buf) => {
      const h = handleOf(buf);
      const attrs = h && attrsOf(h.path);
      if (attrs) sftp.attrs(id, attrs);
      else fail(id, 'Bad handle');
    })
    .on('SETSTAT', (id) => ok(id))
    .on('FSETSTAT', (id) => ok(id))
    .on('OPEN', (id, p, flags) => {
      const path = norm(p);
      if (dirs.has(path)) return fail(id, 'Is a directory');
      const exists = files.has(path);
      const writing = (flags & (OPEN_MODE.WRITE | OPEN_MODE.APPEND)) !== 0;
      if (!writing) {
        if (posix.dirname(path) === UPLOAD) return denied(id);
        return exists ? sftp.handle(id, open({ kind: 'file', path, wrote: false })) : missing(id);
      }
      if (!dirs.has(posix.dirname(path))) return missing(id);
      if (exists && flags & OPEN_MODE.EXCL) return fail(id, 'File exists');
      if (!exists && !(flags & OPEN_MODE.CREAT)) return missing(id);
      if (!exists || flags & OPEN_MODE.TRUNC)
        files.set(path, { data: Buffer.alloc(0), mtime: now() });
      sftp.handle(id, open({ kind: 'file', path, wrote: false }));
    })
    .on('READ', (id, buf, offset, length) => {
      const h = handleOf(buf);
      const file = h?.kind === 'file' ? files.get(h.path) : undefined;
      if (!file) return fail(id, 'Bad handle');
      if (offset >= file.data.length) return sftp.status(id, STATUS_CODE.EOF);
      sftp.data(id, file.data.subarray(offset, Math.min(offset + length, file.data.length)));
    })
    .on('WRITE', (id, buf, offset, data) => {
      const h = handleOf(buf);
      const file = h?.kind === 'file' ? files.get(h.path) : undefined;
      if (h?.kind !== 'file' || !file) return fail(id, 'Bad handle');
      const end = offset + data.length;
      if (end > file.data.length) {
        const grown = Buffer.alloc(end);
        file.data.copy(grown);
        file.data = grown;
      }
      data.copy(file.data, offset);
      file.mtime = now();
      h.wrote = true;
      ok(id);
    })
    .on('CLOSE', (id, buf) => {
      const h = handleOf(buf);
      if (!h) return fail(id, 'Bad handle');
      handles.delete(buf.readUInt32BE(0));
      ok(id);
      if (h.kind === 'file' && h.wrote) scheduleUpload(h.path);
    })
    .on('OPENDIR', (id, p) => {
      const path = norm(p);
      if (path === UPLOAD) return denied(id);
      if (dirs.has(path)) sftp.handle(id, open({ kind: 'dir', path, read: false }));
      else missing(id);
    })
    .on('READDIR', (id, buf) => {
      const h = handleOf(buf);
      if (h?.kind !== 'dir') return fail(id, 'Bad handle');
      if (h.read) return sftp.status(id, STATUS_CODE.EOF);
      h.read = true;
      sftp.name(id, entriesOf(h.path));
    })
    .on('REMOVE', (id, p) => {
      if (files.delete(norm(p))) ok(id);
      else missing(id);
    })
    .on('MKDIR', (id, p) => {
      const path = norm(p);
      if (dirs.has(path) || files.has(path)) return fail(id, 'Already exists');
      if (!dirs.has(posix.dirname(path))) return missing(id);
      dirs.set(path, now());
      ok(id);
    })
    .on('RMDIR', (id, p) => {
      const path = norm(p);
      if (!dirs.has(path)) return missing(id);
      if (entriesOf(path).length > 2) return fail(id, 'Directory not empty');
      dirs.delete(path);
      ok(id);
    })
    .on('RENAME', (id, from, to) => {
      const src = norm(from);
      const dst = norm(to);
      const file = files.get(src);
      if (!file) return missing(id);
      if (files.has(dst) || dirs.has(dst)) return fail(id, 'Target exists');
      if (!dirs.has(posix.dirname(dst))) return missing(id);
      files.delete(src);
      files.set(dst, file);
      ok(id);
      scheduleUpload(dst);
    });
};

const matches = (given: string, expected: string) => {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
};

const HOST_KEY_SEED = 'ugula mock clearinghouse host key';

const stableHostKey = () => {
  const d = createHash('sha256').update(HOST_KEY_SEED).digest();
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(d);
  const point = ecdh.getPublicKey();
  const pem = createPrivateKey({
    format: 'jwk',
    key: {
      kty: 'EC',
      crv: 'P-256',
      d: d.toString('base64url'),
      x: point.subarray(1, 33).toString('base64url'),
      y: point.subarray(33).toString('base64url')
    }
  })
    .export({ type: 'sec1', format: 'pem' })
    .toString();
  const parsed = utils.parseKey(pem);
  if (parsed instanceof Error) throw parsed;
  const fingerprint = hostKeyFingerprint(parsed.getPublicSSH());
  if (fingerprint !== MOCK_HOST_KEY) {
    throw new Error(`The mock host key is ${fingerprint}, not MOCK_HOST_KEY ${MOCK_HOST_KEY}`);
  }
  return pem;
};

new Server({ hostKeys: [stableHostKey()] }, (client) => {
  client
    .on('authentication', (ctx) => {
      if (
        ctx.method === 'password' &&
        matches(ctx.username, USERNAME) &&
        matches(ctx.password, PASSWORD)
      ) {
        ctx.accept();
      } else {
        ctx.reject(['password']);
      }
    })
    .on('ready', () => {
      client.on('session', (accept) => {
        accept().on('sftp', (acceptSftp) => serve(acceptSftp()));
      });
    })
    .on('error', (e) => log(`client error: ${e.message}`));
}).listen(PORT, HOST, () => {
  log(
    `SFTP on ${HOST}:${PORT} as ${USERNAME}, host key ${MOCK_HOST_KEY}; 835s after ${REMIT_DELAY_MS / 1000}s`
  );
});

const authorized = (header: string | undefined) => {
  const [scheme, value] = (header ?? '').split(' ');
  if (scheme !== 'Basic' || !value) return false;
  const [user, ...pass] = Buffer.from(value, 'base64').toString('utf8').split(':');
  return matches(user ?? '', USERNAME) && matches(pass.join(':'), PASSWORD);
};

const coreReply = (fields: Record<string, string>) => {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  return new Response(form);
};

const answerRealtime = async (req: Request) => {
  const form = await req.formData();
  const field = (name: string) => String(form.get(name) ?? '');
  const base = {
    ProcessingMode: 'RealTime',
    PayloadID: field('PayloadID'),
    TimeStamp: new Date().toISOString(),
    SenderID: 'WAYSTAR',
    ReceiverID: field('SenderID'),
    CORERuleVersion: '2.2.0'
  };
  const answers: Record<string, [string, (x12: string) => string]> = {
    X12_270_Request_005010X279A1: [
      'X12_271_Response_005010X279A1',
      (x12) => respondToEligibility(x12, new Date())[0] ?? ''
    ],
    X12_276_Request_005010X212: [
      'X12_277_Response_005010X212',
      (x12) => respondToClaimStatus(x12, new Date(), stateOf)
    ]
  };
  const handler = answers[field('PayloadType')];
  if (!handler) {
    return coreReply({
      ...base,
      PayloadType: 'CoreEnvelopeError',
      ErrorCode: 'PayloadTypeNotSupported',
      ErrorMessage: field('PayloadType')
    });
  }
  try {
    const [payloadType, answer] = handler;
    const payload = answer(field('Payload'));
    log(`real-time ${field('PayloadType')} ${base.PayloadID} answered`);
    return coreReply({
      ...base,
      PayloadType: payloadType,
      Payload: payload,
      ErrorCode: 'Success',
      ErrorMessage: ''
    });
  } catch (e) {
    return coreReply({
      ...base,
      PayloadType: 'CoreEnvelopeError',
      ErrorCode: 'Payload',
      ErrorMessage: e instanceof Error ? e.message : String(e)
    });
  }
};

createServer(async (req, res) => {
  if (req.method !== 'POST' || req.url !== '/core/realtime') {
    res.writeHead(404).end();
    return;
  }
  if (!authorized(req.headers.authorization)) {
    res.writeHead(401, { 'www-authenticate': 'Basic' }).end();
    return;
  }
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const reply = await answerRealtime(
    new Request(`http://${HOST}${req.url}`, {
      method: 'POST',
      headers: { 'content-type': req.headers['content-type'] ?? '' },
      body: Buffer.concat(chunks)
    })
  );
  res.writeHead(200, {
    'content-type': reply.headers.get('content-type') ?? 'multipart/form-data'
  });
  res.end(Buffer.from(await reply.arrayBuffer()));
}).listen(REALTIME_PORT, HOST, () => {
  log(
    `CORE real-time eligibility and claim status on http://${HOST}:${REALTIME_PORT}/core/realtime`
  );
});
