import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CLIENT_IP_HEADER,
  clientIpFrom,
  sanitizeSearchTerm,
} from '../../../../../server/src/services/modules/ecommerce/domain/storefront/request';

describe('clientIpFrom', () => {
  it('reads the header set by the BFF', () => {
    expect(CLIENT_IP_HEADER).toBe('x-storefront-client-ip');
    expect(clientIpFrom('203.0.113.7')).toBe('203.0.113.7');
    expect(clientIpFrom(' 203.0.113.7 ')).toBe('203.0.113.7');
    expect(clientIpFrom('2001:db8::1')).toBe('2001:db8::1');
  });

  it('accepts only a single valid IP', () => {
    for (const bad of ['203.0.113.7, 10.0.0.1', 'fe80::1%eth0', 'not-an-ip', '', '   ', undefined, null, 42, ['203.0.113.7']]) {
      expect(clientIpFrom(bad)).toBeNull();
    }
  });

  it('never reads X-Forwarded-For', () => {
    const source = readFileSync(
      resolve(__dirname, '../../../../../server/src/services/modules/ecommerce/domain/storefront/request.ts'),
      'utf8'
    );
    expect(source.toLowerCase()).not.toContain('x-forwarded-for');
    expect(source.toLowerCase()).not.toContain('forwarded');
  });
});

describe('sanitizeSearchTerm', () => {
  it('drops LIKE wildcards and backslashes', () => {
    expect(sanitizeSearchTerm(' 50%_off\\ ')).toBe('50off');
  });

  it('caps at 100 characters and ignores non-strings', () => {
    expect(sanitizeSearchTerm('a'.repeat(150))).toHaveLength(100);
    expect(sanitizeSearchTerm(undefined)).toBe('');
    expect(sanitizeSearchTerm(['x'])).toBe('');
    expect(sanitizeSearchTerm(' % ')).toBe('');
  });
});
