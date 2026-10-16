const publicEnv = window.__TRELLO_ENV__ ?? {};

export const API_URL = publicEnv.apiUrl || "http://localhost:3001";
export const WS_URL = publicEnv.wsUrl || "ws://localhost:3002";

export type AuthUser = {
  id: string;
  email: string;
  name?: string | null;
  avatarUrl?: string | null;
};

export type Issue = {
  id: string;
  title: string;
  description?: string | null;
  position: number;
  sectionId: string;
  boardId: string;
  priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  dueDate?: string | null;
  completedAt?: string | null;
};

export type Section = {
  id: string;
  title: string;
  boardId: string;
  position: number;
  issues: Issue[];
};

export type Board = {
  id: string;
  title: string;
  description?: string | null;
  organizationId: string;
  sections: Section[];
};

export type Organization = {
  id: string;
  name: string;
  description?: string | null;
  boards: Board[];
  memberships: OrganizationMember[];
};

export type OrganizationMember = {
  id: string;
  userId: string;
  organizationId: string;
  role: "ADMIN" | "MEMBER";
  user: AuthUser;
};

export type OrganizationInvitation = {
  id: string;
  organizationId: string;
  invitedEmail: string | null;
  invitedAt: string;
  organization: Pick<Organization, "id" | "name" | "description">;
};

export function authHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

export async function api<T>(
  path: string,
  token?: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      ...(token ? authHeaders(token) : { "Content-Type": "application/json" }),
      ...(init?.headers || {}),
    },
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "Request failed");
  }
  return data as T;
}
