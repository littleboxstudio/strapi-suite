/** Account links (verification, reset, confirmation) and e-mail masking. Pure. */

/** `<storefrontUrl><path>?token=<token>`, with one slash between the parts and the token encoded. */
export function buildAccountLink(storefrontUrl: string, path: string, token: string): string {
  const base = storefrontUrl.replace(/\/+$/, '');
  const tail = path.startsWith('/') ? path : `/${path}`;
  return `${base}${tail}?token=${encodeURIComponent(token)}`;
}

/** `filipe@x.pt` -> `f*****@x.pt`: the first character and the domain stay. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  const local = at >= 0 ? email.slice(0, at) : email;
  const domain = at >= 0 ? email.slice(at) : '';
  const chars = Array.from(local);
  if (chars.length === 0) return domain;
  return `${chars[0]}${'*'.repeat(Math.max(1, chars.length - 1))}${domain}`;
}
