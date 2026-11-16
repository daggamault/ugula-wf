import { type ChildProcess, type SpawnOptions, spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { connect } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { nonEmpty, portInt, urlString } from '@ugula/config';
import * as v from 'valibot';

const PORT_OFFSET = 100;

const READY_MS = 120_000;

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));

const WEB = fileURLToPath(new URL('..', import.meta.url));

const CACHE = fileURLToPath(new URL('../../../.cache', import.meta.url));

const STACK_LOG = fileURLToPath(new URL('../../../.cache/e2e-stack.log', import.meta.url));

const runConfigSchema = v.object({
  DB_NAME: nonEmpty,
  DB_REFERENCE_NAME: v.optional(nonEmpty),
  S3_BUCKET: nonEmpty,
  WEB_URL: urlString,
  API_URL: urlString,
  SSE_URL: urlString,
  WEB_PORT: portInt,
  API_PORT: portInt,
  SSE_PORT: portInt,
  CLEARINGHOUSE_SFTP_PORT: portInt,
  CHOUSE_REALTIME_PORT: v.optional(portInt, '2224'),
  CLEARINGHOUSE_REALTIME_URL: v.optional(v.string(), '')
});

type RunConfig = v.InferOutput<typeof runConfigSchema>;

const shiftedPort = (port: number) => port + PORT_OFFSET;

const shiftedUrl = (url: string) => {
  const u = new URL(url);
  u.port = String(shiftedPort(Number(u.port)));
  return u.pathname === '/' ? u.origin : u.href;
};

const stackEnv = (c: RunConfig): NodeJS.ProcessEnv => {
  const webUrl = shiftedUrl(c.WEB_URL);
  return {
    ...process.env,
    DB_NAME: `${c.DB_NAME}_e2e`,
    DB_REFERENCE_NAME: c.DB_REFERENCE_NAME ?? `${c.DB_NAME}_reference`,
    S3_BUCKET: `${c.S3_BUCKET}-e2e`,
    WEB_URL: webUrl,
    API_URL: shiftedUrl(c.API_URL),
    SSE_URL: shiftedUrl(c.SSE_URL),
    WEB_PORT: String(shiftedPort(c.WEB_PORT)),
    API_PORT: String(shiftedPort(c.API_PORT)),
    SSE_PORT: String(shiftedPort(c.SSE_PORT)),
    API_CORS_ORIGINS: webUrl,
    SSE_CORS_ORIGINS: webUrl,
    CLEARINGHOUSE_SFTP_PORT: String(shiftedPort(c.CLEARINGHOUSE_SFTP_PORT)),
    CHOUSE_REALTIME_PORT: String(shiftedPort(c.CHOUSE_REALTIME_PORT)),
    CLEARINGHOUSE_REALTIME_URL: c.CLEARINGHOUSE_REALTIME_URL
      ? shiftedUrl(c.CLEARINGHOUSE_REALTIME_URL)
      : '',
    E2E_WEB_URL: webUrl
  };
};

const isListening = (port: number) =>
  new Promise<boolean>((resolve) => {
    const socket = connect({ port, host: 'localhost' });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });

const run = (command: string, options: SpawnOptions) =>
  spawn(command, { ...options, shell: true, detached: process.platform !== 'win32' });

const hasExited = (child: ChildProcess) => child.exitCode !== null || child.signalCode !== null;

const exited = (child: ChildProcess) =>
  new Promise<number>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? 1));
  });

const stop = async (child: ChildProcess) => {
  if (hasExited(child) || child.pid === undefined) return;
  const done = exited(child);
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
  } else {
    process.kill(-child.pid, 'SIGTERM');
  }
  await done;
};

const isUp = (url: string) =>
  fetch(url).then(
    (r) => r.ok,
    () => false
  );

const waitUntilUp = async (urls: string[], stack: ChildProcess) => {
  const deadline = Date.now() + READY_MS;
  for (const url of urls) {
    while (!(await isUp(url))) {
      if (hasExited(stack)) throw new Error(`The e2e stack exited; see ${STACK_LOG}`);
      if (Date.now() > deadline) throw new Error(`${url} was not up within ${READY_MS}ms`);
      await delay(500);
    }
  }
};

const config = v.parse(runConfigSchema, process.env);
const env = stackEnv(config);
const ports = [
  env.WEB_PORT,
  env.API_PORT,
  env.SSE_PORT,
  env.CLEARINGHOUSE_SFTP_PORT,
  env.CHOUSE_REALTIME_PORT
].map(Number);
const busy = (
  await Promise.all(ports.map(async (p) => ((await isListening(p)) ? [p] : [])))
).flat();
if (busy.length) {
  throw new Error(`Ports ${busy.join(', ')} are in use; is another e2e stack running?`);
}

const reset = await exited(run('pnpm db:reset', { cwd: ROOT, env, stdio: 'inherit' }));
if (reset !== 0) process.exit(reset);

await mkdir(CACHE, { recursive: true });
const log = createWriteStream(STACK_LOG);
const stack = run('pnpm dev', { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
stack.stdout?.pipe(log);
stack.stderr?.pipe(log);
process.once('SIGINT', () => void stop(stack).then(() => process.exit(130)));

try {
  await waitUntilUp([`${env.API_URL}/health`, `${env.SSE_URL}/health`, `${env.WEB_URL}`], stack);
  const suites = process.argv.slice(2);
  const tests = spawn(
    process.execPath,
    ['--test', ...(suites.length ? suites : ['e2e/*.e2e.ts'])],
    { cwd: WEB, env, stdio: 'inherit' }
  );
  process.exitCode = await exited(tests);
} finally {
  await stop(stack);
  log.end();
}
if (process.exitCode) process.stderr.write(`Stack log: ${STACK_LOG}\n`);
