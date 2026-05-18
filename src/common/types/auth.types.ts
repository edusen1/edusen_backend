export type UserRole =
  | 'SUPER_ADMIN'
  | 'GESTIONNAIRE'
  | 'ADMIN'
  | 'CAISSIER'
  | 'SURVEILLANT'
  | 'ENSEIGNANT'
  | 'ELEVE'
  | 'PARENT'
  | 'RH';

export type RolePlateforme = 'SUPER_ADMIN' | 'GESTIONNAIRE';

export interface JwtUser {
  sub: string;
  role: UserRole;
  tenantId?: string;
  email: string;
  isPlatform?: boolean;
  iat?: number;
  exp?: number;
}
