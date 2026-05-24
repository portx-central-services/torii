import {
  DEFAULT_FIELD_MAPPING,
  type ExternalProject,
  type FieldOwner,
} from '@torii/shared';

export interface ExistingProjectSlice {
  name: string;
  keyDates: Record<string, string | undefined> | null;
}

export interface MergePatch {
  name?: string;
  keyDates?: Record<string, string | undefined>;
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
      // patch.name = external.name;
      patch.name = external.name;
    }
  }

  // key_dates.target_go_live
  if (
    external.targetGoLive !== undefined &&
    lookup('key_dates.target_go_live') !== 'torii'
  ) {
    const existingTarget = existing.keyDates?.target_go_live;
    if (external.targetGoLive !== existingTarget) {
      patch.keyDates = {
        ...(existing.keyDates ?? {}),
        target_go_live: external.targetGoLive,
      };
    }
  }

  return patch;
}
