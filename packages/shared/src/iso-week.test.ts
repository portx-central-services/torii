import { describe, it, expect } from 'vitest';
import { isoWeekStart, isoWeeksBetween, isoDateUtc, rangesOverlap } from './iso-week.js';

describe('isoWeekStart', () => {
  it('returns the same date when given a Monday', () => {
    const monday = new Date('2026-06-01T00:00:00Z'); // Monday
    expect(isoDateUtc(isoWeekStart(monday))).toBe('2026-06-01');
  });

  it('returns the previous Monday for a mid-week date', () => {
    const wednesday = new Date('2026-06-03T12:34:56Z');
    expect(isoDateUtc(isoWeekStart(wednesday))).toBe('2026-06-01');
  });

  it('returns the previous Monday for a Sunday', () => {
    const sunday = new Date('2026-06-07T00:00:00Z');
    expect(isoDateUtc(isoWeekStart(sunday))).toBe('2026-06-01');
  });

  it('handles year boundaries', () => {
    const jan1 = new Date('2027-01-01T00:00:00Z'); // Friday
    expect(isoDateUtc(isoWeekStart(jan1))).toBe('2026-12-28');
  });
});

describe('isoWeeksBetween', () => {
  it('returns one week when both bounds fall in the same week', () => {
    const weeks = isoWeeksBetween(
      new Date('2026-06-02T00:00:00Z'),
      new Date('2026-06-05T00:00:00Z'),
    );
    expect(weeks).toHaveLength(1);
    expect(isoDateUtc(weeks[0]!)).toBe('2026-06-01');
  });

  it('returns 12 weeks for a 12-week window starting Monday', () => {
    const weeks = isoWeeksBetween(
      new Date('2026-06-01T00:00:00Z'),
      new Date('2026-08-23T23:59:59Z'),
    );
    expect(weeks).toHaveLength(12);
    expect(isoDateUtc(weeks[0]!)).toBe('2026-06-01');
    expect(isoDateUtc(weeks[11]!)).toBe('2026-08-17');
  });

  it('returns [] when to < from', () => {
    expect(
      isoWeeksBetween(new Date('2026-06-10'), new Date('2026-06-01')),
    ).toEqual([]);
  });
});

describe('rangesOverlap', () => {
  it('returns true when ranges touch at edges', () => {
    expect(
      rangesOverlap(
        new Date('2026-06-01'),
        new Date('2026-06-15'),
        new Date('2026-06-15'),
        new Date('2026-06-20'),
      ),
    ).toBe(true);
  });

  it('returns false when ranges are disjoint', () => {
    expect(
      rangesOverlap(
        new Date('2026-06-01'),
        new Date('2026-06-10'),
        new Date('2026-06-11'),
        new Date('2026-06-20'),
      ),
    ).toBe(false);
  });
});
