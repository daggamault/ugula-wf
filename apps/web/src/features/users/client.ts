import type { Api } from '../../shared/api.ts';
import type { Page } from '../../shared/url-state.ts';

export type BlockedReason = 'self' | 'outranked' | null;

export type AgencyUser = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  isOwner: boolean;
  version: number;
  role: { id: string; name: string };
  blockedReason: BlockedReason;
};

export type Invitation = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: { id: string; name: string };
  isGrantable: boolean;
  isExpired: boolean;
  expiresAt: string;
  createdAt: string;
};

export type RoleOption = { id: string; name: string; isGrantable: boolean };

export type InviteInput = { email: string; firstName: string; lastName: string; roleId: string };

const userPath = (id: string) => `/api/users/${encodeURIComponent(id)}`;

const invitationPath = (id: string) => `/api/invitations/${encodeURIComponent(id)}`;

export const createUsersClient = (api: Api) => ({
  search: (query: string, signal?: AbortSignal) =>
    api.get<Page<AgencyUser>>(`/api/users?${query}`, signal),
  user: (id: string, signal?: AbortSignal) => api.get<AgencyUser>(userPath(id), signal),
  roles: async (signal?: AbortSignal) =>
    (await api.get<Page<RoleOption>>('/api/roles?pageSize=100&sort=name&dir=asc', signal)).items,
  setRole: (id: string, input: { roleId: string; version: number }) =>
    api.put<AgencyUser>(userPath(id), input),
  remove: (id: string) => api.remove<{ id: string }>(userPath(id)),
  passwordLink: (id: string) => api.post<{ link: string }>(`${userPath(id)}/password-link`),
  invitations: async (signal?: AbortSignal) =>
    (await api.get<{ items: Invitation[] }>('/api/invitations', signal)).items,
  invite: (input: InviteInput) => api.post<{ id: string; link: string }>('/api/invitations', input),
  resend: (id: string) => api.post<{ id: string; link: string }>(`${invitationPath(id)}/resend`),
  removeInvitation: (id: string) => api.remove<{ id: string }>(invitationPath(id))
});

export type UsersClient = ReturnType<typeof createUsersClient>;

export const fullName = (u: { firstName: string; lastName: string }) =>
  `${u.firstName} ${u.lastName}`;

export const BLOCKED_MESSAGES: Record<Exclude<BlockedReason, null>, string> = {
  self: "You can't change your own access.",
  outranked: 'This user has permissions you do not hold.'
};
