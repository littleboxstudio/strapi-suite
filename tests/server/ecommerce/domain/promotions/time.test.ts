import { describe, it, expect } from 'vitest';
import {
  zonedWallTimeToUtc,
  utcToZonedWallTime,
} from '../../../../../server/src/services/modules/ecommerce/domain/promotions';

const TZ = 'Europe/Lisbon';

describe('promotion time', () => {
  it('converts summer and winter wall times', () => {
    expect(zonedWallTimeToUtc('2026-07-01T10:00', TZ)).toBe('2026-07-01T09:00:00.000Z');
    expect(zonedWallTimeToUtc('2026-01-15T10:00', TZ)).toBe('2026-01-15T10:00:00.000Z');
  });
  it('moves a nonexistent (spring-forward) time forward', () => {
    expect(zonedWallTimeToUtc('2026-03-29T01:30', TZ)).toBe('2026-03-29T01:30:00.000Z');
  });
  it('uses the first occurrence of an ambiguous (autumn) time', () => {
    expect(zonedWallTimeToUtc('2026-10-25T01:30', TZ)).toBe('2026-10-25T00:30:00.000Z');
  });
  it('inverts', () => {
    expect(utcToZonedWallTime('2026-07-01T09:00:00.000Z', TZ)).toBe('2026-07-01T10:00');
    expect(utcToZonedWallTime('2026-01-15T10:00:00.000Z', TZ)).toBe('2026-01-15T10:00');
  });
  it('rejects invalid input', () => {
    expect(zonedWallTimeToUtc('2026-13-01T00:00', TZ)).toBeNull();
    expect(zonedWallTimeToUtc('2026-02-30T00:00', TZ)).toBeNull();
    expect(zonedWallTimeToUtc('nope', TZ)).toBeNull();
  });
  it('handles a zone behind UTC with a spring gap', () => {
    // New York 2026-03-08 02:30 does not exist -> 03:30 EDT = 07:30Z
    expect(zonedWallTimeToUtc('2026-03-08T02:30', 'America/New_York')).toBe('2026-03-08T07:30:00.000Z');
    // 2026-11-01 01:30 ambiguous -> first (EDT) = 05:30Z
    expect(zonedWallTimeToUtc('2026-11-01T01:30', 'America/New_York')).toBe('2026-11-01T05:30:00.000Z');
  });
});
