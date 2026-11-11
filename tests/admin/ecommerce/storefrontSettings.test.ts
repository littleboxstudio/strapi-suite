import { describe, it, expect } from 'vitest';
import {
  storefrontBasePath,
  isTokenMissing,
  tokenWarning,
  tokenWarnings,
  validateTtlHours,
} from '../../../admin/src/ecommerce/utils/storefrontSettings';
import { SETTINGS_SECTIONS } from '../../../admin/src/ecommerce/utils/settingsSections';

const NOW = new Date('2026-11-11T12:00:00.000Z');
const days = (n: number) => new Date(NOW.getTime() + n * 86400000).toISOString();

describe('tokenWarning', () => {
  it('has no warning without a token', () => {
    expect(tokenWarning(null, NOW)).toBeNull();
  });
  it('warns for full-access and read-only tokens', () => {
    expect(tokenWarning({ type: 'full-access', expiresAt: null }, NOW)).toBe('FULL_ACCESS');
    expect(tokenWarning({ type: 'read-only', expiresAt: null }, NOW)).toBe('READ_ONLY');
  });
  it('warns for expired and soon-to-expire tokens', () => {
    expect(tokenWarning({ type: 'custom', expiresAt: days(-1) }, NOW)).toBe('EXPIRED');
    expect(tokenWarning({ type: 'custom', expiresAt: days(3) }, NOW)).toBe('EXPIRES_SOON');
    expect(tokenWarning({ type: 'custom', expiresAt: days(14) }, NOW)).toBeNull();
  });
  it('has no warning for a custom token without expiry', () => {
    expect(tokenWarning({ type: 'custom', expiresAt: null }, NOW)).toBeNull();
  });
});

describe('tokenWarnings', () => {
  it('lists expiry and access-type warnings together', () => {
    expect(tokenWarnings({ type: 'full-access', expiresAt: days(3) }, NOW)).toEqual(['EXPIRES_SOON', 'FULL_ACCESS']);
    expect(tokenWarnings({ type: 'read-only', expiresAt: days(-1) }, NOW)).toEqual(['EXPIRED', 'READ_ONLY']);
    expect(tokenWarnings({ type: 'custom', expiresAt: null }, NOW)).toEqual([]);
    expect(tokenWarnings(null, NOW)).toEqual([]);
  });
});

describe('isTokenMissing', () => {
  it('is true only for a saved id that is not in the list', () => {
    expect(isTokenMissing(null, [])).toBe(false);
    expect(isTokenMissing(5, [{ id: 5 }])).toBe(false);
    expect(isTokenMissing(5, [{ id: 6 }])).toBe(true);
    expect(isTokenMissing(5, [])).toBe(true);
  });
});

describe('validateTtlHours', () => {
  it('parses whole hours from 1 to 720', () => {
    expect(validateTtlHours('24')).toBe(24);
    expect(validateTtlHours(' 720 ')).toBe(720);
    expect(validateTtlHours('1')).toBe(1);
  });
  it('rejects everything else', () => {
    for (const raw of ['0', 'abc', '', '721', '1.5', '-3']) {
      expect(validateTtlHours(raw)).toBe('invalid_number');
    }
  });
});

describe('storefront section', () => {
  it('is the second section and the base path is fixed', () => {
    expect(SETTINGS_SECTIONS[1]).toBe('storefront');
    expect(storefrontBasePath).toBe('/api/littlebox-strapi-suite/ecommerce/storefront');
  });
});
