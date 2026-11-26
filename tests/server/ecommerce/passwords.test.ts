import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@node-rs/argon2', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@node-rs/argon2')>();
  return { ...mod, verify: vi.fn(mod.verify) };
});

import { hash as rawHash, verify as rawVerify } from '@node-rs/argon2';
import EcommercePasswordService from '../../../server/src/services/modules/ecommerce/passwords';
import { EcommerceAccountsUnavailableError } from '../../../server/src/services/modules/ecommerce/errors';

const V1 = Buffer.alloc(32, 1);
const V2 = Buffer.alloc(32, 2);
const NAME1 = 'LTB_ECOMMERCE_PASSWORD_PEPPER_V1';
const NAME2 = 'LTB_ECOMMERCE_PASSWORD_PEPPER_V2';

const warn = vi.fn();
const make = () => EcommercePasswordService({ strapi: { log: { warn } } } as never);

describe('EcommercePasswordService', () => {
  beforeEach(() => {
    process.env[NAME1] = V1.toString('base64');
    delete process.env[NAME2];
    vi.mocked(rawVerify).mockClear();
    warn.mockClear();
  });
  afterEach(() => {
    delete process.env[NAME1];
    delete process.env[NAME2];
  });

  it('hashes with production parameters and verifies without rehash', async () => {
    const svc = make();
    const h = await svc.hash('correct horse battery');
    expect(h.hash.startsWith('$argon2id$v=19$m=65536,t=3,p=4$')).toBe(true);
    expect(h.pepperVersion).toBe(1);
    expect(await svc.verify(h, 'correct horse battery')).toEqual({ ok: true, rehash: null });
    expect((await svc.verify(h, 'wrong password!')).ok).toBe(false);
  });

  it('rehashes under the current pepper when an older version is used', async () => {
    const svc = make();
    const old = await svc.hash('correct horse battery');
    process.env[NAME2] = V2.toString('base64');
    const r = await svc.verify(old, 'correct horse battery');
    expect(r.ok).toBe(true);
    expect(r.rehash?.pepperVersion).toBe(2);
    expect(await svc.verify(r.rehash!, 'correct horse battery')).toEqual({ ok: true, rehash: null });
  });

  it('rehashes when the stored parameters are weaker', async () => {
    const svc = make();
    const weak = await rawHash('correct horse battery', {
      algorithm: 2,
      memoryCost: 65536,
      timeCost: 2,
      parallelism: 4,
      secret: V1,
    });
    const r = await svc.verify({ hash: weak, pepperVersion: 1 }, 'correct horse battery');
    expect(r.ok).toBe(true);
    expect(r.rehash).not.toBeNull();
  });

  it('answers not ok for a missing account, still running the verifier once', async () => {
    const svc = make();
    expect(await svc.verify(null, 'whatever password')).toEqual({ ok: false, rehash: null });
    expect(rawVerify).toHaveBeenCalledTimes(1);
    vi.mocked(rawVerify).mockClear();
    expect(await svc.verify({ hash: null, pepperVersion: null }, 'whatever password')).toEqual({ ok: false, rehash: null });
    expect(rawVerify).toHaveBeenCalledTimes(1);
  });

  it('makes a guest hash that nobody can match', async () => {
    const svc = make();
    const g = await svc.randomGuestHash();
    expect(g.hash.startsWith('$argon2id$')).toBe(true);
    expect(await rawVerify(g.hash, 'anything at all', { secret: V1 })).toBe(false);
  });

  it('throws unavailable when the stored pepper version is gone', async () => {
    const svc = make();
    const old = await svc.hash('correct horse battery');
    delete process.env[NAME1];
    process.env[NAME2] = V2.toString('base64');
    await expect(svc.verify(old, 'correct horse battery')).rejects.toBeInstanceOf(EcommerceAccountsUnavailableError);
    expect(warn).toHaveBeenCalledWith('[ecommerce:accounts] PEPPER_VERSION_MISSING v=1');
  });

  it('logs invalid peppers once per service with a count only', async () => {
    process.env[NAME2] = Buffer.alloc(8).toString('base64');
    const svc = make();
    await svc.hash('correct horse battery');
    await svc.hash('correct horse battery');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('[ecommerce:accounts] PEPPER_INVALID count=1');
  });

  it('throws unavailable without peppers', async () => {
    delete process.env[NAME1];
    const svc = make();
    expect(svc.available()).toBe(false);
    await expect(svc.hash('correct horse battery')).rejects.toBeInstanceOf(EcommerceAccountsUnavailableError);
    await expect(svc.verify(null, 'x')).rejects.toBeInstanceOf(EcommerceAccountsUnavailableError);
    await expect(svc.randomGuestHash()).rejects.toBeInstanceOf(EcommerceAccountsUnavailableError);
  });
});
