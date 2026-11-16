import { describe, it, expect } from 'vitest';
import {
  storefrontBasePath,
  storefrontTokenActions,
  tokenWarnings,
  validateTtlHours,
} from '../../../admin/src/ecommerce/utils/storefrontSettings';
import { SETTINGS_SECTIONS } from '../../../admin/src/ecommerce/utils/settingsSections';

const NOW = new Date('2026-11-11T12:00:00.000Z');
const days = (n: number) => new Date(NOW.getTime() + n * 86400000).toISOString();

describe('tokenWarnings: one warning', () => {
  it('has no warning without a token', () => {
    expect(tokenWarnings(null, NOW)).toEqual([]);
  });
  it('warns for full-access and read-only tokens', () => {
    expect(tokenWarnings({ type: 'full-access', expiresAt: null }, NOW)).toEqual(['FULL_ACCESS']);
    expect(tokenWarnings({ type: 'read-only', expiresAt: null }, NOW)).toEqual(['READ_ONLY']);
  });
  it('warns for expired and soon-to-expire tokens', () => {
    expect(tokenWarnings({ type: 'custom', expiresAt: days(-1) }, NOW)).toEqual(['EXPIRED']);
    expect(tokenWarnings({ type: 'custom', expiresAt: days(3) }, NOW)).toEqual(['EXPIRES_SOON']);
    expect(tokenWarnings({ type: 'custom', expiresAt: days(14) }, NOW)).toEqual([]);
  });
  it('has no warning for a custom token without expiry', () => {
    expect(tokenWarnings({ type: 'custom', expiresAt: null }, NOW)).toEqual([]);
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

describe('storefrontTokenActions', () => {
  const token = { id: 3, name: 'BFF', description: null, type: 'custom' as const, createdAt: null, lastUsedAt: null, expiresAt: null };
  it('offers Generate only when no token exists', () => {
    expect(storefrontTokenActions({ token: null, missing: false }, false)).toEqual({ generate: true, regenerate: false });
    expect(storefrontTokenActions({ token: null, missing: true }, false)).toEqual({ generate: true, regenerate: false });
  });
  it('offers Regenerate once a token exists', () => {
    expect(storefrontTokenActions({ token, missing: false }, false)).toEqual({ generate: false, regenerate: true });
  });
  it('offers nothing to read-only users', () => {
    expect(storefrontTokenActions({ token: null, missing: false }, true)).toEqual({ generate: false, regenerate: false });
    expect(storefrontTokenActions({ token, missing: false }, true)).toEqual({ generate: false, regenerate: false });
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
