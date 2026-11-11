import type { Core } from '@strapi/strapi';
import { randomBytes } from 'crypto';
import { PLUGIN_ID, LtbConfigs } from '../../../config';
import { EcommerceNotFoundError, EcommerceValidationError } from './errors';
import { isUniqueViolation } from './dbErrors';
import { MAX_MONEY_CENTS } from './domain/orders';
import { generateStoreCreditCode, storeCreditUsable } from './domain/storeCredit';

const PAGE_SIZE = 50;
const MAX_CODE_ATTEMPTS = 5;
const DEFAULT_VALIDITY_MONTHS = 12;

type Collector = { emit(e: any): void; flush(): Promise<void> };

export type IssueStoreCreditInput = {
  customerId: number;
  /** Integer cents > 0. */
  amount: number;
  /** ISO date-time; defaults to now + 12 months. */
  expiresAt?: string | null;
  conditions?: string | null;
  sourceOrderId?: number | null;
  sourceRefundId?: number | null;
  actor: string;
  /** Idempotency key of the ISSUE movement: a repeated key returns the same credit. */
  operationKey: string;
};

export type ConsumeStoreCreditInput = {
  code: string;
  /** The e-mail of the buyer (the order snapshot e-mail); compared normalized. */
  email: string;
  amount: number;
  orderId: number | null;
  paymentId: number | null;
  operationKey: string;
  actor?: string;
};

export type RestoreStoreCreditInput = {
  storeCreditId: number;
  amount: number;
  refundId: number | null;
  operationKey: string;
  orderId?: number | null;
  actor?: string;
};

export type StoreCreditView = {
  id: number;
  code: string;
  customerId: number | null;
  email: string | null;
  initialAmount: number;
  balance: number;
  currency: string;
  expiresAt: string | null;
  status: 'ACTIVE' | 'VOID';
  sourceOrderId: number | null;
  sourceRefundId: number | null;
  conditions: string | null;
  actor: string | null;
  createdAt: string | null;
};

export type StoreCreditMovementView = {
  id: number;
  type: 'ISSUE' | 'CONSUME' | 'RESTORE' | 'ADJUST';
  /** Signed: ISSUE/RESTORE positive, CONSUME negative, ADJUST either. */
  amount: number;
  orderId: number | null;
  paymentId: number | null;
  refundId: number | null;
  operationKey: string;
  actor: string | null;
  createdAt: string | null;
};

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const idOf = (v: any): number | null =>
  v === null || v === undefined ? null : Number(typeof v === 'object' ? v.id : v);
const clean = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
/** Codes are compared upper-case and trimmed (the alphabet has no lower-case letters). */
export const normalizeStoreCreditCode = (code: unknown): string => clean(code).toUpperCase();

const invalid = (path: string, code: string) =>
  new EcommerceValidationError('Invalid store credit', [{ path, code }]);

const validAmount = (amount: unknown): amount is number =>
  typeof amount === 'number' && Number.isSafeInteger(amount) && amount > 0 && amount <= MAX_MONEY_CENTS;

const defaultExpiry = (): string => {
  const d = new Date();
  d.setMonth(d.getMonth() + DEFAULT_VALIDITY_MONTHS);
  return d.toISOString();
};

export const toStoreCreditView = (row: any): StoreCreditView => ({
  id: row.id,
  code: row.code,
  customerId: idOf(row.customer),
  email: row.emailNormalized ?? null,
  initialAmount: num(row.initialAmount),
  balance: num(row.balance),
  currency: row.currency ?? 'EUR',
  expiresAt: row.expiresAt ? new Date(row.expiresAt).toISOString() : null,
  status: row.status ?? 'ACTIVE',
  sourceOrderId: idOf(row.sourceOrder),
  sourceRefundId: idOf(row.sourceRefund),
  conditions: row.conditions ?? null,
  actor: row.actor ?? null,
  createdAt: row.createdAt ?? null,
});

const toMovementView = (m: any): StoreCreditMovementView => ({
  id: m.id,
  type: m.type,
  amount: num(m.amount),
  orderId: idOf(m.order),
  paymentId: idOf(m.payment),
  refundId: idOf(m.refund),
  operationKey: m.operationKey,
  actor: m.actor ?? null,
  createdAt: m.createdAt ?? null,
});

/**
 * Store credit vouchers (design 4.7): a balance valid only for the customer's normalized
 * e-mail, with a ledger of movements whose `operationKey` is unique (every write is
 * idempotent). Consumption is a strict conditional decrement (`balance >= amount`) that never
 * overdraws. Every write joins the caller's transaction when there is one.
 */
const EcommerceStoreCreditService = ({ strapi }: { strapi: Core.Strapi }) => {
  const uids = () => {
    const config: LtbConfigs = strapi.config.get(`plugin::${PLUGIN_ID}`);
    return config.uuid.modules.ecommerce;
  };
  const service = (name: string): any => strapi.plugin(PLUGIN_ID).service(name);
  const events = (): { collector(): Collector } => service('EcommerceEventBus');

  const movementByKey = (operationKey: string) =>
    strapi.db.query(uids().storeCreditMovement).findOne({
      where: { operationKey },
      populate: { storeCredit: true },
    });

  /** Atomic `balance = balance + delta`, guarded by `balance >= -delta` when decrementing. */
  const changeBalance = async (trx: any, id: number, delta: number): Promise<number> => {
    const { tableName } = strapi.db.metadata.get(uids().storeCredit);
    const q = strapi.db.connection(tableName).where({ id });
    const affected =
      delta < 0
        ? await q.where('balance', '>=', -delta).decrement('balance', -delta).transacting(trx)
        : await q.increment('balance', delta).transacting(trx);
    return Number(affected) || 0;
  };

  const createWithUniqueCode = async (data: Record<string, unknown>) => {
    const q = strapi.db.query(uids().storeCredit);
    for (let attempt = 1; ; attempt += 1) {
      const code = generateStoreCreditCode(randomBytes);
      // Checked first: on PostgreSQL a failed INSERT would abort the caller's transaction.
      if (await q.findOne({ where: { code }, select: ['id'] })) continue;
      try {
        return await q.create({ data: { ...data, code } });
      } catch (err) {
        if (!isUniqueViolation(err) || attempt >= MAX_CODE_ATTEMPTS) throw err;
      }
    }
  };

  /**
   * Issues a credit. With `opts.collector` (a caller running its own transaction) the
   * `STORE_CREDIT_ISSUED` event goes there and the caller flushes it after its commit.
   */
  const issue = async (
    input: IssueStoreCreditInput,
    opts: { collector?: { emit(e: any): void } } = {}
  ): Promise<StoreCreditView> => {
    const operationKey = clean(input?.operationKey);
    if (!operationKey) throw invalid('operationKey', 'required');
    const replay = await movementByKey(operationKey);
    if (replay?.storeCredit) return toStoreCreditView(replay.storeCredit);

    if (!validAmount(input?.amount)) throw invalid('amount', 'invalid_amount');
    let expiresAt = defaultExpiry();
    if (input.expiresAt !== undefined && input.expiresAt !== null && input.expiresAt !== '') {
      const t = Date.parse(String(input.expiresAt));
      if (!Number.isFinite(t) || t <= Date.now()) throw invalid('expiresAt', 'invalid_date');
      expiresAt = new Date(t).toISOString();
    }
    const u = uids();
    const customer = await strapi.db
      .query(u.customer)
      .findOne({ where: { id: Number(input.customerId) }, select: ['id', 'emailNormalized'] });
    if (!customer || !customer.emailNormalized) throw invalid('customerId', 'customer_not_found');

    const own = opts.collector ? null : events().collector();
    const collector = opts.collector ?? (own as Collector);
    const created = await strapi.db.transaction(async () => {
      const row = await createWithUniqueCode({
        customer: customer.id,
        emailNormalized: customer.emailNormalized,
        initialAmount: input.amount,
        balance: input.amount,
        currency: 'EUR',
        expiresAt,
        status: 'ACTIVE',
        sourceOrder: input.sourceOrderId ?? null,
        sourceRefund: input.sourceRefundId ?? null,
        conditions: clean(input.conditions) || null,
        actor: input.actor,
      });
      await strapi.db.query(u.storeCreditMovement).create({
        data: {
          storeCredit: row.id,
          type: 'ISSUE',
          amount: input.amount,
          order: input.sourceOrderId ?? null,
          payment: null,
          refund: input.sourceRefundId ?? null,
          operationKey,
          actor: input.actor,
        },
      });
      collector.emit({
        type: 'STORE_CREDIT_ISSUED',
        ...(input.sourceOrderId ? { orderId: input.sourceOrderId } : {}),
        payload: {
          storeCreditId: row.id,
          code: row.code,
          amount: input.amount,
          expiresAt,
          conditions: row.conditions ?? null,
          customerId: customer.id,
          refundId: input.sourceRefundId ?? null,
        },
      });
      return row;
    });
    if (own) await own.flush();
    return toStoreCreditView(created);
  };

  /**
   * Spends `amount` of the credit `code` for `email`. Throws a validation error with the
   * `storeCreditUsable` code, or `STORE_CREDIT_INSUFFICIENT` when the conditional decrement
   * changed no row (a concurrent consumption won). Public callers map the code with
   * `toPublicStoreCreditError`.
   */
  const consume = async (input: ConsumeStoreCreditInput): Promise<{ storeCreditId: number }> => {
    const operationKey = clean(input?.operationKey);
    if (!operationKey) throw invalid('operationKey', 'required');
    const replay = await movementByKey(operationKey);
    if (replay) return { storeCreditId: idOf(replay.storeCredit) as number };
    if (!validAmount(input?.amount)) throw invalid('amount', 'invalid_amount');

    const u = uids();
    return strapi.db.transaction(async ({ trx }: { trx: any }) => {
      const code = normalizeStoreCreditCode(input.code);
      const credit = code ? await strapi.db.query(u.storeCredit).findOne({ where: { code } }) : null;
      if (!credit) throw invalid('code', 'STORE_CREDIT_NOT_FOUND');
      const usable = storeCreditUsable(
        {
          status: credit.status,
          balance: num(credit.balance),
          expiresAt: credit.expiresAt ?? null,
          emailNormalized: credit.emailNormalized ?? '',
        },
        input.email,
        new Date()
      );
      if ('code' in usable) throw invalid('code', usable.code);

      if ((await changeBalance(trx, credit.id, -input.amount)) === 0) {
        throw invalid('code', 'STORE_CREDIT_INSUFFICIENT');
      }
      await strapi.db.query(u.storeCreditMovement).create({
        data: {
          storeCredit: credit.id,
          type: 'CONSUME',
          amount: -input.amount,
          order: input.orderId ?? null,
          payment: input.paymentId ?? null,
          refund: null,
          operationKey,
          actor: input.actor ?? null,
        },
      });
      return { storeCreditId: credit.id };
    });
  };

  /** Gives `amount` back to the credit. `applied: false` when the key was already used. */
  const restore = async (input: RestoreStoreCreditInput): Promise<{ applied: boolean }> => {
    const operationKey = clean(input?.operationKey);
    if (!operationKey) throw invalid('operationKey', 'required');
    if (await movementByKey(operationKey)) return { applied: false };
    if (!validAmount(input?.amount)) throw invalid('amount', 'invalid_amount');
    const u = uids();
    try {
      return await strapi.db.transaction(async ({ trx }: { trx: any }) => {
        // The movement first: a concurrent restore with the same key fails on the index.
        await strapi.db.query(u.storeCreditMovement).create({
          data: {
            storeCredit: input.storeCreditId,
            type: 'RESTORE',
            amount: input.amount,
            order: input.orderId ?? null,
            payment: null,
            refund: input.refundId ?? null,
            operationKey,
            actor: input.actor ?? null,
          },
        });
        if ((await changeBalance(trx, input.storeCreditId, input.amount)) === 0) {
          throw new EcommerceNotFoundError('Store credit not found');
        }
        return { applied: true };
      });
    } catch (err) {
      if (isUniqueViolation(err)) return { applied: false };
      throw err;
    }
  };

  const listForCustomer = async (customerId: number | string): Promise<StoreCreditView[]> => {
    const rows: any[] = await strapi.db.query(uids().storeCredit).findMany({
      where: { customer: { id: Number(customerId) } },
      orderBy: { id: 'desc' },
    });
    return rows.map(toStoreCreditView);
  };

  const get = async (
    rawId: number | string
  ): Promise<StoreCreditView & { movements: StoreCreditMovementView[] }> => {
    const id = Number(rawId);
    const u = uids();
    const row = await strapi.db.query(u.storeCredit).findOne({ where: { id } });
    if (!row) throw new EcommerceNotFoundError('Store credit not found');
    const movements: any[] = await strapi.db.query(u.storeCreditMovement).findMany({
      where: { storeCredit: { id } },
      orderBy: { id: 'asc' },
    });
    return { ...toStoreCreditView(row), movements: movements.map(toMovementView) };
  };

  const list = async (params: { page?: number | string; search?: string } = {}) => {
    const q = strapi.db.query(uids().storeCredit);
    const n = Math.floor(Number(params?.page));
    const page = Number.isFinite(n) && n > 0 ? n : 1;
    const term = clean(params?.search);
    const where: Record<string, unknown> = term
      ? {
          $or: [
            { code: { $containsi: term.toUpperCase() } },
            { emailNormalized: { $containsi: term.toLowerCase() } },
          ],
        }
      : {};
    const [total, rows] = await Promise.all([
      q.count({ where }),
      q.findMany({
        where,
        orderBy: { id: 'desc' },
        offset: (page - 1) * PAGE_SIZE,
        limit: PAGE_SIZE,
      }),
    ]);
    return {
      results: (rows as any[]).map(toStoreCreditView),
      pagination: { page, pageSize: PAGE_SIZE, total, pageCount: Math.ceil(total / PAGE_SIZE) },
    };
  };

  /** Voids the credit: status VOID, the remaining balance written off by an ADJUST movement. */
  const voidCredit = async (rawId: number | string, actor: string): Promise<StoreCreditView> => {
    const id = Number(rawId);
    const u = uids();
    await strapi.db.transaction(async () => {
      const row = await strapi.db.query(u.storeCredit).findOne({ where: { id } });
      if (!row) throw new EcommerceNotFoundError('Store credit not found');
      if (row.status === 'VOID') return;
      const { count } = await strapi.db.query(u.storeCredit).updateMany({
        where: { id, status: 'ACTIVE' },
        data: { status: 'VOID', balance: 0 },
      });
      if (!count) return;
      await strapi.db.query(u.storeCreditMovement).create({
        data: {
          storeCredit: id,
          type: 'ADJUST',
          amount: -num(row.balance),
          order: null,
          payment: null,
          refund: null,
          operationKey: `void:${id}`,
          actor,
        },
      });
    });
    const row = await strapi.db.query(u.storeCredit).findOne({ where: { id } });
    return toStoreCreditView(row);
  };

  return { issue, consume, restore, listForCustomer, get, list, void: voidCredit };
};

export default EcommerceStoreCreditService;
