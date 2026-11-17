/**
 * Add payment's method field: the suggestions shown for the typed text (case-insensitive
 * contains, surrounding spaces ignored). A blank text shows them all.
 */
export const filterPaymentMethodSuggestions = (names: string[], text: string): string[] => {
  const needle = (text ?? '').trim().toLowerCase();
  if (!needle) return names;
  return names.filter((name) => name.toLowerCase().includes(needle));
};

/** The list without `name` (optimistic removal). */
export const withoutPaymentMethodSuggestion = (names: string[], name: string): string[] =>
  names.filter((n) => n !== name);

/** Puts `name` back (a failed removal), sorted as the server sorts; never duplicated. */
export const restorePaymentMethodSuggestion = (names: string[], name: string): string[] =>
  names.includes(name)
    ? names
    : [...names, name].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
