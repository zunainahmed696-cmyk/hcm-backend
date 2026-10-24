import { AuditLog } from '../models/AuditLog';
import { JWTPayload } from '../types';

interface AuditInput {
  actor?: JWTPayload | null;
  action: string;
  entity: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
}

/** Writes an audit entry. Never throws: auditing must not break the main action. */
export const recordAudit = async ({ actor, action, entity, entityId, before, after }: AuditInput): Promise<void> => {
  try {
    await AuditLog.create({
      actorId: actor?.userId ?? null,
      actorEmail: actor?.email ?? 'system',
      actorRole: actor?.role ?? 'system',
      action,
      entity,
      entityId,
      before: before ?? null,
      after: after ?? null,
    });
  } catch (err) {
    console.error('[Audit] failed to write entry', err);
  }
};
