/**
 * Shipping lines: the charges table of an order. Each line is a signed amount (cents, VAT included)
 * with the method it was charged under. Pure: no Strapi imports.
 */

export type ShippingLineOrigin = 'CHECKOUT' | 'RECALCULATION' | 'EDIT' | 'MANUAL';

export type ShippingMethodRef = { providerId: string; serviceId: string; name: string; tax: number };

export type ShippingLine = ShippingMethodRef & {
  id: number;
  origin: ShippingLineOrigin;
  /** Signed cents. */
  amount: number;
  createdAt: string;
  actor: string;
  /** An EDIT line appended as a correction of the locked line with this id. */
  editOf?: number;
};

export type ShippingLineView = ShippingLine & {
  paid: boolean;
  invoiced: boolean;
  spent: boolean;
  /** Lines with corrections only: the amount plus every correction of it. */
  effectiveAmount?: number;
};

type PlanMode = 'REPLACED' | 'APPENDED' | 'UNCHANGED';

const ORIGINS: ShippingLineOrigin[] = ['CHECKOUT', 'RECALCULATION', 'EDIT', 'MANUAL'];

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const isObject = (v: unknown): v is Record<string, any> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const byId = (a: { id: number }, b: { id: number }): number => a.id - b.id;

const plain = (l: ShippingLine): ShippingLine => ({
  id: l.id,
  origin: l.origin,
  amount: l.amount,
  providerId: l.providerId,
  serviceId: l.serviceId,
  name: l.name,
  tax: l.tax,
  createdAt: l.createdAt,
  actor: l.actor,
  ...(l.editOf !== undefined ? { editOf: l.editOf } : {}),
});

export function checkoutLine(order: {
  createdAt: string;
  shippingOriginal: unknown;
  shippingTax: unknown;
  shippingMethod: unknown;
}): ShippingLine {
  const m = isObject(order.shippingMethod) ? order.shippingMethod : {};
  return {
    id: 1,
    origin: 'CHECKOUT',
    amount: num(order.shippingOriginal),
    tax: num(order.shippingTax),
    providerId: String(m.providerId ?? ''),
    serviceId: String(m.serviceId ?? ''),
    name: String(m.name ?? ''),
    createdAt: order.createdAt,
    actor: 'system',
  };
}

const parseLine = (raw: unknown): ShippingLine | null => {
  if (!isObject(raw)) return null;
  if (!Number.isInteger(raw.id) || raw.id < 1) return null;
  if (!ORIGINS.includes(raw.origin)) return null;
  if (typeof raw.amount !== 'number' || !Number.isFinite(raw.amount)) return null;
  if (typeof raw.tax !== 'number' || !Number.isFinite(raw.tax)) return null;
  for (const k of ['providerId', 'serviceId', 'name', 'createdAt', 'actor']) {
    if (typeof raw[k] !== 'string') return null;
  }
  const { editOf, ...rest } = raw;
  return plain({
    ...(rest as ShippingLine),
    ...(Number.isInteger(editOf) && editOf >= 1 ? { editOf } : {}),
  });
};

/** The corrections appended to the line `id`, oldest first. */
const correctionsOf = <L extends ShippingLine>(lines: L[], id: number): L[] =>
  lines.filter((l) => l.editOf === id).sort(byId);

export function readShippingLines(
  order: { shippingLines?: unknown } & Parameters<typeof checkoutLine>[0]
): ShippingLine[] {
  const stored = isObject(order.shippingLines) ? order.shippingLines.lines : null;
  if (Array.isArray(stored)) {
    const lines = stored.map(parseLine).filter((l): l is ShippingLine => l !== null);
    if (lines.length) return lines.sort(byId);
  }
  return [checkoutLine(order)];
}

export function chargedShipping(lines: ShippingLine[]): number {
  return lines.reduce((sum, l) => sum + l.amount, 0);
}

export function currentMethod(lines: ShippingLine[]): ShippingMethodRef | null {
  const sorted = [...lines].sort(byId);
  const latest =
    [...sorted].reverse().find((l) => l.origin !== 'RECALCULATION') ?? sorted[sorted.length - 1];
  if (!latest) return null;
  return { providerId: latest.providerId, serviceId: latest.serviceId, name: latest.name, tax: latest.tax };
}

export function nextShippingLineId(lines: ShippingLine[]): number {
  return lines.reduce((max, l) => Math.max(max, l.id), 0) + 1;
}

export function shippingLineViews(
  lines: ShippingLine[],
  ctx: {
    coveredShipping: number;
    /** Lines an invoice counts (the invoicing position). */
    invoicedLineIds: number[];
    hasActiveShipment: boolean;
  }
): ShippingLineView[] {
  const invoiced = new Set(ctx.invoicedLineIds);
  let remaining = Math.max(0, ctx.coveredShipping);
  return [...lines].sort(byId).map((l) => {
    let paid = false;
    if (l.amount > 0 && remaining >= l.amount) {
      paid = true;
      remaining -= l.amount;
    } else if (l.amount > 0) {
      remaining = 0;
    }
    const corrections = correctionsOf(lines, l.id);
    return {
      ...l,
      paid,
      invoiced: invoiced.has(l.id),
      spent: ctx.hasActiveShipment,
      ...(corrections.length ? { effectiveAmount: l.amount + chargedShipping(corrections) } : {}),
    };
  });
}

export const isReplaceable = (l: ShippingLineView): boolean => !l.spent && !l.invoiced;

/** Replaceable within its table: a line with a locked correction is locked too (never orphaned). */
const replaceableIn = (lines: ShippingLineView[], l: ShippingLineView): boolean =>
  isReplaceable(l) && correctionsOf(lines, l.id).every(isReplaceable);

export function appendLine(lines: ShippingLine[], line: Omit<ShippingLine, 'id'>): ShippingLine[] {
  return [...lines, { ...line, id: nextShippingLineId(lines) }];
}

export function planLineChange(
  lines: ShippingLineView[],
  targetId: number,
  next: { method: ShippingMethodRef; amount: number },
  meta: { at: string; actor: string }
): { lines: ShippingLine[]; mode: PlanMode } {
  const base = lines.map(plain);
  const target = lines.find((l) => l.id === targetId);
  if (!target) return { lines: base, mode: 'UNCHANGED' };
  // A line is charged at its amount plus its corrections, under the latest method. Corrections
  // may be locked, so they are never removed: a replace sets the target to the rest.
  const corrections = correctionsOf(base, target.id);
  const latest = corrections[corrections.length - 1] ?? target;
  const delta = next.amount - (target.amount + chargedShipping(corrections));
  if (
    latest.providerId === next.method.providerId &&
    latest.serviceId === next.method.serviceId &&
    delta === 0
  ) {
    return { lines: base, mode: 'UNCHANGED' };
  }
  if (replaceableIn(lines, target)) {
    return {
      lines: base.map((l) =>
        l.id === targetId
          ? { ...l, origin: 'EDIT', amount: target.amount + delta, ...next.method, createdAt: meta.at, actor: meta.actor }
          : l
      ),
      mode: 'REPLACED',
    };
  }
  return {
    lines: appendLine(base, {
      origin: 'EDIT',
      amount: delta,
      ...next.method,
      createdAt: meta.at,
      actor: meta.actor,
      editOf: target.id,
    }),
    mode: 'APPENDED',
  };
}

export function planRecalculation(
  lines: ShippingLineView[],
  due: number,
  meta: { method: ShippingMethodRef; at: string; actor: string }
): { lines: ShippingLine[]; mode: PlanMode; charged: number; delta: number } {
  const base = lines.map(plain);
  const charged = chargedShipping(base);
  const delta = due - charged;
  if (delta === 0) return { lines: base, mode: 'UNCHANGED', charged, delta };

  const locked = lines.filter((l) => !replaceableIn(lines, l)).map(plain);
  const amount = due - chargedShipping(locked);
  const dropped = locked.length < base.length;
  const out =
    amount === 0 && locked.length
      ? locked
      : [
          ...locked,
          {
            id: nextShippingLineId(base),
            origin: 'RECALCULATION' as const,
            amount,
            ...meta.method,
            createdAt: meta.at,
            actor: meta.actor,
          },
        ];
  return { lines: out, mode: dropped ? 'REPLACED' : 'APPENDED', charged, delta };
}

export function shippingTaxRates(lines: ShippingLine[]): { tax: number; weight: number; name: string }[] {
  const byTax = new Map<number, { sum: number; name: string; lastId: number }>();
  for (const l of lines) {
    const cur = byTax.get(l.tax) ?? { sum: 0, name: l.name, lastId: -Infinity };
    cur.sum += l.amount;
    if (l.id >= cur.lastId) {
      cur.lastId = l.id;
      cur.name = l.name;
    }
    byTax.set(l.tax, cur);
  }
  return [...byTax.entries()]
    .map(([tax, v]) => ({ tax, weight: Math.max(0, v.sum), name: v.name }))
    .sort((a, b) => b.tax - a.tax);
}
