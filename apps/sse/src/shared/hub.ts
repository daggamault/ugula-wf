export type HubClient = {
  readonly writableNeedDrain: boolean;
  write: (chunk: string) => unknown;
  destroy: () => unknown;
};

export const createHub = () => {
  const tenants = new Map<string, Set<HubClient>>();
  const remove = (tenantId: string, group: Set<HubClient>, client: HubClient) => {
    group.delete(client);
    if (!group.size && tenants.get(tenantId) === group) tenants.delete(tenantId);
  };
  return {
    add: (tenantId: string, client: HubClient) => {
      const group = tenants.get(tenantId) ?? new Set<HubClient>();
      group.add(client);
      tenants.set(tenantId, group);
      return () => remove(tenantId, group, client);
    },
    broadcast: (tenantId: string, data: string) => {
      const group = tenants.get(tenantId);
      if (!group) return;
      for (const client of group) {
        if (client.writableNeedDrain) {
          remove(tenantId, group, client);
          client.destroy();
        } else client.write(`data: ${data}\n\n`);
      }
    }
  };
};

export type Hub = ReturnType<typeof createHub>;
