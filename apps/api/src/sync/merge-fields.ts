import {
  DEFAULT_FIELD_MAPPING,
  PROJECT_DETAIL_KEYS,
  type ExternalProject,
  type FieldOwner,
  type Phase,
} from '@torii/shared';

export interface ExistingProjectSlice {
  name: string;
  phase: Phase;
  keyDates: Record<string, string | undefined> | null;
  details: Record<string, string | undefined> | null;
}

export interface MergePatch {
  name?: string;
  phase?: Phase;
  keyDates?: Record<string, string | undefined>;
  details?: Record<string, string | undefined>;
}

/**
 * Given the current Torii project, an `ExternalProject` from a tracker adapter,
 * and a per-project `fieldMapping`, compute the patch to apply.
 *
 * Rules:
 *  - For each known field, look up its owner from `fieldMapping`, falling back
 *    to `DEFAULT_FIELD_MAPPING`.
 *  - If the owner is the tracker (e.g., `'monday'`), apply the external value
 *    when present.
 *  - If the owner is `'torii'`, leave the field unchanged (omit from patch).
 *  - External values that are `undefined` mean "no signal" — never overwrite.
 */
export function mergeExternalIntoTorii(
  existing: ExistingProjectSlice,
  external: ExternalProject,
  fieldMapping: Record<string, FieldOwner> | null | undefined,
): MergePatch {
  const lookup = (field: string): FieldOwner =>
    fieldMapping?.[field] ?? DEFAULT_FIELD_MAPPING[field] ?? 'torii';

  const patch: MergePatch = {};

  // name
  if (external.name !== undefined && lookup('name') !== 'torii') {
    if (external.name !== existing.name) {
      patch.name = external.name;
    }
  }

  // phase — Monday-owned by default. Skip when the adapter couldn't resolve a value
  // (`external.phase === undefined`) so we never overwrite a real value with nothing.
  if (external.phase !== undefined && lookup('phase') !== 'torii') {
    if (external.phase !== existing.phase) {
      patch.phase = external.phase;
    }
  }

  // key_dates.* — per-key ownership. Apply any external date whose owner is not Torii
  // and whose value differs from what's stored. Empty external map → no signal.
  const existingKeyDates = existing.keyDates ?? {};
  const keyDateUpdates: Record<string, string> = {};
  for (const [key, externalValue] of Object.entries(external.keyDates ?? {})) {
    if (externalValue === undefined) continue;
    if (lookup(`key_dates.${key}`) === 'torii') continue;
    if (externalValue !== existingKeyDates[key]) {
      keyDateUpdates[key] = externalValue;
    }
  }
  if (Object.keys(keyDateUpdates).length > 0) {
    patch.keyDates = { ...existingKeyDates, ...keyDateUpdates };
  }

  // details.* — only Monday-owned keys with a changed external value are applied,
  // shallow-merged over the existing details so torii-owned keys survive.
  const existingDetails = existing.details ?? {};
  const detailUpdates: Record<string, string> = {};
  for (const key of PROJECT_DETAIL_KEYS) {
    const externalValue = external.details?.[key];
    if (externalValue === undefined) continue; // no signal from the tracker
    if (lookup(`details.${key}`) === 'torii') continue; // PM-owned, never overwrite
    if (externalValue !== existingDetails[key]) {
      detailUpdates[key] = externalValue;
    }
  }
  if (Object.keys(detailUpdates).length > 0) {
    patch.details = { ...existingDetails, ...detailUpdates };
  }

  return patch;
}
