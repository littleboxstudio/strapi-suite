import crypto from 'crypto';
import { hash as argonHash, verify as argonVerify, Algorithm } from '@node-rs/argon2';
import { readPeppers } from './domain/accounts/peppers';
import { createSemaphore } from './domain/accounts/semaphore';
import { EcommerceAccountsUnavailableError } from './errors';

const MEMORY_COST = 65536;
const TIME_COST = 3;
const PARALLELISM = 4;
const CONCURRENCY = 4;
const QUEUE = 16;

export type PasswordHash = { hash: string; pepperVersion: number };

/** True when the PHC string was made with exactly the current Argon2id parameters. */
const hasCurrentParams = (phc: string): boolean => {
  const m = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$/.exec(phc);
  return !!m && Number(m[1]) === MEMORY_COST && Number(m[2]) === TIME_COST && Number(m[3]) === PARALLELISM;
};

const EcommercePasswordService = (_deps?: unknown) => {
  const semaphore = createSemaphore(CONCURRENCY, QUEUE);
  const dummies = new Map<number, string>();

  const peppers = () => {
    const p = readPeppers(process.env);
    if (!p) throw new EcommerceAccountsUnavailableError();
    return p;
  };

  const hashWith = (password: string, secret: Buffer): Promise<string> =>
    semaphore.run(() =>
      argonHash(password.normalize('NFC'), {
        algorithm: Algorithm.Argon2id,
        memoryCost: MEMORY_COST,
        timeCost: TIME_COST,
        parallelism: PARALLELISM,
        secret,
      })
    );

  const hash = async (password: string): Promise<PasswordHash> => {
    const p = peppers();
    return { hash: await hashWith(password, p.byVersion.get(p.current)!), pepperVersion: p.current };
  };

  const dummyHash = async (version: number, secret: Buffer): Promise<string> => {
    let d = dummies.get(version);
    if (!d) {
      d = await hashWith(crypto.randomBytes(24).toString('base64url'), secret);
      dummies.set(version, d);
    }
    return d;
  };

  return {
    available: (): boolean => readPeppers(process.env) !== null,

    hash,

    async verify(
      stored: { hash: string | null; pepperVersion: number | null } | null,
      password: string
    ): Promise<{ ok: boolean; rehash: PasswordHash | null }> {
      const p = peppers();
      const currentSecret = p.byVersion.get(p.current)!;

      if (!stored || !stored.hash || stored.pepperVersion == null) {
        // Same work as a real check, so timing does not reveal whether the account exists.
        const d = await dummyHash(p.current, currentSecret);
        await semaphore.run(() => argonVerify(d, password.normalize('NFC'), { secret: currentSecret }).catch(() => false));
        return { ok: false, rehash: null };
      }

      const secret = p.byVersion.get(stored.pepperVersion);
      if (!secret) {
        // The pepper this hash was made with is gone: it can no longer be checked.
        const d = await dummyHash(p.current, currentSecret);
        await semaphore.run(() => argonVerify(d, password.normalize('NFC'), { secret: currentSecret }).catch(() => false));
        return { ok: false, rehash: null };
      }

      const ok = await semaphore.run(() =>
        argonVerify(stored.hash as string, password.normalize('NFC'), { secret }).catch(() => false)
      );
      if (!ok) return { ok: false, rehash: null };
      const stale = stored.pepperVersion !== p.current || !hasCurrentParams(stored.hash);
      return { ok: true, rehash: stale ? await hash(password) : null };
    },

    /** A hash of random bytes nobody knows, for guest customers that have no password. */
    randomGuestHash: (): Promise<PasswordHash> => hash(crypto.randomBytes(32).toString('base64url')),
  };
};

export default EcommercePasswordService;
