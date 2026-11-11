import { describe, it, expect } from 'vitest';
import {
  isTransientTxConflict,
  isUniqueViolation,
} from '../../../server/src/services/modules/ecommerce/dbErrors';

const err = (props: Record<string, unknown>, message = 'db error') =>
  Object.assign(new Error(message), props);

describe('isTransientTxConflict', () => {
  it.each([
    [
      'MariaDB ER_CHECKREAD',
      err(
        { errno: 1020, code: 'ER_CHECKREAD', sqlState: 'HY000' },
        "Record has changed since last read in table 'ltb_st_module_ecommerce_orders'"
      ),
    ],
    ['MySQL deadlock', err({ errno: 1213, code: 'ER_LOCK_DEADLOCK', sqlState: '40001' })],
    ['MySQL lock wait timeout', err({ errno: 1205, code: 'ER_LOCK_WAIT_TIMEOUT' })],
    ['PostgreSQL serialization_failure', err({ code: '40001' })],
    ['PostgreSQL deadlock_detected', err({ code: '40P01' })],
    ['SQLite busy', err({ errno: 5, code: 'SQLITE_BUSY' })],
    ['wrapped in cause', err({ cause: err({ errno: 1020 }) })],
    ['wrapped by a knex/Strapi error', err({ nativeError: err({ code: '40P01' }) })],
  ])('recognises %s', (_label, e) => {
    expect(isTransientTxConflict(e)).toBe(true);
  });

  it.each([
    ['unique violation', err({ errno: 1062, code: 'ER_DUP_ENTRY' })],
    ['PostgreSQL unique violation', err({ code: '23505' })],
    ['plain error', new Error('boom')],
    ['nullish', null],
    ['string', 'boom'],
  ])('does not treat %s as transient', (_label, e) => {
    expect(isTransientTxConflict(e)).toBe(false);
  });

  it('survives cyclic causes', () => {
    const a: any = err({});
    a.cause = a;
    expect(isTransientTxConflict(a)).toBe(false);
  });

  it('keeps unique violations and transient conflicts apart', () => {
    expect(isUniqueViolation(err({ errno: 1020 }))).toBe(false);
  });
});
