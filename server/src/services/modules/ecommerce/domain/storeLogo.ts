import type { StoreSettings } from '../settings';

/** Box the stored logo is resized into (pixels), and the box it is shown in inside e-mails. */
export const LOGO_BOX = { width: 480, height: 96 } as const;
export const LOGO_DISPLAY = { width: 240, height: 48 } as const;

/** Host name, lower case; the scheme and port are ignored (a TLS proxy may change them). */
const hostOf = (url: string): string | null => {
  try {
    return new URL(url).hostname.toLowerCase() || null;
  } catch {
    return null;
  }
};

const trimEnd = (s: string) => s.replace(/\/+$/, '');

/**
 * Resolves an asset URL to one that is safe to put in an e-mail: absolute URLs stay as they are,
 * except those on the backoffice host (rewritten onto the storefront, or dropped without one);
 * root-relative paths are served by the storefront. Anything else is dropped.
 */
export function publicAssetUrl(
  url: string | null | undefined,
  storefrontUrl: string | null,
  backofficeUrl?: string | null
): string {
  if (typeof url !== 'string' || url === '') return '';
  const storefront = storefrontUrl ? trimEnd(storefrontUrl) : '';
  const backoffice = backofficeUrl ? hostOf(backofficeUrl) : null;

  const absolute = url.startsWith('//') ? `https:${url}` : url;
  if (/^https?:\/\//i.test(absolute)) {
    let parsed: URL;
    try {
      parsed = new URL(absolute);
    } catch {
      return '';
    }
    if (backoffice && parsed.hostname.toLowerCase() === backoffice) {
      return storefront ? `${storefront}${parsed.pathname}${parsed.search}` : '';
    }
    return absolute;
  }
  if (url.startsWith('/')) return storefront ? `${storefront}${url}` : '';
  return '';
}

/** Fits width x height into the display box without enlarging. */
export function logoDisplaySize(width: number, height: number): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) return { width: LOGO_DISPLAY.width, height: LOGO_DISPLAY.height };
  const scale = Math.min(1, LOGO_DISPLAY.width / width, LOGO_DISPLAY.height / height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** The `store.logoUrl`, `store.logoWidth` and `store.logoHeight` e-mail variables. */
export function storeLogoVariables(
  store: Pick<StoreSettings, 'logo' | 'storefrontUrl'>,
  backofficeUrl?: string | null
): { logoUrl: string; logoWidth: string; logoHeight: string } {
  const url = store.logo ? publicAssetUrl(store.logo.url, store.storefrontUrl, backofficeUrl) : '';
  if (!store.logo || !url) return { logoUrl: '', logoWidth: '', logoHeight: '' };
  const size = logoDisplaySize(store.logo.width, store.logo.height);
  return { logoUrl: url, logoWidth: String(size.width), logoHeight: String(size.height) };
}
