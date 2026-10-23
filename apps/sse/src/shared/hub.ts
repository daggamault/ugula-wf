export type HubClient = {
  write: (chunk: string) => unknown;
};

export const createHub = () => {
  const tenants = new Map<string, Set<HubClient>>();
  const each = (fn: (client: HubClient) => void, tenantId?: string) => {
    const groups = tenantId === undefined ? [...tenants.values()] : [tenants.get(tenantId)];
    for (const group of groups) for (const client of group ?? []) fn(client);
  };
  return {
    add: (tenantId: string, client: HubClient) => {
      const group = tenants.get(tenantId) ?? new Set<HubClient>();
      group.add(client);
      tenants.set(tenantId, group);
      return () => {
        group.delete(client);
        if (!group.size) tenants.delete(tenantId);
      };
    },
    broadcast: (tenantId: string, data: string) =>
      each((c) => c.write(`data: ${data}\n\n`), tenantId),
    beat: () => each((c) => c.write(': ping\n\n')),
    size: () => [...tenants.values()].reduce((n, group) => n + group.size, 0)
  };
};

export type Hub = ReturnType<typeof createHub>;
