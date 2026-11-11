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
