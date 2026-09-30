import {
  buildRoleMembershipWhere,
  hasUserRole,
  mergeUserRoles,
  normalizeOptionalEmail,
} from '@/common/utils/user-identity.util';

describe('user identity utilities', () => {
  it('keeps missing email as null instead of generating a local address', () => {
    expect(normalizeOptionalEmail(undefined)).toBeNull();
    expect(normalizeOptionalEmail('')).toBeNull();
    expect(normalizeOptionalEmail('  Parent@Example.COM ')).toBe('parent@example.com');
  });

  it('detects and merges roles across primary and secondary roles', () => {
    const user = { role: 'ENSEIGNANT', roles: ['PARENT'] };

    expect(hasUserRole(user, 'ENSEIGNANT')).toBe(true);
    expect(hasUserRole(user, 'PARENT')).toBe(true);
    expect(hasUserRole(user, 'ELEVE')).toBe(false);
    expect(mergeUserRoles(user, 'SECURITE')).toEqual(['PARENT', 'SECURITE']);
  });

  it('builds a Prisma filter that includes primary and secondary roles', () => {
    expect(buildRoleMembershipWhere('PARENT')).toEqual({
      OR: [{ role: 'PARENT' }, { roles: { has: 'PARENT' } }],
    });
  });
});
