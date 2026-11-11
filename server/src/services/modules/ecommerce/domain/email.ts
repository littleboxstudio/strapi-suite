export const normalizeEmail = (email: string): string => String(email ?? '').trim().toLowerCase();
