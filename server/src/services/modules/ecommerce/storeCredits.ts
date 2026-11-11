import type { Core } from '@strapi/strapi';
import { randomBytes } from 'crypto';
import { PLUGIN_ID, LtbConfigs } from '../../../config';
import { EcommerceNotFoundError, EcommerceValidationError } from './errors';
import { isUniqueViolation } from './dbErrors';
import { MAX_MONEY_CENTS } from './domain/orders';
import { generateStoreCreditCode, storeCreditUsable } from './domain/storeCredit';

const PAGE_SIZE = 50;
const MAX_CODE_ATTEMPTS = 5;
const MAX_VOID_ATTEMPTS = 3;
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

export type RestoreStoreCreditResult = {
  /** False when the operationKey was already used (nothing changed). */
  applied: boolean;
  /** The credit that received the amount: the original, or the one issued to replace it. */
  storeCreditId: number;
  code: string;
  /** Set when the original was VOID or expired and a new credit was issued instead. */
  reissuedFrom: { id: number; code: string } | null;
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

  /** Atomic `balance = balance + delta`, guarded by `balance >= -delta` when decrementing and by `guard` (column values). */
  const changeBalance = async (
    trx: any,
    id: number,
    delta: number,
    guard: Record<string, unknown> = {}
  ): Promise<number> => {
    const { tableName } = strapi.db.metadata.get(uids().storeCredit);
    // getConnection applies the configured `connection.schema` (PostgreSQL non-default schema).
    const q = strapi.db.getConnection(tableName).where({ ...guard, id });
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
   * Creates an ACTIVE credit with its ISSUE movement and emits `STORE_CREDIT_ISSUED`. Joins the
   * caller's transaction.
   */
  const createCredit = async (
    p: {
      customerId: number | null;
      emailNormalized: string;
      amount: number;
      expiresAt: string;
      conditions: string | null;
      sourceOrderId: number | null;
      sourceRefundId: number | null;
      actor: string | null;
      operationKey: string;
      replacesStoreCreditId?: number;
    },
    collector: { emit(e: any): void }
  ) => {
    const u = uids();
    const row = await createWithUniqueCode({
      customer: p.customerId,
      emailNormalized: p.emailNormalized,
      initialAmount: p.amount,
      balance: p.amount,
      currency: 'EUR',
      expiresAt: p.expiresAt,
      status: 'ACTIVE',
      sourceOrder: p.sourceOrderId,
      sourceRefund: p.sourceRefundId,
      conditions: clean(p.conditions) || null,
      actor: p.actor,
    });
    await strapi.db.query(u.storeCreditMovement).create({
      data: {
        storeCredit: row.id,
        type: 'ISSUE',
        amount: p.amount,
        order: p.sourceOrderId,
        payment: null,
        refund: p.sourceRefundId,
        operationKey: p.operationKey,
        actor: p.actor,
      },
    });
    collector.emit({
      type: 'STORE_CREDIT_ISSUED',
      ...(p.sourceOrderId ? { orderId: p.sourceOrderId } : {}),
      payload: {
        storeCreditId: row.id,
        code: row.code,
        amount: p.amount,
        expiresAt: p.expiresAt,
        conditions: row.conditions ?? null,
        customerId: p.customerId,
        refundId: p.sourceRefundId,
        ...(p.replacesStoreCreditId ? { replacesStoreCreditId: p.replacesStoreCreditId } : {}),
      },
    });
    return row;
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
    const created = await strapi.db.transaction(() =>
      createCredit(
        {
          customerId: customer.id,
          emailNormalized: customer.emailNormalized,
          amount: input.amount,
          expiresAt,
          conditions: input.conditions ?? null,
          sourceOrderId: input.sourceOrderId ?? null,
          sourceRefundId: input.sourceRefundId ?? null,
          actor: input.actor,
          operationKey,
        },
        collector
      )
    );
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

  /**
   * Gives `amount` back to the credit. A VOID or expired credit is never topped up (the value
   * would be unusable): a new credit for the same customer e-mail is issued instead, with the
   * default validity, its ISSUE movement under the same `operationKey` and a
   * `STORE_CREDIT_ISSUED` event (`replacesStoreCreditId`). `applied: false` when the key was
   * already used. With `opts.collector` events go to the caller, which flushes after its commit.
   */
  const restore = async (
    input: RestoreStoreCreditInput,
    opts: { collector?: { emit(e: any): void } } = {}
  ): Promise<RestoreStoreCreditResult> => {
    const operationKey = clean(input?.operationKey);
    if (!operationKey) throw invalid('operationKey', 'required');
    const replayed = (m: any): RestoreStoreCreditResult => ({
      applied: false,
      storeCreditId: idOf(m.storeCredit) as number,
      code: m.storeCredit?.code ?? '',
      reissuedFrom: null,
    });
    const replay = await movementByKey(operationKey);
    if (replay) return replayed(replay);
    if (!validAmount(input?.amount)) throw invalid('amount', 'invalid_amount');
    const u = uids();
    const own = opts.collector ? null : events().collector();
    const collector = opts.collector ?? (own as Collector);
    let result: RestoreStoreCreditResult;
    try {
      result = await strapi.db.transaction(async ({ trx }: { trx: any }) => {
        const credit = await strapi.db
          .query(u.storeCredit)
          .findOne({ where: { id: input.storeCreditId } });
        if (!credit) throw new EcommerceNotFoundError('Store credit not found');
        // A VOID or expired credit is never topped up: a new credit carries the value instead.
        const reissue = async (): Promise<RestoreStoreCreditResult> => {
          const row = await createCredit(
            {
              customerId: idOf(credit.customer),
              emailNormalized: credit.emailNormalized,
              amount: input.amount,
              expiresAt: defaultExpiry(),
              conditions: credit.conditions ?? null,
              sourceOrderId: input.orderId ?? null,
              sourceRefundId: input.refundId ?? null,
              actor: input.actor ?? null,
              operationKey,
              replacesStoreCreditId: credit.id,
            },
            collector
          );
          return {
            applied: true,
            storeCreditId: row.id,
            code: row.code,
            reissuedFrom: { id: credit.id, code: credit.code },
          };
        };
        const expired = !!credit.expiresAt && Date.parse(credit.expiresAt) <= Date.now();
        if (credit.status !== 'ACTIVE' || expired) return reissue();
        // Conditional on ACTIVE: a void committed after the read leaves 0 rows, and the value
        // goes to a new credit instead of a dead balance.
        if ((await changeBalance(trx, credit.id, input.amount, { status: 'ACTIVE' })) === 0) {
          return reissue();
        }
        // The movement after the guarded increment, in the same transaction: a concurrent
        // restore with the same key fails on the index and rolls the increment back.
        // (Pre-checked above and serialized by the order lock; on PostgreSQL a violation here
        // would abort a caller's transaction.)
        await strapi.db.query(u.storeCreditMovement).create({
          data: {
            storeCredit: credit.id,
            type: 'RESTORE',
            amount: input.amount,
            order: input.orderId ?? null,
            payment: null,
            refund: input.refundId ?? null,
            operationKey,
            actor: input.actor ?? null,
          },
        });
        return { applied: true, storeCreditId: credit.id, code: credit.code, reissuedFrom: null };
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        const winner = await movementByKey(operationKey);
        if (winner) return replayed(winner);
      }
      throw err;
    }
    if (own) await own.flush();
    return result;
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

  /**
   * Voids the credit: status VOID, the remaining balance written off by an ADJUST movement.
   * The write is conditional on the balance read, so the ADJUST always matches what was
   * written off; a concurrent change is re-read and retried, then `STORE_CREDIT_CONFLICT`.
   */
  const voidCredit = async (rawId: number | string, actor: string): Promise<StoreCreditView> => {
    const id = Number(rawId);
    const u = uids();
    await strapi.db.transaction(async () => {
      for (let attempt = 1; ; attempt += 1) {
        const row = await strapi.db.query(u.storeCredit).findOne({ where: { id } });
        if (!row) throw new EcommerceNotFoundError('Store credit not found');
        if (row.status === 'VOID') return;
        const { count } = await strapi.db.query(u.storeCredit).updateMany({
          where: { id, status: 'ACTIVE', balance: row.balance },
          data: { status: 'VOID', balance: 0 },
        });
        if (count) {
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
          return;
        }
        if (attempt >= MAX_VOID_ATTEMPTS) throw invalid('balance', 'STORE_CREDIT_CONFLICT');
      }
    });
    const row = await strapi.db.query(u.storeCredit).findOne({ where: { id } });
    return toStoreCreditView(row);
  };

  return { issue, consume, restore, listForCustomer, get, list, void: voidCredit };
};

export default EcommerceStoreCreditService;
