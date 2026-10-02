import type { AuditEntry } from '@/data/types';

/** "view_record" → "Viewed record"; any other action code in words ("record_visit" → "Record visit"). */
export function auditActionLabel(action: string) {
  if (action === 'view_record') return 'Viewed record';
  const words = action.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * The entries of one pregnancy's record: opened (view_record names the pregnancy or one of its babies by id) or
 * changed (every server entry carries the mother it is about). The demo store names the record by id or MCH id.
 * `keys`: the pregnancy id, its MCH id and its babies' ids.
 */
export function recordEntries(audit: AuditEntry[], keys: ReadonlySet<string>, motherId: string): AuditEntry[] {
  return audit.filter((a) => keys.has(a.entityId ?? a.entity) || (a.action !== 'view_record' && a.motherId === motherId));
}
