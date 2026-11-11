/** Unique / primary-key violation only (PostgreSQL, MySQL/MariaDB, SQLite). */
export const isUniqueViolation = (err: any): boolean => {
  const code = String(err?.code ?? '');
  return (
    code === '23505' ||
    code === 'ER_DUP_ENTRY' ||
    err?.errno === 1062 ||
    code === 'SQLITE_CONSTRAINT_UNIQUE' ||
    code === 'SQLITE_CONSTRAINT_PRIMARYKEY'
  );
};

const TRANSIENT_ERRNOS = new Set([
  1020, // MariaDB ER_CHECKREAD: "Record has changed since last read" (innodb_snapshot_isolation)
  1213, // MySQL/MariaDB ER_LOCK_DEADLOCK
  1205, // MySQL/MariaDB ER_LOCK_WAIT_TIMEOUT
]);
const TRANSIENT_CODES = new Set([
  'ER_CHECKREAD',
  'ER_LOCK_DEADLOCK',
  'ER_LOCK_WAIT_TIMEOUT',
  '40001', // PostgreSQL serialization_failure
  '40P01', // PostgreSQL deadlock_detected
  'SQLITE_BUSY',
]);
const NESTED_KEYS = ['cause', 'nativeError', 'originalError', 'original', 'error'] as const;

/**
 * A concurrent transaction won a write-write conflict (snapshot conflict, deadlock or lock wait
 * timeout): the database rolled this transaction back (or it must be), and running the WHOLE
 * transaction again may succeed. Never retry a single statement inside the failed transaction.
 * Looks at the error and at the errors it wraps (`cause`, knex/Strapi wrappers).
 */
export const isTransientTxConflict = (err: any): boolean => {
  const seen = new Set<unknown>();
  const visit = (e: any, depth: number): boolean => {
    if (!e || typeof e !== 'object' || seen.has(e) || depth > 5) return false;
    seen.add(e);
    if (TRANSIENT_ERRNOS.has(Number(e.errno))) return true;
    if (TRANSIENT_CODES.has(String(e.code ?? ''))) return true;
    return NESTED_KEYS.some((k) => visit(e[k], depth + 1));
  };
  return visit(err, 0);
};
