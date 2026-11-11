import { createHash } from 'crypto';
import { afterEach, describe, expect, it } from 'vitest';
import {
  decryptSecret,
  encryptSecret,
  isMaskedEcho,
  maskSecret,
  resolveEncryptionKey,
} from '../../../server/src/services/modules/ecommerce/secrets';

const key = createHash('sha256').update('k1').digest();
const otherKey = createHash('sha256').update('k2').digest();
const strapiWith = (cfg: any) => ({ config: { get: () => cfg } }) as any;

describe('secrets', () => {
  const original = process.env.LTB_ECOMMERCE_ENCRYPTION_KEY;
  afterEach(() => {
    if (original === undefined) delete process.env.LTB_ECOMMERCE_ENCRYPTION_KEY;
    else process.env.LTB_ECOMMERCE_ENCRYPTION_KEY = original;
  });

  it('round-trips with the same key', () => {
    expect(decryptSecret(encryptSecret('sk_live_x', key), key)).toBe('sk_live_x');
  });

  it('produces different iv/data for the same plaintext', () => {
    const a = encryptSecret('same', key);
    const b = encryptSecret('same', key);
    expect(a.iv).not.toBe(b.iv);
    expect(a.data).not.toBe(b.data);
  });

  it('fails with the wrong key', () => {
    expect(() => decryptSecret(encryptSecret('x', key), otherKey)).toThrow(
      expect.objectContaining({ code: 'SECRET_UNREADABLE' })
    );
  });

  it('fails when data is tampered', () => {
    const enc = encryptSecret('hello world', key);
    const data = Buffer.from(enc.data, 'base64');
    data[0] ^= 0xff;
    expect(() => decryptSecret({ ...enc, data: data.toString('base64') }, key)).toThrow(
      expect.objectContaining({ code: 'SECRET_UNREADABLE' })
    );
  });

  it.each([4, 8, 12, 15])('rejects an authentication tag truncated to %i bytes', (len) => {
    const enc = encryptSecret('hello world', key);
    const tag = Buffer.from(enc.tag, 'base64').subarray(0, len).toString('base64');
    expect(() => decryptSecret({ ...enc, tag }, key)).toThrow(
      expect.objectContaining({ code: 'SECRET_UNREADABLE' })
    );
  });

  it('masks secrets', () => {
    expect(maskSecret('sk_test_1234567890abcd')).toBe('sk_********abcd');
    expect(maskSecret('short')).toBe('********');
    expect(isMaskedEcho('sk_********abcd', 'sk_test_1234567890abcd')).toBe(true);
    expect(isMaskedEcho('sk_test_other', 'sk_test_1234567890abcd')).toBe(false);
  });

  it('resolveEncryptionKey returns null when config and env are missing or blank', () => {
    delete process.env.LTB_ECOMMERCE_ENCRYPTION_KEY;
    expect(resolveEncryptionKey(strapiWith({}))).toBeNull();
    expect(resolveEncryptionKey(strapiWith({ ecommerce: { encryptionKey: '  ' } }))).toBeNull();
    process.env.LTB_ECOMMERCE_ENCRYPTION_KEY = '   ';
    expect(resolveEncryptionKey(strapiWith({}))).toBeNull();
  });

  it('resolveEncryptionKey derives sha256 from env and prefers config', () => {
    process.env.LTB_ECOMMERCE_ENCRYPTION_KEY = 'abc';
    const k = resolveEncryptionKey(strapiWith({}))!;
    expect(k).toHaveLength(32);
    expect(k.equals(createHash('sha256').update('abc').digest())).toBe(true);
    const c = resolveEncryptionKey(strapiWith({ ecommerce: { encryptionKey: 'cfg' } }))!;
    expect(c.equals(createHash('sha256').update('cfg').digest())).toBe(true);
  });
});
