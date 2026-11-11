export function mergeTranslations(
  base: Record<string, string>,
  locale: Record<string, string>
): Record<string, string> {
  return { ...base, ...locale };
}
