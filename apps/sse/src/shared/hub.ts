type HubClient = {
  readonly writableNeedDrain: boolean;
  write: (chunk: string) => unknown;
  destroy: () => unknown;
};

export const createHub = () => {
  const agencies = new Map<string, Set<HubClient>>();
  const remove = (agencyId: string, group: Set<HubClient>, client: HubClient) => {
    group.delete(client);
    if (!group.size && agencies.get(agencyId) === group) agencies.delete(agencyId);
  };
  return {
    add: (agencyId: string, client: HubClient) => {
      const group = agencies.get(agencyId) ?? new Set<HubClient>();
      group.add(client);
      agencies.set(agencyId, group);
      return () => remove(agencyId, group, client);
    },
    broadcast: (agencyId: string, data: string) => {
      const group = agencies.get(agencyId);
      if (!group) return;
      for (const client of group) {
        if (client.writableNeedDrain) {
          remove(agencyId, group, client);
          client.destroy();
        } else client.write(`data: ${data}\n\n`);
      }
    }
  };
};

export type Hub = ReturnType<typeof createHub>;
