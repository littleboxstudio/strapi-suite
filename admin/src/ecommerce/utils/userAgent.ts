/** `Chrome · macOS` from a user agent; the parts not recognised are left out. Pure. */
export function describeUserAgent(ua: string | null | undefined): string | null {
  if (!ua) return null;
  const browser =
    /Edg(e|A|iOS)?\//.test(ua)
      ? 'Edge'
      : /OPR\/|Opera/.test(ua)
        ? 'Opera'
        : /SamsungBrowser\//.test(ua)
          ? 'Samsung Internet'
          : /Firefox\/|FxiOS\//.test(ua)
            ? 'Firefox'
            : /Chrome\/|CriOS\//.test(ua)
              ? 'Chrome'
              : /Safari\//.test(ua) && /Version\//.test(ua)
                ? 'Safari'
                : null;
  const os = /Windows/.test(ua)
    ? 'Windows'
    : /iPhone|iPad|iPod/.test(ua)
      ? 'iOS'
      : /Android/.test(ua)
        ? 'Android'
        : /Mac OS X|Macintosh/.test(ua)
          ? 'macOS'
          : /CrOS/.test(ua)
            ? 'ChromeOS'
            : /Linux/.test(ua)
              ? 'Linux'
              : null;
  const parts = [browser, os].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}
