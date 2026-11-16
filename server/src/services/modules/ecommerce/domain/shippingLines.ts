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
  /**
   * A pickup method charged once the order has shipments: the point (DPD point or store) the next
   * shipment goes to. The order's own delivery address and point no longer change by then.
   */
  pickupPoint?: LinePickupPoint;
};

/** A point as a shipping line keeps it: its public fields, never the customer's address. */
export type LinePickupPoint = {
  id: string;
  name: string;
  address: string;
  address2: string | null;
  postalCode: string;
  city: string;
  country: string;
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
  ...(l.pickupPoint ? { pickupPoint: linePoint(l.pickupPoint) } : {}),
});

const text = (v: unknown): string => (typeof v === 'string' ? v : '');

/** A point's public fields (a stored point may also hold the customer's address: dropped). */
export function linePoint(p: LinePickupPoint): LinePickupPoint {
  return {
    id: p.id,
    name: text(p.name),
    address: text(p.address),
    address2: typeof p.address2 === 'string' ? p.address2 : null,
    postalCode: text(p.postalCode),
    city: text(p.city),
    country: text(p.country),
  };
}

const parsePoint = (raw: unknown): LinePickupPoint | null =>
  isObject(raw) && typeof raw.id === 'string' && raw.id ? linePoint(raw as LinePickupPoint) : null;

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
  const { editOf, pickupPoint, ...rest } = raw;
  const point = parsePoint(pickupPoint);
  return plain({
    ...(rest as ShippingLine),
    ...(Number.isInteger(editOf) && editOf >= 1 ? { editOf } : {}),
    ...(point ? { pickupPoint: point } : {}),
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

/** The line that sets the order's current method: the latest one not made by a recalculation. */
export function currentLine(lines: ShippingLine[]): ShippingLine | null {
  const sorted = [...lines].sort(byId);
  return [...sorted].reverse().find((l) => l.origin !== 'RECALCULATION') ?? sorted[sorted.length - 1] ?? null;
}

export function currentMethod(lines: ShippingLine[]): ShippingMethodRef | null {
  const latest = currentLine(lines);
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
    /**
     * When the last COMPLETED payment was made (ms): a line created after it was paid by nothing
     * (it never takes coverage left over by earlier payments). Absent: no such limit.
     */
    lastPaymentAt?: number | null;
  }
): ShippingLineView[] {
  const invoiced = new Set(ctx.invoicedLineIds);
  let remaining = Math.max(0, ctx.coveredShipping);
  const sorted = [...lines].sort(byId);
  // A credit (a negative line correcting no other line) lowers what is due without a line of its
  // own: it comes off the charges before it, latest first, so the coverage pays what is left.
  const owed = new Map<number, number>();
  for (const l of sorted) if (l.amount > 0 && l.editOf == null) owed.set(l.id, l.amount);
  for (const c of sorted) {
    if (c.amount >= 0 || c.editOf != null) continue;
    let credit = -c.amount;
    for (const l of [...sorted].reverse()) {
      if (credit <= 0) break;
      if (l.id >= c.id || !owed.has(l.id)) continue;
      const taken = Math.min(credit, owed.get(l.id)!);
      owed.set(l.id, owed.get(l.id)! - taken);
      credit -= taken;
    }
  }
  const after = (l: ShippingLine) => {
    if (ctx.lastPaymentAt == null) return false;
    const t = new Date(l.createdAt).getTime();
    return Number.isFinite(t) && t > ctx.lastPaymentAt;
  };
  return sorted.map((l) => {
    let paid = false;
    const due = owed.get(l.id) ?? l.amount;
    if (l.amount > 0 && after(l)) {
      // Added after the last payment: nothing paid it yet.
    } else if (l.amount > 0 && remaining >= due) {
      paid = true;
      remaining -= due;
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

/**
 * Changed in place (edited or removed) while neither paid nor invoiced: the charges a customer
 * paid or an invoice holds are only corrected by an appended line. Shipments do not matter.
 */
export const isReplaceable = (l: ShippingLineView): boolean => !l.paid && !l.invoiced;

/** Replaceable within its table: a line with a locked correction is locked too (never orphaned). */
const replaceableIn = (lines: ShippingLineView[], l: ShippingLineView): boolean =>
  isReplaceable(l) && correctionsOf(lines, l.id).every(isReplaceable);

/** The lines without the points they carried (the order's own point is set again). */
export function withoutLinePoints(lines: ShippingLine[]): ShippingLine[] {
  return lines.map(({ pickupPoint: _dropped, ...l }) => l);
}

/** Whether any line carries a point. */
export const hasLinePoints = (lines: ShippingLine[]): boolean => lines.some((l) => !!l.pickupPoint);

export function appendLine(lines: ShippingLine[], line: Omit<ShippingLine, 'id'>): ShippingLine[] {
  return [...lines, { ...line, id: nextShippingLineId(lines) }];
}

/**
 * Why line `id` cannot be removed, or null when it can: `NOT_FOUND` (no such line, or a
 * correction, removed with its line), `PAID` or `INVOICED` (it or one of its corrections), `LAST`
 * (the order keeps at least one charge).
 */
export function lineRemovalIssue(
  lines: ShippingLineView[],
  id: number
): 'NOT_FOUND' | 'PAID' | 'INVOICED' | 'LAST' | null {
  const target = lines.find((l) => l.id === id && l.editOf == null);
  if (!target) return 'NOT_FOUND';
  const group = [target, ...correctionsOf(lines, id)];
  if (group.some((l) => l.paid)) return 'PAID';
  if (group.some((l) => l.invoiced)) return 'INVOICED';
  if (!lines.some((l) => l.editOf == null && l.id !== id)) return 'LAST';
  return null;
}

/** The lines without line `id` and its corrections. */
export function withoutLine(lines: ShippingLine[], id: number): ShippingLine[] {
  return lines.filter((l) => l.id !== id && l.editOf !== id).map(plain);
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
      // A replaced line charges another method: a point it carried no longer applies.
      lines: base.map((l) => {
        if (l.id !== targetId) return l;
        const { pickupPoint: _dropped, ...rest } = l;
        return { ...rest, origin: 'EDIT', amount: target.amount + delta, ...next.method, createdAt: meta.at, actor: meta.actor };
      }),
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

/** Kept by a recalculation: an invoice includes the line or one of its corrections (spec 6.3). */
const invoicedIn = (lines: ShippingLineView[], l: ShippingLineView): boolean =>
  l.invoiced || correctionsOf(lines, l.id).some((c) => c.invoiced);

/** The method of the most recent invoiced line: a recalculation charges the same company. */
export function invoicedMethod(lines: ShippingLineView[]): ShippingMethodRef | null {
  const latest = [...lines].sort(byId).reverse().find((l) => l.invoiced);
  return latest
    ? { providerId: latest.providerId, serviceId: latest.serviceId, name: latest.name, tax: latest.tax }
    : null;
}

/**
 * Recalculate shipping (spec 6.3): `due` is what the lines in scope should charge. Invoiced lines
 * (and lines with an invoiced correction) stay; every other line in scope is dropped and one
 * RECALCULATION line charges `due` minus the invoiced ones (negative: money back to the customer).
 * Lines out of scope are never touched nor counted.
 */
export function planRecalculation(
  lines: ShippingLineView[],
  due: number,
  meta: { method: ShippingMethodRef; at: string; actor: string },
  inScope: (l: ShippingLineView) => boolean = () => true
): { lines: ShippingLine[]; mode: PlanMode; charged: number; invoiced: number; delta: number } {
  const base = lines.map(plain);
  const scoped = lines.filter(inScope);
  const charged = chargedShipping(scoped);
  const invoicedLines = scoped.filter((l) => invoicedIn(lines, l));
  const invoiced = chargedShipping(invoicedLines);
  const delta = due - charged;
  if (delta === 0) return { lines: base, mode: 'UNCHANGED', charged, invoiced, delta };

  const keep = lines.filter((l) => !inScope(l) || invoicedIn(lines, l)).map(plain);
  const amount = due - invoiced;
  const dropped = keep.length < base.length;
  const out =
    amount === 0 && keep.length
      ? keep
      : [
          ...keep,
          {
            id: nextShippingLineId(base),
            origin: 'RECALCULATION' as const,
            amount,
            ...meta.method,
            createdAt: meta.at,
            actor: meta.actor,
          },
        ];
  return { lines: out, mode: dropped ? 'REPLACED' : 'APPENDED', charged, invoiced, delta };
}
