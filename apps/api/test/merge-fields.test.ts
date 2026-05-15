import { describe, it, expect } from 'vitest';
import { mergeExternalIntoTorii } from '../src/sync/merge-fields.js';

describe('mergeExternalIntoTorii', () => {
  describe('field ownership', () => {
    it('default: name owned by monday — updates when external differs', () => {
      const patch = mergeExternalIntoTorii(
        { name: 'Old name', keyDates: {} },
        { externalId: '1', name: 'New name' },
        {}, // empty mapping → defaults apply
      );
      expect(patch).toEqual({ name: 'New name' });
    });

    it('default: phase owned by torii — even with no mapping, phase is never patched', () => {
      // mergeExternalIntoTorii doesn't currently expose phase as a mappable
      // external field; this test pins that fact by ensuring an external with
      // a name change does NOT include phase in the patch.
      const patch = mergeExternalIntoTorii(
        { name: 'Old', keyDates: {} },
        { externalId: '1', name: 'New' },
        {},
      );
      expect(patch).not.toHaveProperty('phase');
    });

    it('explicit mapping name=torii blocks the update even though external has a value', () => {
      const patch = mergeExternalIntoTorii(
        { name: 'Old', keyDates: {} },
        { externalId: '1', name: 'New' },
        { name: 'torii' },
      );
      expect(patch).toEqual({});
    });

    it('explicit mapping name=monday allows the update', () => {
      const patch = mergeExternalIntoTorii(
        { name: 'Old', keyDates: {} },
        { externalId: '1', name: 'New' },
        { name: 'monday' },
      );
      expect(patch).toEqual({ name: 'New' });
    });
  });

  describe('key_dates.target_go_live', () => {
    it('default mapping: external target_go_live is applied', () => {
      const patch = mergeExternalIntoTorii(
        { name: 'X', keyDates: { kickoff: '2026-06-01' } },
        { externalId: '1', targetGoLive: '2026-09-01' },
        {},
      );
      expect(patch.keyDates).toEqual({
        kickoff: '2026-06-01',
        target_go_live: '2026-09-01',
      });
    });

    it('preserves other keyDates fields when patching target_go_live', () => {
      const patch = mergeExternalIntoTorii(
        {
          name: 'X',
          keyDates: { kickoff: '2026-06-01', actual_go_live: '2026-08-15' },
        },
        { externalId: '1', targetGoLive: '2026-09-01' },
        {},
      );
      expect(patch.keyDates).toEqual({
        kickoff: '2026-06-01',
        actual_go_live: '2026-08-15',
        target_go_live: '2026-09-01',
      });
    });

    it('skips when target_go_live owner is torii', () => {
      const patch = mergeExternalIntoTorii(
        { name: 'X', keyDates: {} },
        { externalId: '1', targetGoLive: '2026-09-01' },
        { 'key_dates.target_go_live': 'torii' },
      );
      expect(patch).toEqual({});
    });
  });

  describe('no-ops', () => {
    it('returns empty patch when external value matches existing', () => {
      const patch = mergeExternalIntoTorii(
        { name: 'Same name', keyDates: {} },
        { externalId: '1', name: 'Same name' },
        {},
      );
      expect(patch).toEqual({});
    });

    it('returns empty patch when external value is undefined', () => {
      const patch = mergeExternalIntoTorii(
        { name: 'X', keyDates: {} },
        { externalId: '1' },
        {},
      );
      expect(patch).toEqual({});
    });
  });

  describe('mixed mapping', () => {
    it('applies name (monday-owned) but skips target_go_live (torii-owned)', () => {
      const patch = mergeExternalIntoTorii(
        {
          name: 'Old',
          keyDates: { target_go_live: '2026-09-01' },
        },
        { externalId: '1', name: 'New', targetGoLive: '2026-10-01' },
        { name: 'monday', 'key_dates.target_go_live': 'torii' },
      );
      expect(patch).toEqual({ name: 'New' });
    });
  });
});
