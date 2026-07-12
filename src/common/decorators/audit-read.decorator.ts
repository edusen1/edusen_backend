import { SetMetadata } from '@nestjs/common';

/**
 * Mark a GET endpoint as sensitive — the audit interceptor will log it
 * even though it's not a mutation (POST/PUT/PATCH/DELETE).
 *
 * Usage: @AuditRead('CONSULTATION_AUDIT')
 */
export const AUDIT_READ_KEY = 'AUDIT_READ';
export const AuditRead = (action: string) => SetMetadata(AUDIT_READ_KEY, action);
