import type { PromotionListItem, PromotionStatus } from '../promotionTypes';
import type { BadgeVariant } from './statusBadges';

const TONES: Record<PromotionStatus, BadgeVariant> = {
  ACTIVE: 'success',
  SCHEDULED: 'primary',
  INACTIVE: 'neutral',
  EXPIRED: 'warning',
};

/** Badge colour of a promotion status; a status this build does not know is neutral. */
export function statusTone(status: PromotionStatus | string): BadgeVariant {
  return TONES[status as PromotionStatus] ?? 'neutral';
}

/** `redemptions / usageLimit`, or just `redemptions` without a limit. */
export function usageLabel(item: Pick<PromotionListItem, 'redemptions' | 'usageLimit'>): string {
  return item.usageLimit === null || item.usageLimit === undefined
    ? String(item.redemptions)
    : `${item.redemptions} / ${item.usageLimit}`;
}

const WALL_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/;

/** Formats a store-local wall time as is (no time zone conversion); an unparsable value is returned raw. */
export function formatWallTime(value: string, locale: string): string {
  const m = WALL_TIME.exec(value);
  if (!m) return value;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(
    new Date(Date.UTC(y, mo - 1, d, h, mi))
  );
}

/** "start – end" in the store's local time; only the start when there is no end. */
export function validityLabel(
  item: Pick<PromotionListItem, 'startsAt' | 'endsAt'>,
  locale: string
): string {
  const start = item.startsAt ? formatWallTime(item.startsAt, locale) : '';
  if (!item.endsAt) return start;
  return `${start} – ${formatWallTime(item.endsAt, locale)}`;
}
