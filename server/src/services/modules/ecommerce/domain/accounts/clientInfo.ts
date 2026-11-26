import { isIPv4, isIPv6 } from 'node:net';

const USER_AGENT_MAX = 255;

/** Expands an IPv6 address into its eight 16-bit groups, or null when it is malformed. */
const ipv6Groups = (ip: string): number[] | null => {
  let s = ip;
  const zone = s.indexOf('%');
  if (zone >= 0) s = s.slice(0, zone);
  // Embedded IPv4 tail (::ffff:1.2.3.4) counts as two groups.
  const tail = /^(.*:)(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (tail) {
    if (!isIPv4(tail[2])) return null;
    const [a, b, c, d] = tail[2].split('.').map(Number);
    s = `${tail[1]}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const parse = (part: string) => (part === '' ? [] : part.split(':'));
  const head = parse(halves[0]);
  const rest = halves.length === 2 ? parse(halves[1]) : [];
  const fill = 8 - head.length - rest.length;
  if (halves.length === 1 ? head.length !== 8 : fill < 1) return null;
  const all = [...head, ...(halves.length === 2 ? Array(fill).fill('0') : []), ...rest];
  const groups = all.map((g) => (/^[0-9a-f]{1,4}$/i.test(g) ? parseInt(g, 16) : NaN));
  return groups.length === 8 && groups.every((g) => !Number.isNaN(g)) ? groups : null;
};

/** IPv4 as `a.b.c.0/24`, IPv6 as `xxxx:xxxx:xxxx::/48`; anything else gives null. */
export const ipPrefix = (ip: string | null): string | null => {
  if (typeof ip !== 'string') return null;
  const value = ip.trim();
  if (isIPv4(value)) {
    const [a, b, c] = value.split('.');
    return `${a}.${b}.${c}.0/24`;
  }
  if (isIPv6(value)) {
    const g = ipv6Groups(value);
    if (!g) return null;
    return `${g[0].toString(16)}:${g[1].toString(16)}:${g[2].toString(16)}::/48`;
  }
  return null;
};

export const truncateUserAgent = (ua: unknown): string | null => {
  if (typeof ua !== 'string') return null;
  const value = ua.trim();
  return value === '' ? null : value.slice(0, USER_AGENT_MAX);
};
