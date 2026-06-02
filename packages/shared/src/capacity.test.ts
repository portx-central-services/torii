import { describe, it, expect } from 'vitest';
import {
  plannedHoursForAllocation,
  varianceBucket,
  weeksBetween,
} from './capacity.js';

describe('weeksBetween', () => {
  it('counts exact weeks', () => {
    expect(weeksBetween('2026-06-01', '2026-06-08')).toBe(1);
    expect(weeksBetween('2026-06-01', '2026-07-27')).toBe(8);
  });
  it('allows fractional weeks', () => {
    // 2026-06-01 to 2026-06-04 is 3 days = 3/7 weeks
    expect(weeksBetween('2026-06-01', '2026-06-04')).toBeCloseTo(3 / 7, 5);
  });
  it('returns 0 for inverted or zero-length ranges', () => {
    expect(weeksBetween('2026-06-08', '2026-06-01')).toBe(0);
    expect(weeksBetween('2026-06-01', '2026-06-01')).toBe(0);
  });
  it('returns 0 for invalid date strings', () => {
    expect(weeksBetween('not-a-date', '2026-06-08')).toBe(0);
  });
});

describe('plannedHoursForAllocation', () => {
  it('standard 50% over 8 weeks at full capacity = 160h', () => {
    const hours = plannedHoursForAllocation({
      pct: 50,
      defaultCapacityPct: 100,
      startISO: '2026-06-01',
      endISO: '2026-07-27', // 8 weeks
    });
    expect(hours).toBe(160);
  });

  it('part-time person scales the planned hours', () => {
    // 100% allocation, 4 weeks, person at 50% default capacity → 80h
    const hours = plannedHoursForAllocation({
      pct: 100,
      defaultCapacityPct: 50,
      startISO: '2026-06-01',
      endISO: '2026-06-29',
    });
    expect(hours).toBe(80);
  });

  it('fractional weeks are not floored', () => {
    // 3.5 weeks at full capacity, 100% allocation → 140h
    const hours = plannedHoursForAllocation({
      pct: 100,
      defaultCapacityPct: 100,
      startISO: '2026-06-01',
      endISO: '2026-06-25', // 24 days = 24/7 ≈ 3.4286 weeks
    });
    expect(hours).toBeCloseTo((24 / 7) * 40, 5);
  });

  it('zero-length range returns 0', () => {
    expect(
      plannedHoursForAllocation({
        pct: 100,
        defaultCapacityPct: 100,
        startISO: '2026-06-01',
        endISO: '2026-06-01',
      }),
    ).toBe(0);
  });
});

describe('varianceBucket', () => {
  it('within 10% is green', () => {
    expect(varianceBucket(100, 105)).toBe('green');
    expect(varianceBucket(100, 95)).toBe('green');
    expect(varianceBucket(100, 110)).toBe('green'); // boundary inclusive
  });
  it('between 10% and 25% is amber', () => {
    expect(varianceBucket(100, 120)).toBe('amber');
    expect(varianceBucket(100, 80)).toBe('amber');
    expect(varianceBucket(100, 125)).toBe('amber'); // boundary inclusive
  });
  it('over 25% is red (signed direction does not matter)', () => {
    expect(varianceBucket(100, 130)).toBe('red');
    expect(varianceBucket(100, 70)).toBe('red');
  });
  it('null actual is neutral (no Harvest link)', () => {
    expect(varianceBucket(100, null)).toBe('neutral');
  });
  it('zero planned is neutral (cannot compute %)', () => {
    expect(varianceBucket(0, 5)).toBe('neutral');
    expect(varianceBucket(0, null)).toBe('neutral');
  });
});
