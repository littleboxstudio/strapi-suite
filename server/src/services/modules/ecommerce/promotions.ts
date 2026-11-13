import type { Core } from '@strapi/strapi';
import { createHash } from 'crypto';
import { PLUGIN_ID, LtbConfigs } from '../../../config';
import { EcommerceNotFoundError, EcommerceValidationError } from './errors';
import { isUniqueViolation } from './dbErrors';
import { normalizeEmail } from './domain/email';
import {
  PROMOTION_SEARCH_LIMIT_DEFAULT,
  PROMOTION_SEARCH_LIMIT_MAX,
  evaluatePromotions,
  normalizePromotionCode,
  promotionStatus,
  unmetAppliedPromotions,
  utcToZonedWallTime,
  validatePromotionInput,
  type AppliedPromotion,
  type Benefit,
  type ConditionGroup,
  type EvaluationInput,
  type EvaluationLine,
  type GiftOption,
  type ProductTarget,
  type PromotionCandidate,
  type PromotionEvaluation,
  type PromotionInput,
  type PromotionStatus,
} from './domain/promotions';

const PAGE_SIZE = 50;
/** What `reserve` needs from the locked promotion row. */
const RESERVE_COLUMNS = ['code', 'method', 'active', 'startsAt', 'endsAt', 'usageLimit', 'perCustomerLimit'];
const DEFAULT_TIMEZONE = 'Europe/Lisbon';

export type PromotionListItem = {
  id: number;
  name: string;
  code: string | null;
  method: 'AUTOMATIC' | 'CODE';
  status: PromotionStatus;
  /** Local wall time in the store time zone. */
  startsAt: string;
  endsAt: string | null;
  redemptions: number;
  usageLimit: number | null;
};

export type PromotionLabels = {
  products: Record<number, string>;
  variants: Record<number, { name: string; option: string | null; sku: string }>;
};

/** `PromotionInput` with `startsAt`/`endsAt` as local wall time in `timezone`. */
export type PromotionView = PromotionInput & {
  id: number;
  status: PromotionStatus;
  redemptions: number;
  version: number;
  timezone: string;
  createdAt: string | null;
  updatedAt: string | null;
  labels: PromotionLabels;
};

export type PromotionRedemptionView = {
  id: number;
  orderId: number | null;
  orderReference: number | null;
  customerId: number | null;
  /** `a***@example.com`: promotions.read holders never get the full address. */
  maskedEmail: string | null;
  amount: number;
  status: 'RESERVED' | 'RELEASED';
  createdAt: string | null;
  releasedAt: string | null;
};

export type ReserveContext = {
  orderId: number;
  customerId: number | null;
  email: string;
  actor: string;
  operationId?: string;
};

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const intOrNull = (v: unknown): number | null =>
  v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null;
const idOf = (v: any): number | null =>
  v === null || v === undefined ? null : Number(typeof v === 'object' ? v.id : v);
const maskEmail = (v: unknown): string | null => {
  if (typeof v !== 'string' || !v) return null;
  const at = v.lastIndexOf('@');
  if (at < 1) return '***';
  return `${v[0]}***${v.slice(at)}`;
};
const isObj = (v: unknown): v is Record<string, any> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const iso = (v: unknown): string | null => {
  if (v === null || v === undefined || v === '') return null;
  const d = new Date(v as string);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};
const pageOf = (raw: unknown): number => {
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) && n > 0 ? n : 1;
};
const pagination = (page: number, total: number) => ({
  page,
  pageSize: PAGE_SIZE,
  total,
  pageCount: Math.ceil(total / PAGE_SIZE),
});

const EMPTY_GROUP: ConditionGroup = { type: 'GROUP', operator: 'AND', children: [] };
const DEFAULT_STACKING = { exclusive: false, withProduct: true, withOrder: true, withShipping: true };

/** `benefits` is stored as `{ items }` (JSON columns hold objects); legacy `[]` reads as empty. */
const benefitsOf = (v: unknown): Benefit[] =>
  isObj(v) && Array.isArray(v.items) ? v.items : Array.isArray(v) ? (v as Benefit[]) : [];

/** Key of the per-customer counter: fits in 255 characters whatever the e-mail length. */
export const promotionUsageKey = (promotionId: number, emailNormalized: string): string =>
  `p${promotionId}:${createHash('sha256').update(emailNormalized).digest('hex')}`;

const redemptionKey = (promotionId: number, orderId: number): string => `${promotionId}:${orderId}`;

/** A stored row as the domain sees it (dates in UTC ISO). */
const toCandidate = (row: any, customerUses: number): PromotionCandidate => ({
  id: row.id,
  name: row.name ?? '',
  code: row.code ?? null,
  method: row.method,
  displayName: isObj(row.displayName) ? row.displayName : {},
  priority: num(row.priority),
  eligibility: isObj(row.eligibility) ? (row.eligibility as any) : { mode: 'ALL' },
  conditions: isObj(row.conditions) ? (row.conditions as ConditionGroup) : EMPTY_GROUP,
  benefits: benefitsOf(row.benefits),
  stacking: isObj(row.stacking) ? (row.stacking as any) : DEFAULT_STACKING,
  perOrderLimit: intOrNull(row.perOrderLimit),
  requireVerifiedEmail: row.requireVerifiedEmail === true,
  version: num(row.version) || 1,
  active: !!row.active,
  startsAt: iso(row.startsAt) ?? '',
  endsAt: iso(row.endsAt),
  usageLimit: intOrNull(row.usageLimit),
  perCustomerLimit: intOrNull(row.perCustomerLimit),
  redemptions: num(row.redemptions),
  customerUses,
});

/** Every product and variant id a promotion refers to (targets and gifts), for the labels. */
const referencedIds = (p: { conditions: ConditionGroup; benefits: Benefit[] }) => {
  const products = new Set<number>();
  const variants = new Set<number>();
  const addTarget = (t: ProductTarget | undefined) => {
    (t?.productIds ?? []).forEach((id) => products.add(id));
    (t?.variantIds ?? []).forEach((id) => variants.add(id));
  };
  const walk = (node: any) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'GROUP') (node.children ?? []).forEach(walk);
    else if (node.target) addTarget(node.target);
  };
  walk(p.conditions);
  for (const b of p.benefits) {
    if (b.type === 'PRODUCT_PERCENT' || b.type === 'PRODUCT_FIXED') addTarget(b.target);
    if (b.type === 'BUY_X_GET_Y') {
      addTarget(b.buy?.target);
      if (b.get?.mode === 'IN_CART') addTarget(b.get.target);
      else (b.get?.variantIds ?? []).forEach((id) => variants.add(id));
    }
  }
  return { productIds: [...products], variantIds: [...variants] };
};

/** The persisted fields of a validated input (benefits wrapped in `{ items }`). */
const toRowData = (v: PromotionInput) => ({
  name: v.name,
  description: v.description,
  code: v.code,
  method: v.method,
  active: v.active,
  startsAt: v.startsAt,
  endsAt: v.endsAt,
  priority: v.priority,
  displayName: v.displayName,
  eligibility: v.eligibility,
  conditions: v.conditions,
  benefits: { items: v.benefits },
  stacking: v.stacking,
  usageLimit: v.usageLimit,
  perCustomerLimit: v.perCustomerLimit,
  perOrderLimit: v.perOrderLimit,
  requireVerifiedEmail: v.requireVerifiedEmail,
});

/** Comparable form of a row for the audit diff (field names only ever leave this module). */
const comparable = (row: any): Record<string, string> => {
  const c = toCandidate(row, 0);
  const fields: Record<string, unknown> = {
    name: c.name,
    description: row.description ?? null,
    code: c.code,
    method: c.method,
    active: c.active,
    startsAt: c.startsAt,
    endsAt: c.endsAt,
    priority: c.priority,
    displayName: c.displayName,
    eligibility: c.eligibility,
    conditions: c.conditions,
    benefits: c.benefits,
    stacking: c.stacking,
    usageLimit: c.usageLimit,
    perCustomerLimit: c.perCustomerLimit,
    perOrderLimit: c.perOrderLimit,
    requireVerifiedEmail: c.requireVerifiedEmail,
  };
  return Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, JSON.stringify(v)]));
};

const unavailable = (promotionId: number, code: string | null) =>
  new EcommerceValidationError('Promotion unavailable', [
    { path: `promotions.${promotionId}`, code: 'PROMOTION_UNAVAILABLE', detail: code ?? '' },
  ]);
const invalid = (path: string, code: string) =>
  new EcommerceValidationError('Invalid promotion', [{ path, code }]);

/**
 * Promotions (design 4.8, 6, 9.2): admin CRUD with an optimistic `version`, the candidates
 * for the engine, and the strict capacity bookkeeping of orders. `reserve` runs inside the
 * order's transaction with guarded increments whose limits are constants computed in JS from
 * the promotion row read in that transaction; `releaseForOrder` gives the capacity back once.
 */
const EcommercePromotionService = ({ strapi }: { strapi: Core.Strapi }) => {
  const config = (): LtbConfigs | undefined => strapi.config.get(`plugin::${PLUGIN_ID}`);
  const uids = () => (config() as LtbConfigs).uuid.modules.ecommerce;
  const service = (name: string): any => strapi.plugin(PLUGIN_ID).service(name);
  const locales = () => strapi.plugin('i18n').service('locales');

  const timeZone = async (): Promise<string> => {
    const store = await service('EcommerceSettingsService').getStoreSettings();
    return store?.timezone || DEFAULT_TIMEZONE;
  };
  const localeCodes = async (): Promise<string[]> => {
    const all: any[] = (await locales().find()) ?? [];
    return all.map((l) => l.code).filter((c) => typeof c === 'string');
  };
  const audit = (action: 'create' | 'update' | 'delete', id: number, actor: string, fields: string[]) =>
    service('EcommerceAuditService').log({
      area: 'promotions',
      action,
      targetId: String(id),
      userId: actor,
      details: { fields },
    });

  /** Plugin config `ecommerce.promotionSearchLimit`: an integer in [1, 16], otherwise 12. */
  const searchLimit = (): number => {
    let v: unknown;
    try {
      v = (config() as any)?.ecommerce?.promotionSearchLimit;
    } catch {
      v = undefined;
    }
    return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= PROMOTION_SEARCH_LIMIT_MAX
      ? v
      : PROMOTION_SEARCH_LIMIT_DEFAULT;
  };

  /** Logs a failed condition: promotion id and condition type only, never customer data. */
  const logConditionError = (promotionId: number, type: string, err: unknown): void => {
    strapi.log?.warn?.(
      `[ecommerce] promotion ${promotionId}: condition ${type} failed and counts as not met (${(err as any)?.name ?? 'Error'})`
    );
  };

  /** `evaluatePromotions` with the configured search limit and condition failures logged. */
  const evaluate = (
    input: Omit<EvaluationInput, 'searchLimit' | 'onConditionError'>
  ): PromotionEvaluation =>
    evaluatePromotions({
      ...input,
      searchLimit: searchLimit(),
      onConditionError: logConditionError,
    });

  /**
   * Stored (applied) promotions whose snapshot eligibility or conditions no longer hold for
   * `ctx` (order modification warnings, design 4.8). Nothing is re-evaluated or re-priced;
   * a failing condition is logged and reports the promotion as unmet.
   */
  const unmet = (
    applied: AppliedPromotion[],
    ctx: { lines: EvaluationLine[]; email: string | null }
  ): { promotionId: number; name: string }[] =>
    unmetAppliedPromotions(applied, ctx, logConditionError);

  // -------------------------------------------------------------------------
  // Admin
  // -------------------------------------------------------------------------

  const labelsFor = async (p: { conditions: ConditionGroup; benefits: Benefit[] }): Promise<PromotionLabels> => {
    const { productIds, variantIds } = referencedIds(p);
    const labels: PromotionLabels = { products: {}, variants: {} };
    if (!productIds.length && !variantIds.length) return labels;
    const u = uids();
    const defaultLocale = await locales().getDefaultLocale();
    const or: any[] = [];
    if (productIds.length) or.push({ id: { $in: productIds } });
    if (variantIds.length) or.push({ variants: { id: { $in: variantIds } } });
    const products: any[] = await strapi.db.query(u.product).findMany({
      where: { $or: or },
      populate: { translations: true, variants: { populate: { translations: true } } },
    });
    const pick = (rows: any[] = [], field: string): string | null =>
      rows.find((t) => t.locale === defaultLocale)?.[field] ?? rows[0]?.[field] ?? null;
    for (const p of products) {
      const name = pick(p.translations, 'name') ?? '';
      if (productIds.includes(p.id)) labels.products[p.id] = name;
      for (const v of p.variants ?? []) {
        if (!variantIds.includes(v.id)) continue;
        labels.variants[v.id] = { name, option: pick(v.translations, 'option'), sku: v.sku ?? '' };
      }
    }
    return labels;
  };

  const toView = async (row: any, tz: string): Promise<PromotionView> => {
    const c = toCandidate(row, 0);
    return {
      id: c.id,
      name: c.name,
      description: row.description ?? null,
      code: c.code,
      method: c.method,
      displayName: c.displayName,
      priority: c.priority,
      eligibility: c.eligibility,
      conditions: c.conditions,
      benefits: c.benefits,
      stacking: c.stacking,
      perOrderLimit: c.perOrderLimit,
      requireVerifiedEmail: c.requireVerifiedEmail,
      active: c.active,
      startsAt: c.startsAt ? (utcToZonedWallTime(c.startsAt, tz) ?? '') : '',
      endsAt: c.endsAt ? utcToZonedWallTime(c.endsAt, tz) : null,
      usageLimit: c.usageLimit,
      perCustomerLimit: c.perCustomerLimit,
      status: promotionStatus(c, new Date()),
      redemptions: c.redemptions,
      version: c.version,
      timezone: tz,
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
      labels: await labelsFor(c),
    };
  };

  const findRow = async (rawId: number | string) => {
    const row = await strapi.db.query(uids().promotion).findOne({ where: { id: Number(rawId) } });
    if (!row) throw new EcommerceNotFoundError('Promotion not found');
    return row;
  };

  const validate = async (raw: unknown, tz: string): Promise<PromotionInput> => {
    const { value, errors } = validatePromotionInput(raw, { locales: await localeCodes(), timeZone: tz });
    if (!value || errors.length) throw new EcommerceValidationError('Invalid promotion', errors);
    return value;
  };

  /** Checked first; the unique index still decides a race (outside any transaction). */
  const assertCodeFree = async (code: string | null, selfId?: number) => {
    if (!code) return;
    const where: Record<string, unknown> = { code };
    if (selfId !== undefined) where.id = { $ne: selfId };
    if (await strapi.db.query(uids().promotion).findOne({ where, select: ['id'] })) {
      throw invalid('code', 'code_taken');
    }
  };
  const codeRace = (err: unknown): never => {
    if (isUniqueViolation(err)) throw invalid('code', 'code_taken');
    throw err;
  };

  const list = async (params: { page?: number | string; search?: string } = {}) => {
    const q = strapi.db.query(uids().promotion);
    const page = pageOf(params?.page);
    const term = typeof params?.search === 'string' ? params.search.trim() : '';
    const where: Record<string, unknown> = term
      ? { $or: [{ name: { $containsi: term } }, { code: { $containsi: term.toUpperCase() } }] }
      : {};
    const [total, rows, tz] = await Promise.all([
      q.count({ where }),
      q.findMany({ where, orderBy: { id: 'desc' }, offset: (page - 1) * PAGE_SIZE, limit: PAGE_SIZE }),
      timeZone(),
    ]);
    const now = new Date();
    const results: PromotionListItem[] = (rows as any[]).map((row) => {
      const c = toCandidate(row, 0);
      return {
        id: c.id,
        name: c.name,
        code: c.code,
        method: c.method,
        status: promotionStatus(c, now),
        startsAt: c.startsAt ? (utcToZonedWallTime(c.startsAt, tz) ?? '') : '',
        endsAt: c.endsAt ? utcToZonedWallTime(c.endsAt, tz) : null,
        redemptions: c.redemptions,
        usageLimit: c.usageLimit,
      };
    });
    return { results, pagination: pagination(page, total) };
  };

  /** What the editor needs without other permissions: the locales and the store time zone. */
  const context = async (): Promise<{
    defaultLocale: string;
    locales: { code: string; name: string }[];
    timezone: string;
  }> => {
    const [defaultLocale, all, timezone] = await Promise.all([
      locales().getDefaultLocale(),
      locales().find(),
      timeZone(),
    ]);
    const list = ((all as any[]) ?? [])
      .filter((l) => typeof l?.code === 'string')
      .map((l) => ({ code: l.code as string, name: typeof l.name === 'string' && l.name ? l.name : l.code }));
    return { defaultLocale, locales: list, timezone };
  };

  const get = async (id: number | string): Promise<PromotionView> =>
    toView(await findRow(id), await timeZone());

  const create = async (raw: unknown, actor: string): Promise<PromotionView> => {
    const tz = await timeZone();
    const value = await validate(raw, tz);
    await assertCodeFree(value.code);
    const data = toRowData(value);
    const row = await strapi.db
      .query(uids().promotion)
      .create({ data: { ...data, redemptions: 0, version: 1, actor } })
      .catch(codeRace);
    await audit('create', row.id, actor, Object.keys(data).sort());
    return get(row.id);
  };

  const update = async (
    rawId: number | string,
    raw: Record<string, unknown> & { version: number },
    actor: string
  ): Promise<PromotionView> => {
    const id = Number(rawId);
    const version = raw?.version;
    if (typeof version !== 'number' || !Number.isInteger(version)) throw invalid('version', 'required');
    const current = await findRow(id);
    const tz = await timeZone();
    const value = await validate(raw, tz);
    await assertCodeFree(value.code, id);
    const data = toRowData(value);
    const { count } = await strapi.db
      .query(uids().promotion)
      .updateMany({ where: { id, version }, data: { ...data, version: version + 1, actor } })
      .catch(codeRace);
    if (!count) throw invalid('version', 'PROMOTION_VERSION_CONFLICT');
    const before = comparable(current);
    const after = comparable({ ...current, ...data });
    const fields = Object.keys(after).filter((k) => before[k] !== after[k]).sort();
    await audit('update', id, actor, fields);
    return get(id);
  };

  /** Only a promotion never used by an order can be deleted; otherwise deactivate it. */
  const remove = async (rawId: number | string, actor: string): Promise<void> => {
    const id = Number(rawId);
    const u = uids();
    await strapi.db.transaction(async ({ trx }: { trx: any }) => {
      // The row lock serializes against `reserve` (which bumps the same row): a checkout that
      // got there first has committed its redemption before the count below; one that comes
      // later finds no row and fails PROMOTION_UNAVAILABLE.
      if (!(await lockPromotion(trx, id, ['id']))) throw new EcommerceNotFoundError('Promotion not found');
      const used = await strapi.db.query(u.promotionRedemption).count({ where: { promotion: { id } } });
      if (used > 0) throw invalid('id', 'PROMOTION_IN_USE');
      await strapi.db.query(u.promotionCustomerUsage).deleteMany({ where: { promotion: { id } } });
      await strapi.db.query(u.promotion).delete({ where: { id } });
    });
    await audit('delete', id, actor, []);
  };

  const listRedemptions = async (
    rawId: number | string,
    params: { page?: number | string } = {}
  ): Promise<{ results: PromotionRedemptionView[]; pagination: ReturnType<typeof pagination> }> => {
    const id = Number(rawId);
    const q = strapi.db.query(uids().promotionRedemption);
    const page = pageOf(params?.page);
    const where = { promotion: { id } };
    const [total, rows] = await Promise.all([
      q.count({ where }),
      q.findMany({
        where,
        populate: { order: true, customer: { select: ['id'] } },
        orderBy: { id: 'desc' },
        offset: (page - 1) * PAGE_SIZE,
        limit: PAGE_SIZE,
      }),
    ]);
    const results = (rows as any[]).map((r) => ({
      id: r.id,
      orderId: idOf(r.order),
      orderReference: r.order && typeof r.order === 'object' ? (r.order.reference ?? null) : null,
      customerId: idOf(r.customer),
      maskedEmail: maskEmail(r.emailNormalized),
      amount: num(r.amount),
      status: r.status ?? 'RESERVED',
      createdAt: iso(r.createdAt),
      releasedAt: iso(r.releasedAt),
    }));
    return { results, pagination: pagination(page, total) };
  };

  const catalogSearch = (q: string, locale?: string) =>
    service('EcommerceOrderService').searchVariants(q, locale);

  // -------------------------------------------------------------------------
  // Engine inputs
  // -------------------------------------------------------------------------

  /**
   * Running automatic promotions plus the CODE promotions whose code was entered, in any
   * state (the engine reports why a code does not apply). Sorted by id.
   */
  const loadCandidates = async (p: {
    codes: string[];
    email: string | null;
    /** `false`: the per-customer usage is not read (it is never evaluated for unverified e-mails). */
    emailVerified?: boolean;
    /** Promotions loaded by id in any state, besides the running and entered ones (edited orders). */
    extraIds?: number[];
    /** Order whose own RESERVED redemptions are taken off the usage counts (edited orders). */
    ownOrderId?: number;
  }): Promise<PromotionCandidate[]> => {
    const u = uids();
    const q = strapi.db.query(u.promotion);
    const codes = [...new Set((p?.codes ?? []).map(normalizePromotionCode).filter(Boolean))];
    const now = new Date();
    // Dates are compared here (not in SQL): few automatic rows, and portable everywhere.
    const automatic: any[] = await q.findMany({ where: { method: 'AUTOMATIC', active: true } });
    const running = automatic.filter((r) => promotionStatus(toCandidate(r, 0), now) === 'ACTIVE');
    const coded: any[] = codes.length
      ? await q.findMany({ where: { method: 'CODE', code: { $in: codes } } })
      : [];
    const extraIds = [...new Set(p?.extraIds ?? [])];
    const extra: any[] = extraIds.length ? await q.findMany({ where: { id: { $in: extraIds } } }) : [];
    const rows = [...new Map([...running, ...coded, ...extra].map((r) => [r.id, r])).values()].sort(
      (a, b) => a.id - b.id
    );

    const email = p?.email && p.emailVerified !== false ? normalizeEmail(p.email) : '';
    const uses = new Map<string, number>();
    if (email && rows.length) {
      const keys = rows.map((r) => promotionUsageKey(r.id, email));
      const usage: any[] = await strapi.db
        .query(u.promotionCustomerUsage)
        .findMany({ where: { uniqueKey: { $in: keys } }, select: ['uniqueKey', 'uses'] });
      usage.forEach((x) => uses.set(x.uniqueKey, num(x.uses)));
    }
    // The order's own RESERVED use must not block the promotion it already holds.
    const own = new Map<number, string | null>();
    if (p?.ownOrderId !== undefined) {
      const held: any[] = await strapi.db.query(u.promotionRedemption).findMany({
        where: { order: { id: p.ownOrderId }, status: 'RESERVED' },
        populate: { promotion: { select: ['id'] } },
      });
      for (const r of held) {
        const id = idOf(r.promotion);
        if (id !== null) own.set(id, r.emailNormalized ?? null);
      }
    }
    return rows.map((r) => {
      const customerUses = email ? (uses.get(promotionUsageKey(r.id, email)) ?? 0) : 0;
      if (!own.has(r.id)) return toCandidate(r, customerUses);
      const ownEmail = own.get(r.id);
      const candidate = toCandidate(r, ownEmail && ownEmail === email ? Math.max(0, customerUses - 1) : customerUses);
      return { ...candidate, redemptions: Math.max(0, candidate.redemptions - 1) };
    });
  };

  /**
   * `loadCandidates` for editing an order (trusted, admin): the order's applied promotions are
   * also loaded by id in any state (inactive, expired; a deleted row is simply absent) so the
   * engine gives their real rejection reason, and the order's own RESERVED redemptions are
   * taken off `redemptions` and `customerUses`. A CODE promotion is only considered when its
   * code is entered, so the caller passes the current code of each applied one in `codes`.
   */
  const loadCandidatesForOrder = (p: {
    orderId: number;
    codes: string[];
    email: string | null;
    appliedIds: number[];
  }): Promise<PromotionCandidate[]> =>
    loadCandidates({ codes: p.codes, email: p.email, extraIds: p.appliedIds, ownOrderId: p.orderId });

  /**
   * One option per variant offered as a GIFT by any candidate. `available` is the stock minus
   * the cart units of the same variant (never negative); unknown variants are left out.
   */
  const giftOptions = async (
    candidates: PromotionCandidate[],
    cartQuantities: Map<number, number>
  ): Promise<Map<number, GiftOption>> => {
    const ids = new Set<number>();
    for (const c of candidates) {
      for (const b of c.benefits ?? []) {
        if (b.type === 'BUY_X_GET_Y' && b.get?.mode === 'GIFT') b.get.variantIds.forEach((id) => ids.add(id));
      }
    }
    const out = new Map<number, GiftOption>();
    if (!ids.size) return out;
    const variantIds = [...ids];
    const stock: Map<number, number> = await service('EcommerceStockService').available(variantIds);
    const products: any[] = await strapi.db.query(uids().product).findMany({
      where: { variants: { id: { $in: variantIds } } },
      populate: { variants: true },
    });
    for (const p of products) {
      for (const v of p.variants ?? []) {
        if (!ids.has(v.id)) continue;
        const inCart = cartQuantities.get(v.id) ?? 0;
        out.set(v.id, {
          variantId: v.id,
          productId: p.id,
          unitPrice: num(v.price),
          available: Math.max(0, (stock.get(v.id) ?? 0) - inCart),
          active: !!p.active && !!v.active,
        });
      }
    }
    return new Map(variantIds.filter((id) => out.has(id)).map((id) => [id, out.get(id) as GiftOption]));
  };

  // -------------------------------------------------------------------------
  // Capacity
  // -------------------------------------------------------------------------

  /**
   * `SELECT … FOR UPDATE` of one promotion row through knex (schema-aware connection), in the
   * caller's transaction; the result is keyed by attribute name. Null when the row is gone.
   */
  const lockPromotion = async (trx: any, id: number, attributes: string[]): Promise<any | null> => {
    const meta: any = strapi.db.metadata.get(uids().promotion as any);
    const columns = Object.fromEntries(
      attributes.map((a) => [a, meta.attributes?.[a]?.columnName ?? a])
    );
    const row = await strapi.db
      .getConnection(meta.tableName)
      .select(columns)
      .where({ id })
      .forUpdate()
      .first()
      .transacting(trx);
    return row ?? null;
  };

  /** Atomic `column = column + delta` on one row; `guards` are `[column, op, constant]`. */
  const bump = async (
    trx: any,
    uid: string,
    id: number,
    column: 'redemptions' | 'uses',
    delta: 1 | -1,
    where: Record<string, unknown>,
    guards: [string, string, number][]
  ): Promise<number> => {
    const { tableName } = strapi.db.metadata.get(uid as any);
    // getConnection applies the configured `connection.schema` (PostgreSQL non-default schema).
    let q = strapi.db.getConnection(tableName).where({ ...where, id });
    for (const [col, op, value] of guards) q = q.where(col, op, value);
    const affected =
      delta > 0 ? await q.increment(column, 1).transacting(trx) : await q.decrement(column, 1).transacting(trx);
    return Number(affected) || 0;
  };

  /**
   * Takes one use of every applied promotion for the order, inside the caller's transaction:
   * the global counter (`active = true`, `redemptions <= usageLimit - 1`), the per-e-mail
   * counter (`uses <= perCustomerLimit - 1`, kept even without a limit) and a RESERVED
   * redemption. Any refusal throws `PROMOTION_UNAVAILABLE` and the caller's transaction rolls
   * everything back. A redemption already recorded for this promotion and order is skipped.
   */
  const reserve = async (applied: AppliedPromotion[], ctx: ReserveContext): Promise<void> => {
    const list = [...new Map((applied ?? []).map((a) => [a.promotionId, a])).values()].sort(
      (a, b) => a.promotionId - b.promotionId
    );
    if (!list.length) return;
    const u = uids();
    const email = normalizeEmail(ctx.email ?? '');
    await strapi.db.transaction(async ({ trx }: { trx: any }) => {
      const now = new Date();
      for (const a of list) {
        const key = redemptionKey(a.promotionId, ctx.orderId);
        const existing = await strapi.db
          .query(u.promotionRedemption)
          .findOne({ where: { uniqueKey: key }, select: ['id', 'status'] });
        if (existing && existing.status !== 'RELEASED') continue;
        // A locking (current) read: a snapshot read could predate an admin lowering a limit.
        const row = await lockPromotion(trx, a.promotionId, RESERVE_COLUMNS);
        const code = a.code ?? row?.code ?? null;
        if (!row) throw unavailable(a.promotionId, code);
        const current = toCandidate({ ...row, id: a.promotionId }, 0);
        if (promotionStatus(current, now) !== 'ACTIVE') throw unavailable(a.promotionId, code);

        // 1. Global capacity; the limit is a constant read from the row in this transaction.
        const globalGuards: [string, string, number][] =
          current.usageLimit === null ? [] : [['redemptions', '<=', current.usageLimit - 1]];
        if (!(await bump(trx, u.promotion, a.promotionId, 'redemptions', 1, { active: true }, globalGuards))) {
          throw unavailable(a.promotionId, code);
        }

        // 2. Per e-mail capacity. A concurrent create of the same counter fails on the unique
        // index and aborts the whole transaction (never caught here): the order retries.
        if (current.perCustomerLimit !== null && !email) throw unavailable(a.promotionId, code);
        if (email) {
          const usageKey = promotionUsageKey(a.promotionId, email);
          let usage = await strapi.db
            .query(u.promotionCustomerUsage)
            .findOne({ where: { uniqueKey: usageKey }, select: ['id'] });
          if (!usage) {
            usage = await strapi.db.query(u.promotionCustomerUsage).create({
              data: { promotion: a.promotionId, emailNormalized: email, uses: 0, uniqueKey: usageKey },
            });
          }
          const customerGuards: [string, string, number][] =
            current.perCustomerLimit === null ? [] : [['uses', '<=', current.perCustomerLimit - 1]];
          if (!(await bump(trx, u.promotionCustomerUsage, usage.id, 'uses', 1, {}, customerGuards))) {
            throw unavailable(a.promotionId, code);
          }
        }

        // 3. The redemption that the cancel releases (a released one of this order is taken back).
        if (existing) {
          const { count } = await strapi.db.query(u.promotionRedemption).updateMany({
            where: { id: existing.id, status: 'RELEASED' },
            data: { status: 'RESERVED', releasedAt: null, amount: num(a.amount), actor: ctx.actor ?? null },
          });
          // Lost the race to another take-back: undo through the failure of the transaction.
          if (!count) throw unavailable(a.promotionId, code);
          continue;
        }
        await strapi.db.query(u.promotionRedemption).create({
          data: {
            promotion: a.promotionId,
            order: ctx.orderId,
            customer: ctx.customerId ?? null,
            emailNormalized: email || null,
            promotionCode: code,
            amount: num(a.amount),
            status: 'RESERVED',
            releasedAt: null,
            uniqueKey: key,
            actor: ctx.actor ?? null,
          },
        });
      }
    });
  };

  /**
   * Gives back the capacity taken by the order: each RESERVED redemption is flipped to
   * RELEASED conditionally, and only the caller that flipped it decrements the counters
   * (guarded by `>= 1`). A repeated or concurrent call returns `[]` and changes nothing.
   */
  const releaseForOrder = async (
    orderId: number,
    _actor: string,
    _opts: { operationId?: string } = {},
    only?: number[]
  ): Promise<{ promotionId: number; promotionCode: string | null }[]> => {
    const u = uids();
    return strapi.db.transaction(async ({ trx }: { trx: any }) => {
      const rows: any[] = await strapi.db.query(u.promotionRedemption).findMany({
        where: { order: { id: orderId }, status: 'RESERVED' },
        populate: { promotion: true },
        orderBy: { id: 'asc' },
      });
      const released: { promotionId: number; promotionCode: string | null }[] = [];
      const releasedAt = new Date().toISOString();
      for (const r of rows) {
        if (only && !only.includes(idOf(r.promotion) as number)) continue;
        const { count } = await strapi.db.query(u.promotionRedemption).updateMany({
          where: { id: r.id, status: 'RESERVED' },
          data: { status: 'RELEASED', releasedAt },
        });
        if (!count) continue;
        const promotionId = idOf(r.promotion);
        if (promotionId !== null) {
          await bump(trx, u.promotion, promotionId, 'redemptions', -1, {}, [['redemptions', '>=', 1]]);
          if (r.emailNormalized) {
            const usage = await strapi.db.query(u.promotionCustomerUsage).findOne({
              where: { uniqueKey: promotionUsageKey(promotionId, r.emailNormalized) },
              select: ['id'],
            });
            if (usage) await bump(trx, u.promotionCustomerUsage, usage.id, 'uses', -1, {}, [['uses', '>=', 1]]);
          }
          released.push({ promotionId, promotionCode: r.promotionCode ?? null });
        }
      }
      return released.sort((a, b) => a.promotionId - b.promotionId);
    });
  };

  /** `releaseForOrder` limited to the given promotions (deselected on an edited order). */
  const releasePromotions = (
    orderId: number,
    promotionIds: number[]
  ): Promise<{ promotionId: number; promotionCode: string | null }[]> =>
    releaseForOrder(orderId, '', {}, promotionIds);

  /** Per promotion id, the status of the order's redemption (the order view reads it). */
  const redemptionStatuses = async (orderId: number): Promise<Map<number, 'RESERVED' | 'RELEASED'>> => {
    const rows: any[] = await strapi.db.query(uids().promotionRedemption).findMany({
      where: { order: { id: orderId } },
      populate: { promotion: { select: ['id'] } },
      orderBy: { id: 'asc' },
    });
    const out = new Map<number, 'RESERVED' | 'RELEASED'>();
    for (const r of rows) {
      const promotionId = idOf(r.promotion);
      if (promotionId !== null && (r.status === 'RESERVED' || r.status === 'RELEASED')) {
        out.set(promotionId, r.status);
      }
    }
    return out;
  };

  return {
    list,
    get,
    create,
    update,
    remove,
    listRedemptions,
    catalogSearch,
    context,
    searchLimit,
    evaluate,
    unmet,
    loadCandidates,
    loadCandidatesForOrder,
    giftOptions,
    reserve,
    releaseForOrder,
    releasePromotions,
    redemptionStatuses,
  };
};

export default EcommercePromotionService;
