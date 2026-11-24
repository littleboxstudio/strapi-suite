/** As the server's slug: accents dropped, lower case, runs of other characters become one "-". */
export function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * The slug (or collection slug) after the name changes from `prevName` to `nextName`: it follows
 * the name while it is empty or still the slug of the previous name; one edited by hand is kept.
 * A slug taken by another item in the locale gets "-2", "-3", … from the server on save.
 */
export function followNameSlug(prevName: string, prevSlug: string, nextName: string): string {
  const current = prevSlug.trim();
  return current === '' || current === slugify(prevName) ? slugify(nextName) : prevSlug;
}
