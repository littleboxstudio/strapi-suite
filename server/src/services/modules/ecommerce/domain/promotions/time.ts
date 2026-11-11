/**
 * Store-timezone conversion with Intl only. Wall times are `YYYY-MM-DDTHH:mm`.
 * A nonexistent time (spring-forward gap) moves forward; an ambiguous time (autumn overlap)
 * resolves to the first occurrence.
 */

const WALL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const HOUR_MS = 3_600_000;

const formatters = new Map<string, Intl.DateTimeFormat>();
const formatterFor = (timeZone: string): Intl.DateTimeFormat => {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, f);
  }
  return f;
};

/** The wall clock in `timeZone` at `utcMs`, read back as if it were UTC (ms). */
const wallAsUtcMs = (utcMs: number, timeZone: string): number => {
  const parts: Record<string, number> = {};
  for (const p of formatterFor(timeZone).formatToParts(new Date(utcMs))) {
    if (p.type !== 'literal') parts[p.type] = Number(p.value);
  }
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour % 24, parts.minute, parts.second);
};

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

export function zonedWallTimeToUtc(wall: string, timeZone: string): string | null {
  const m = typeof wall === 'string' ? WALL_RE.exec(wall) : null;
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const naive = Date.UTC(y, mo - 1, d, h, mi);
  const check = new Date(naive);
  if (
    check.getUTCFullYear() !== y ||
    check.getUTCMonth() !== mo - 1 ||
    check.getUTCDate() !== d ||
    check.getUTCHours() !== h ||
    check.getUTCMinutes() !== mi
  ) {
    return null;
  }
  try {
    const before = wallAsUtcMs(naive - 24 * HOUR_MS, timeZone) - (naive - 24 * HOUR_MS);
    const after = wallAsUtcMs(naive + 24 * HOUR_MS, timeZone) - (naive + 24 * HOUR_MS);
    const candidates = [...new Set([before, after])]
      .map((offset) => naive - offset)
      .filter((utc) => wallAsUtcMs(utc, timeZone) === naive)
      .sort((a, b) => a - b);
    // Gap: no candidate matches; the offset in force before the gap lands after it.
    const utc = candidates.length ? candidates[0] : naive - before;
    return new Date(utc).toISOString();
  } catch {
    return null;
  }
}

export const isValidTimeZone = (timeZone: unknown): boolean => {
  if (typeof timeZone !== 'string' || !timeZone) return false;
  try {
    formatterFor(timeZone).format(0);
    return true;
  } catch {
    return false;
  }
};

/** Never throws: an unparseable instant or unknown zone yields null. */
export function utcToZonedWallTime(iso: string, timeZone: string): string | null {
  const ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) return null;
  let w: Date;
  try {
    w = new Date(wallAsUtcMs(ms, timeZone));
  } catch {
    return null;
  }
  return `${pad(w.getUTCFullYear(), 4)}-${pad(w.getUTCMonth() + 1)}-${pad(w.getUTCDate())}T${pad(
    w.getUTCHours()
  )}:${pad(w.getUTCMinutes())}`;
}
