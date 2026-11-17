type ListenClient = {
  connect: () => Promise<unknown>;
  query: (text: string) => Promise<unknown>;
  on: (event: 'notification' | 'error' | 'end', handler: (arg?: unknown) => void) => unknown;
  end: () => Promise<void>;
};

type ListenDeps = {
  client: () => ListenClient;
  channel: string;
  report: (message: string) => void;
  retryMs: number;
};

const quoted = (channel: string) => `"${channel.replaceAll('"', '""')}"`;

export const createListen =
  ({ client, channel, report, retryMs }: ListenDeps) =>
  (onNotify: () => void) => {
    let current: ListenClient | null = null;
    let retry: NodeJS.Timeout | null = null;
    let stopped = false;

    const reconnect = () => {
      current = null;
      if (stopped || retry) return;
      retry = setTimeout(() => {
        retry = null;
        void connect();
      }, retryMs);
    };

    const connect = async () => {
      const c = client();
      current = c;
      c.on('notification', () => onNotify());
      c.on('error', (err) => {
        report(`Listening for ${channel} failed: ${String(err)}`);
        void c.end().catch(() => undefined);
        if (current === c) reconnect();
      });
      c.on('end', () => {
        if (current === c) reconnect();
      });
      try {
        await c.connect();
        await c.query(`listen ${quoted(channel)}`);
        if (stopped) await c.end();
        else onNotify();
      } catch (err) {
        report(`Listening for ${channel} failed: ${String(err)}`);
        await c.end().catch(() => undefined);
        if (current === c) reconnect();
      }
    };

    void connect();

    return {
      stop: async () => {
        stopped = true;
        if (retry) clearTimeout(retry);
        const c = current;
        current = null;
        await c?.end().catch(() => undefined);
      }
    };
  };
