export type UserRole =
  | 'SUPER_ADMIN'
  | 'GESTIONNAIRE'
  | 'ADMIN'
  | 'CAISSIER'
  | 'COMPTABLE'
  | 'SURVEILLANT'
  | 'SECURITE'
  | 'ENSEIGNANT'
  | 'ELEVE'
  | 'PARENT'
  | 'RH';

export type RolePlateforme = 'SUPER_ADMIN' | 'GESTIONNAIRE';

export interface JwtUser {
  sub: string;
  role: UserRole;
  tenantId?: string;
  email?: string | null;
  telephone?: string | null;
  isPlatform?: boolean;
  accountType?: 'PLATFORM' | 'TENANT';
  groups?: UserRole[];
  userId?: string;
  iat?: number;
  exp?: number;
}
