import { afterEach, describe, expect, it, vi } from 'vitest';
import { readPeppers } from '../../../../../server/src/services/modules/ecommerce/domain/accounts/peppers';

const b64 = (n: number, fill = 1) => Buffer.alloc(n, fill).toString('base64');

describe('readPeppers', () => {
  afterEach(() => vi.restoreAllMocks());

  it('picks the highest version as current and keeps all', () => {
    const p = readPeppers({
      LTB_ECOMMERCE_PASSWORD_PEPPER_V1: b64(32, 1),
      LTB_ECOMMERCE_PASSWORD_PEPPER_V3: b64(48, 3),
      OTHER: 'x',
    })!;
    expect(p.current).toBe(3);
    expect([...p.byVersion.keys()].sort()).toEqual([1, 3]);
    expect(p.byVersion.get(3)!.length).toBe(48);
  });
  it('ignores short values and warns once without values', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const short = b64(16);
    const p = readPeppers({ LTB_ECOMMERCE_PASSWORD_PEPPER_V1: b64(32), LTB_ECOMMERCE_PASSWORD_PEPPER_V2: short })!;
    expect(p.current).toBe(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).not.toContain(short);
  });
  it('ignores non-base64 values', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(readPeppers({ LTB_ECOMMERCE_PASSWORD_PEPPER_V1: '!!!not base64!!!'.repeat(5) })).toBeNull();
  });
  it('returns null with no variable', () => {
    expect(readPeppers({})).toBeNull();
  });
});
