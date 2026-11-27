/** E-mail masking. Pure. */

/** `filipe@x.pt` -> `f*****@x.pt`: the first character and the domain stay. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  const local = at >= 0 ? email.slice(0, at) : email;
  const domain = at >= 0 ? email.slice(at) : '';
  const chars = Array.from(local);
  if (chars.length === 0) return domain;
  return `${chars[0]}${'*'.repeat(Math.max(1, chars.length - 1))}${domain}`;
}
