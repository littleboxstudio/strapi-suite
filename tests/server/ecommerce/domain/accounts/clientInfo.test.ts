import { describe, expect, it } from 'vitest';
import {
  ipPrefix,
  truncateUserAgent,
} from '../../../../../server/src/services/modules/ecommerce/domain/accounts/clientInfo';

describe('ipPrefix', () => {
  it('keeps the /24 of an IPv4 address', () => {
    expect(ipPrefix('203.0.113.77')).toBe('203.0.113.0/24');
  });
  it('keeps the /48 of an IPv6 address', () => {
    expect(ipPrefix('2001:db8:abcd:12::1')).toBe('2001:db8:abcd::/48');
    expect(ipPrefix('2001:0DB8:abcd::1')).toBe('2001:db8:abcd::/48');
    expect(ipPrefix('::1')).toBe('0:0:0::/48');
  });
  it('gives null for garbage', () => {
    for (const v of [null, '', 'nope', '999.1.1.1', '1.2.3', '12345::1', '1::2::3'])
      expect(ipPrefix(v as string | null)).toBeNull();
  });
});

describe('truncateUserAgent', () => {
  it('truncates to 255 and rejects non-strings', () => {
    expect(truncateUserAgent('a'.repeat(300))).toHaveLength(255);
    expect(truncateUserAgent('Mozilla')).toBe('Mozilla');
    expect(truncateUserAgent(undefined)).toBeNull();
    expect(truncateUserAgent(5)).toBeNull();
    expect(truncateUserAgent('  ')).toBeNull();
  });
});
