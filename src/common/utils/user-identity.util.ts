type RoleLike = string;

type UserRoleCarrier = {
  role?: RoleLike | null;
  roles?: readonly RoleLike[] | null;
};

export function normalizeOptionalEmail(value: unknown): string | null {
  const email = String(value ?? '').trim().toLowerCase();
  return email || null;
}

export function hasUserRole(user: UserRoleCarrier, role: RoleLike): boolean {
  return user.role === role || (user.roles ?? []).includes(role);
}

export function mergeUserRoles(user: UserRoleCarrier, role: RoleLike): RoleLike[] {
  const roles = new Set(user.roles ?? []);
  if (user.role !== role) roles.add(role);
  return [...roles];
}

export function allUserRoles(user: UserRoleCarrier): RoleLike[] {
  return [...new Set([user.role, ...(user.roles ?? [])].filter(Boolean) as RoleLike[])];
}

export function buildRoleMembershipWhere(role: RoleLike): Record<string, any> {
  return {
    OR: [{ role }, { roles: { has: role } }],
  };
}
