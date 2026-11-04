import { isPermission, type Permission } from '@ugula/access';
import { createContext, type ReactNode, useContext } from 'react';
import type { Api } from './api.ts';

export type Agency = {
  id: string;
  name: string;
  organizationId: string;
  organizationName: string;
};

export type Access = {
  agencyId: string;
  agencyName: string;
  organizationId: string;
  organizationName: string;
  userId: string;
  isOrganizationAdmin: boolean;
  permissions: Permission[];
};

export type AgenciesClient = {
  list: (signal?: AbortSignal) => Promise<Agency[]>;
  access: (agencyId: string, signal?: AbortSignal) => Promise<Access>;
};

export const createAgenciesClient = (api: Api): AgenciesClient => ({
  list: async (signal) => (await api.get<{ items: Agency[] }>('/api/agencies', signal)).items,
  access: async (agencyId, signal) => {
    const access = await api.get<Access>(`/api/agencies/${agencyId}/access`, signal);
    return { ...access, permissions: access.permissions.filter(isPermission) };
  }
});

const LAST_AGENCY = 'ugula.agency';

export const rememberAgency = (agencyId: string) => {
  try {
    localStorage.setItem(LAST_AGENCY, agencyId);
  } catch {}
};

export const rememberedAgency = (agencies: readonly Agency[]) => {
  try {
    const id = localStorage.getItem(LAST_AGENCY);
    return agencies.find((a) => a.id === id) ?? null;
  } catch {
    return null;
  }
};

const AccessContext = createContext<Access | null>(null);

export const AccessProvider = ({ access, children }: { access: Access; children: ReactNode }) => (
  <AccessContext value={access}>{children}</AccessContext>
);

export const useAccess = () => {
  const access = useContext(AccessContext);
  if (!access) throw new Error('useAccess needs an AccessProvider');
  return access;
};

export const useCan = () => {
  const access = useContext(AccessContext);
  return (permission: Permission) => access?.permissions.includes(permission) ?? false;
};
