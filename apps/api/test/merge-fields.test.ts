import { describe, it, expect } from 'vitest';
import { mergeExternalIntoTorii } from '../src/sync/merge-fields.js';

describe('mergeExternalIntoTorii', () => {
  describe('field ownership', () => {
    it('default: name owned by monday — updates when external differs', () => {
      const patch = mergeExternalIntoTorii(
        { name: 'Old name', phase: 'Development', keyDates: {}, details: {} },
        { externalId: '1', name: 'New name' },
        {}, // empty mapping → defaults apply
      );
      expect(patch).toEqual({ name: 'New name' });
    });

    it('default: phase owned by monday — adopts the external phase when set', () => {
      const patch = mergeExternalIntoTorii(
        { name: 'Old', phase: 'Development', keyDates: {}, details: {} },
        { externalId: '1', phase: 'UAT' },
        {},
      );
      expect(patch).toEqual({ phase: 'UAT' });
    });

    it('phase: undefined external means no signal — never overwrite', () => {
      const patch = mergeExternalIntoTorii(
        { name: 'Old', phase: 'Development', keyDates: {}, details: {} },
        { externalId: '1' /* no phase */ },
        {},
      );
      expect(patch).not.toHaveProperty('phase');
    });

    it('explicit mapping phase=torii blocks the update even when external has a value', () => {
      const patch = mergeExternalIntoTorii(
        { name: 'Old', phase: 'Development', keyDates: {}, details: {} },
        { externalId: '1', phase: 'UAT' },
        { phase: 'torii' },
      );
      expect(patch).not.toHaveProperty('phase');
    });

    it('no-op when external phase matches existing', () => {
      const patch = mergeExternalIntoTorii(
        { name: 'Old', phase: 'UAT', keyDates: {}, details: {} },
        { externalId: '1', phase: 'UAT' },
        {},
      );
      expect(patch).toEqual({});
    });

    it('explicit mapping name=torii blocks the update even though external has a value', () => {
      const patch = mergeExternalIntoTorii(
        { name: 'Old', phase: 'Development', keyDates: {}, details: {} },
        { externalId: '1', name: 'New' },
        { name: 'torii' },
      );
      expect(patch).toEqual({});
    });

    it('explicit mapping name=monday allows the update', () => {
      const patch = mergeExternalIntoTorii(
        { name: 'Old', phase: 'Development', keyDates: {}, details: {} },
        { externalId: '1', name: 'New' },
        { name: 'monday' },
      );
      expect(patch).toEqual({ name: 'New' });
    });
  });

  describe('key_dates.*', () => {
    it('default mapping: external target_go_live is applied', () => {
      const patch = mergeExternalIntoTorii(
        { name: 'X', phase: 'Development', keyDates: { kickoff: '2026-06-01' }, details: {} },
        { externalId: '1', keyDates: { target_go_live: '2026-09-01' } },
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
          phase: 'Development',
          keyDates: { kickoff: '2026-06-01', actual_go_live: '2026-08-15' },
          details: {},
        },
        { externalId: '1', keyDates: { target_go_live: '2026-09-01' } },
        {},
      );
      expect(patch.keyDates).toEqual({
        kickoff: '2026-06-01',
        actual_go_live: '2026-08-15',
        target_go_live: '2026-09-01',
      });
    });

    it('applies every Monday-sourced key date in one patch', () => {
      const patch = mergeExternalIntoTorii(
        { name: 'X', phase: 'Development', keyDates: {}, details: {} },
        {
          externalId: '1',
          keyDates: {
            kickoff: '2026-01-05',
            project_start: '2026-02-10',
            uat_start: '2026-05-15',
            baseline_go_live: '2026-08-01',
            target_go_live: '2026-09-01',
            actual_go_live: '2026-09-04',
          },
        },
        {},
      );
      expect(patch.keyDates).toEqual({
        kickoff: '2026-01-05',
        project_start: '2026-02-10',
        uat_start: '2026-05-15',
        baseline_go_live: '2026-08-01',
        target_go_live: '2026-09-01',
        actual_go_live: '2026-09-04',
      });
    });

    it('skips when target_go_live owner is torii (but applies other monday-owned dates)', () => {
      const patch = mergeExternalIntoTorii(
        { name: 'X', phase: 'Development', keyDates: {}, details: {} },
        {
          externalId: '1',
          keyDates: { target_go_live: '2026-09-01', project_start: '2026-02-10' },
        },
        { 'key_dates.target_go_live': 'torii' },
      );
      expect(patch.keyDates).toEqual({ project_start: '2026-02-10' });
    });

    it('does not overwrite an existing key date that already matches', () => {
      const patch = mergeExternalIntoTorii(
        { name: 'X', phase: 'Development', keyDates: { target_go_live: '2026-09-01' }, details: {} },
        { externalId: '1', keyDates: { target_go_live: '2026-09-01' } },
        {},
      );
      expect(patch).toEqual({});
    });
  });

  describe('details.*', () => {
    it('default mapping: a monday-owned detail is applied when it differs', () => {
      const patch = mergeExternalIntoTorii(
        { name: 'X', phase: 'Development', keyDates: {}, details: { core_vendor: 'Old Core' } },
        { externalId: '1', details: { core_vendor: 'ARCU' } },
        {},
      );
      expect(patch.details).toEqual({ core_vendor: 'ARCU' });
    });

    it('shallow-merges over existing details, preserving untouched keys', () => {
      const patch = mergeExternalIntoTorii(
        {
          name: 'X',
          phase: 'Development',
          keyDates: {},
          details: { project_manager: 'Dana', primary_contact: 'Sam (manual)' },
        },
        { externalId: '1', details: { project_manager: 'Dana', customer_status: 'Active' } },
        {},
      );
      expect(patch.details).toEqual({
        project_manager: 'Dana',
        primary_contact: 'Sam (manual)',
        customer_status: 'Active',
      });
    });

    it('preserves a torii-owned detail (primary_contact default) even if external supplies one', () => {
      const patch = mergeExternalIntoTorii(
        { name: 'X', phase: 'Development', keyDates: {}, details: { primary_contact: 'Sam (manual)' } },
        { externalId: '1', details: { primary_contact: 'Someone from Monday' } },
        {}, // defaults: primary_contact is torii-owned
      );
      expect(patch).toEqual({});
    });

    it('respects an explicit per-key torii override', () => {
      const patch = mergeExternalIntoTorii(
        { name: 'X', phase: 'Development', keyDates: {}, details: { customer_status: 'Pinned' } },
        { externalId: '1', details: { customer_status: 'Changed' } },
        { 'details.customer_status': 'torii' },
      );
      expect(patch).toEqual({});
    });

    it('no detail patch when external matches existing', () => {
      const patch = mergeExternalIntoTorii(
        { name: 'X', phase: 'Development', keyDates: {}, details: { core_vendor: 'ARCU' } },
        { externalId: '1', details: { core_vendor: 'ARCU' } },
        {},
      );
      expect(patch).toEqual({});
    });

    it('no detail patch when external has no details', () => {
      const patch = mergeExternalIntoTorii(
        { name: 'X', phase: 'Development', keyDates: {}, details: { core_vendor: 'ARCU' } },
        { externalId: '1' },
        {},
      );
      expect(patch).toEqual({});
    });
  });

  describe('no-ops', () => {
    it('returns empty patch when external value matches existing', () => {
      const patch = mergeExternalIntoTorii(
        { name: 'Same name', phase: 'Development', keyDates: {}, details: {} },
        { externalId: '1', name: 'Same name' },
        {},
      );
      expect(patch).toEqual({});
    });

    it('returns empty patch when external value is undefined', () => {
      const patch = mergeExternalIntoTorii(
        { name: 'X', phase: 'Development', keyDates: {}, details: {} },
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
          phase: 'Development',
          keyDates: { target_go_live: '2026-09-01' },
          details: {},
        },
        { externalId: '1', name: 'New', keyDates: { target_go_live: '2026-10-01' } },
        { name: 'monday', 'key_dates.target_go_live': 'torii' },
      );
      expect(patch).toEqual({ name: 'New' });
    });
  });
});
