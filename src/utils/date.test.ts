import { describe, expect, it } from 'vitest';
import { bangkokTodayIso, formatDate } from '@/utils/date';

describe('formatDate', () => {
  it('formats an ISO date in the Thai locale and Buddhist era', () => {
    const formatted = formatDate('2026-10-25');
    expect(formatted).toContain('2569');
    expect(formatted).toContain('ต.ค.');
  });

  it('returns a dash for nullish or blank values', () => {
    expect(formatDate(null)).toBe('-');
    expect(formatDate(undefined)).toBe('-');
    expect(formatDate('')).toBe('-');
  });
});

describe('bangkokTodayIso', () => {
  it('returns an ISO calendar date', () => {
    expect(bangkokTodayIso()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
