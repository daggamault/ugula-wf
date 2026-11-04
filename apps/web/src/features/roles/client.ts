import type { Permission } from '@ugula/access';
import type { Api } from '../../shared/api.ts';
import type { Page } from '../../shared/url-state.ts';

export type Role = {
  id: string;
  name: string;
  version: number;
  users: number;
  permissions: Permission[];
  isGrantable: boolean;
  updatedAt: string;
};

export type PermissionGrant = {
  permission: Permission;
  description: string;
  isGrantable: boolean;
};

export type RoleInput = { name: string; permissions: Permission[] };

const path = (id: string) => `/api/roles/${encodeURIComponent(id)}`;

export const createRolesClient = (api: Api) => ({
  search: (query: string, signal?: AbortSignal) =>
    api.get<Page<Role>>(`/api/roles?${query}`, signal),
  role: (id: string, signal?: AbortSignal) => api.get<Role>(path(id), signal),
  grants: async (signal?: AbortSignal) =>
    (await api.get<{ items: PermissionGrant[] }>('/api/roles/permissions', signal)).items,
  create: (input: RoleInput) => api.post<{ id: string }>('/api/roles', input),
  update: (id: string, input: RoleInput & { version: number }) => api.put<Role>(path(id), input),
  remove: (id: string) => api.remove<{ id: string }>(path(id))
});

export type RolesClient = ReturnType<typeof createRolesClient>;
