import { describe, it, expect } from 'vitest';
import {
  statusTone,
  usageLabel,
  validityLabel,
} from '../../../admin/src/ecommerce/utils/promotionList';

describe('usageLabel', () => {
  it('shows redemptions / limit with a limit', () => {
    expect(usageLabel({ redemptions: 3, usageLimit: 10 })).toBe('3 / 10');
    expect(usageLabel({ redemptions: 0, usageLimit: 1 })).toBe('0 / 1');
  });
  it('shows only redemptions without a limit', () => {
    expect(usageLabel({ redemptions: 7, usageLimit: null })).toBe('7');
  });
});

describe('statusTone', () => {
  it('maps the four states', () => {
    expect(statusTone('ACTIVE')).toBe('success');
    expect(statusTone('SCHEDULED')).toBe('primary');
    expect(statusTone('INACTIVE')).toBe('neutral');
    expect(statusTone('EXPIRED')).toBe('warning');
  });
  it('is neutral for an unknown status', () => {
    expect(statusTone('PAUSED')).toBe('neutral');
  });
});

describe('validityLabel', () => {
  it('shows only the start without endsAt', () => {
    const label = validityLabel({ startsAt: '2026-06-01T09:30', endsAt: null }, 'en');
    expect(label).toContain('2026');
    expect(label).not.toContain('–');
  });
  it('shows the store local time as is, without time zone shifts', () => {
    const label = validityLabel({ startsAt: '2026-06-01T09:30', endsAt: null }, 'en-GB');
    expect(label).toContain('09:30');
  });
  it('shows start and end', () => {
    const label = validityLabel({ startsAt: '2026-06-01T09:30', endsAt: '2026-06-30T23:59' }, 'en-GB');
    expect(label).toContain(' – ');
    expect(label).toContain('23:59');
  });
});
