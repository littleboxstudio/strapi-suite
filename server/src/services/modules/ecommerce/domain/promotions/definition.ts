import type { ValidationIssue } from '../../errors';
import { MAX_MONEY_CENTS } from '../orders';
import { isValidEmailFormat, normalizeEmail } from '../email';
import { MAX_PROMOTION_CODE_LENGTH } from '../storefront/limits';
import { isValidTimeZone, zonedWallTimeToUtc } from './time';
import type {
  Benefit,
  Condition,
  ConditionGroup,
  Eligibility,
  NumberOperator,
  ProductTarget,
  PromotionDefinition,
  Reward,
  Stacking,
} from './types';

export type PromotionInput = Omit<PromotionDefinition, 'id' | 'version'> & {
  description: string | null;
  active: boolean;
  startsAt: string;
  endsAt: string | null;
  usageLimit: number | null;
  perCustomerLimit: number | null;
};

const CODE_RE = new RegExp(`^[A-Z0-9_-]{3,${MAX_PROMOTION_CODE_LENGTH}}$`);
const VOUCHER_RE = /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;
const NUMBER_OPERATORS: NumberOperator[] = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'];
const EMAIL_OPERATORS = ['eq', 'neq', 'contains', 'not_contains'];
const MAX_DEPTH = 3;
const MAX_LEAVES = 50;
const MAX_QUANTITY = 100_000;
const MAX_IDS = 500;
const MAX_LIMIT = 1_000_000;

export const normalizePromotionCode = (raw: unknown): string =>
  typeof raw === 'string' ? raw.trim().toUpperCase() : '';

export const displayNameFor = (
  p: { name: string; displayName: Record<string, string> },
  locale: string,
  defaultLocale: string
): string => p.displayName?.[locale] || p.displayName?.[defaultLocale] || p.name;

const isObj = (v: unknown): v is Record<string, any> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

const validPercent = (v: unknown): v is number =>
  typeof v === 'number' &&
  Number.isFinite(v) &&
  v > 0 &&
  v <= 100 &&
  Math.abs(v * 100 - Math.round(v * 100)) < 1e-9;

const validMoney = (v: unknown, min: number): v is number =>
  isInt(v) && v >= min && v <= MAX_MONEY_CENTS;

const validNullableLimit = (v: unknown): boolean => v === null || (isInt(v) && v >= 1 && v <= MAX_LIMIT);

type Issues = ValidationIssue[];

function readTarget(raw: unknown, path: string, errors: Issues): ProductTarget {
  const target: ProductTarget = { productIds: [], variantIds: [] };
  if (!isObj(raw)) {
    errors.push({ path, code: 'required' });
    return target;
  }
  for (const key of ['productIds', 'variantIds'] as const) {
    const list = raw[key] ?? [];
    if (!Array.isArray(list) || list.length > MAX_IDS || !list.every((n) => isInt(n) && n > 0)) {
      errors.push({ path: `${path}.${key}`, code: 'invalid_value' });
      continue;
    }
    target[key] = [...new Set(list as number[])];
  }
  if (!target.productIds.length && !target.variantIds.length) errors.push({ path, code: 'required' });
  return target;
}

function readQuantity(raw: unknown, path: string, errors: Issues, min = 0): number {
  if (!isInt(raw) || raw < min || raw > MAX_QUANTITY) {
    errors.push({ path, code: 'invalid_value' });
    return 0;
  }
  return raw;
}

function readOperator(raw: unknown, allowed: readonly string[], path: string, errors: Issues): any {
  if (typeof raw !== 'string' || !allowed.includes(raw)) {
    errors.push({ path, code: 'invalid_operator' });
    return allowed[0];
  }
  return raw;
}

function readCondition(raw: unknown, path: string, errors: Issues): Condition | null {
  if (!isObj(raw)) {
    errors.push({ path, code: 'invalid' });
    return null;
  }
  switch (raw.type) {
    case 'SUBTOTAL': {
      const operator = readOperator(raw.operator, NUMBER_OPERATORS, `${path}.operator`, errors);
      if (!validMoney(raw.value, 0)) errors.push({ path: `${path}.value`, code: 'invalid_value' });
      return { type: 'SUBTOTAL', operator, value: raw.value };
    }
    case 'SUBTOTAL_BETWEEN': {
      if (!validMoney(raw.min, 0)) errors.push({ path: `${path}.min`, code: 'invalid_value' });
      if (!validMoney(raw.max, 0)) errors.push({ path: `${path}.max`, code: 'invalid_value' });
      else if (validMoney(raw.min, 0) && raw.min > raw.max) {
        errors.push({ path: `${path}.max`, code: 'invalid_value' });
      }
      return { type: 'SUBTOTAL_BETWEEN', min: raw.min, max: raw.max };
    }
    case 'CART_CONTAINS': {
      if (!['ANY', 'ALL', 'NONE'].includes(raw.match)) errors.push({ path: `${path}.match`, code: 'invalid' });
      return { type: 'CART_CONTAINS', match: raw.match, target: readTarget(raw.target, `${path}.target`, errors) };
    }
    case 'PRODUCT_QUANTITY': {
      const target = readTarget(raw.target, `${path}.target`, errors);
      const operator = readOperator(raw.operator, NUMBER_OPERATORS, `${path}.operator`, errors);
      return { type: 'PRODUCT_QUANTITY', target, operator, value: readQuantity(raw.value, `${path}.value`, errors) };
    }
    case 'TOTAL_QUANTITY':
    case 'DISTINCT_PRODUCTS': {
      const operator = readOperator(raw.operator, NUMBER_OPERATORS, `${path}.operator`, errors);
      return { type: raw.type, operator, value: readQuantity(raw.value, `${path}.value`, errors) };
    }
    case 'EMAIL': {
      const operator = readOperator(raw.operator, EMAIL_OPERATORS, `${path}.operator`, errors);
      const value = typeof raw.value === 'string' ? raw.value.trim().toLowerCase() : '';
      if (!value || value.length > 254) errors.push({ path: `${path}.value`, code: 'invalid_value' });
      else if ((operator === 'eq' || operator === 'neq') && !isValidEmailFormat(value)) {
        errors.push({ path: `${path}.value`, code: 'invalid_email' });
      }
      return { type: 'EMAIL', operator, value };
    }
    default:
      errors.push({ path: `${path}.type`, code: 'invalid' });
      return null;
  }
}

function readGroup(
  raw: unknown,
  path: string,
  errors: Issues,
  leaves: { n: number; tooDeep: boolean },
  depth = 1
): ConditionGroup {
  const group: ConditionGroup = { type: 'GROUP', operator: 'AND', children: [] };
  if (depth > MAX_DEPTH) {
    leaves.tooDeep = true;
    return group;
  }
  if (!isObj(raw) || raw.type !== 'GROUP' || !Array.isArray(raw.children)) {
    errors.push({ path, code: 'invalid' });
    return group;
  }
  if (raw.operator !== 'AND' && raw.operator !== 'OR') errors.push({ path: `${path}.operator`, code: 'invalid_operator' });
  else group.operator = raw.operator;
  raw.children.forEach((child: unknown, i: number) => {
    const childPath = `${path}.children.${i}`;
    if (isObj(child) && child.type === 'GROUP') {
      group.children.push(readGroup(child, childPath, errors, leaves, depth + 1));
      return;
    }
    leaves.n += 1;
    const c = readCondition(child, childPath, errors);
    if (c) group.children.push(c);
  });
  return group;
}

function readReward(raw: unknown, path: string, errors: Issues): Reward {
  if (isObj(raw) && raw.kind === 'FREE') return { kind: 'FREE' };
  if (isObj(raw) && raw.kind === 'PERCENT') {
    if (!validPercent(raw.percent)) errors.push({ path: `${path}.percent`, code: 'invalid_percent' });
    return { kind: 'PERCENT', percent: raw.percent };
  }
  if (isObj(raw) && raw.kind === 'FIXED') {
    if (!validMoney(raw.amount, 1)) errors.push({ path: `${path}.amount`, code: 'invalid_amount' });
    return { kind: 'FIXED', amount: raw.amount };
  }
  errors.push({ path: `${path}.kind`, code: 'invalid' });
  return { kind: 'FREE' };
}

function readMaxQuantity(raw: unknown, path: string, errors: Issues): number | null {
  if (raw === null || raw === undefined) return null;
  if (!isInt(raw) || raw < 1 || raw > MAX_QUANTITY) {
    errors.push({ path, code: 'invalid_value' });
    return null;
  }
  return raw;
}

function readBenefit(raw: unknown, path: string, errors: Issues): Benefit | null {
  if (!isObj(raw)) {
    errors.push({ path, code: 'invalid' });
    return null;
  }
  const percent = (key = 'percent') => {
    if (!validPercent(raw[key])) errors.push({ path: `${path}.${key}`, code: 'invalid_percent' });
    return raw[key] as number;
  };
  const amount = (key = 'amount') => {
    if (!validMoney(raw[key], 1)) errors.push({ path: `${path}.${key}`, code: 'invalid_amount' });
    return raw[key] as number;
  };
  switch (raw.type) {
    case 'PRODUCT_PERCENT':
      return {
        type: 'PRODUCT_PERCENT',
        target: readTarget(raw.target, `${path}.target`, errors),
        percent: percent(),
        maxQuantity: readMaxQuantity(raw.maxQuantity, `${path}.maxQuantity`, errors),
      };
    case 'PRODUCT_FIXED': {
      if (raw.per !== 'UNIT' && raw.per !== 'SET') errors.push({ path: `${path}.per`, code: 'invalid' });
      return {
        type: 'PRODUCT_FIXED',
        target: readTarget(raw.target, `${path}.target`, errors),
        amount: amount(),
        per: raw.per === 'SET' ? 'SET' : 'UNIT',
        maxQuantity: readMaxQuantity(raw.maxQuantity, `${path}.maxQuantity`, errors),
      };
    }
    case 'BUY_X_GET_Y': {
      const buyRaw = isObj(raw.buy) ? raw.buy : {};
      if (!isObj(raw.buy)) errors.push({ path: `${path}.buy`, code: 'required' });
      const buy = {
        target: readTarget(buyRaw.target, `${path}.buy.target`, errors),
        quantity: readQuantity(buyRaw.quantity, `${path}.buy.quantity`, errors, 1),
        minAmount:
          buyRaw.minAmount === null || buyRaw.minAmount === undefined
            ? null
            : validMoney(buyRaw.minAmount, 0)
              ? (buyRaw.minAmount as number)
              : (errors.push({ path: `${path}.buy.minAmount`, code: 'invalid_amount' }), null),
      };
      const getRaw = isObj(raw.get) ? raw.get : {};
      let get: Extract<Benefit, { type: 'BUY_X_GET_Y' }>['get'];
      if (getRaw.mode === 'GIFT') {
        const ids = getRaw.variantIds;
        if (!Array.isArray(ids) || ids.length < 1 || ids.length > 20 || !ids.every((n) => isInt(n) && n > 0)) {
          errors.push({ path: `${path}.get.variantIds`, code: 'required' });
        }
        get = {
          mode: 'GIFT',
          variantIds: Array.isArray(ids) ? [...new Set(ids.filter((n): n is number => isInt(n)))] : [],
          quantity: readQuantity(getRaw.quantity, `${path}.get.quantity`, errors, 1),
        };
      } else {
        if (getRaw.mode !== 'IN_CART') errors.push({ path: `${path}.get.mode`, code: 'invalid' });
        get = {
          mode: 'IN_CART',
          target: readTarget(getRaw.target, `${path}.get.target`, errors),
          quantity: readQuantity(getRaw.quantity, `${path}.get.quantity`, errors, 1),
        };
      }
      return { type: 'BUY_X_GET_Y', buy, get, reward: readReward(raw.reward, `${path}.reward`, errors) };
    }
    case 'ORDER_PERCENT':
      return { type: 'ORDER_PERCENT', percent: percent() };
    case 'ORDER_FIXED':
      return { type: 'ORDER_FIXED', amount: amount() };
    case 'SHIPPING_FREE': {
      let maxAmount: number | null = null;
      if (raw.maxAmount !== null && raw.maxAmount !== undefined) {
        if (validMoney(raw.maxAmount, 1)) maxAmount = raw.maxAmount;
        else errors.push({ path: `${path}.maxAmount`, code: 'invalid_amount' });
      }
      return { type: 'SHIPPING_FREE', maxAmount };
    }
    case 'SHIPPING_PERCENT':
      return { type: 'SHIPPING_PERCENT', percent: percent() };
    case 'SHIPPING_FIXED':
      return { type: 'SHIPPING_FIXED', amount: amount() };
    default:
      errors.push({ path: `${path}.type`, code: 'invalid' });
      return null;
  }
}

function readEligibility(raw: unknown, errors: Issues): Eligibility {
  if (raw === undefined || raw === null || (isObj(raw) && raw.mode === 'ALL')) return { mode: 'ALL' };
  if (!isObj(raw) || raw.mode !== 'EMAILS' || !Array.isArray(raw.emails)) {
    errors.push({ path: 'eligibility', code: 'invalid' });
    return { mode: 'ALL' };
  }
  if (raw.emails.length < 1 || raw.emails.length > 1000) {
    errors.push({ path: 'eligibility.emails', code: 'required' });
  }
  const emails: string[] = [];
  raw.emails.slice(0, 1000).forEach((e: unknown, i: number) => {
    const normalized = typeof e === 'string' ? normalizeEmail(e) : '';
    if (!isValidEmailFormat(normalized)) {
      errors.push({ path: `eligibility.emails.${i}`, code: 'invalid_email' });
      return;
    }
    if (!emails.includes(normalized)) emails.push(normalized);
  });
  return { mode: 'EMAILS', emails };
}

function readStacking(raw: unknown, errors: Issues): Stacking {
  const s = isObj(raw) ? raw : {};
  const flag = (key: keyof Stacking, fallback: boolean): boolean => {
    const v = s[key];
    if (v === undefined) return fallback;
    if (typeof v !== 'boolean') {
      errors.push({ path: `stacking.${key}`, code: 'invalid' });
      return fallback;
    }
    return v;
  };
  const exclusive = flag('exclusive', false);
  const withProduct = flag('withProduct', true);
  const withOrder = flag('withOrder', true);
  const withShipping = flag('withShipping', true);
  return {
    exclusive,
    withProduct: !exclusive && withProduct,
    withOrder: !exclusive && withOrder,
    withShipping: !exclusive && withShipping,
  };
}

export function validatePromotionInput(
  raw: unknown,
  ctx: { locales: string[]; timeZone: string }
): { value: PromotionInput | null; errors: ValidationIssue[] } {
  const errors: Issues = [];
  if (!isObj(raw)) return { value: null, errors: [{ path: '', code: 'invalid' }] };

  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (!name) errors.push({ path: 'name', code: 'required' });
  else if (name.length > 120) errors.push({ path: 'name', code: 'too_long' });

  let description: string | null = null;
  if (raw.description !== null && raw.description !== undefined && raw.description !== '') {
    if (typeof raw.description !== 'string') errors.push({ path: 'description', code: 'invalid' });
    else if (raw.description.length > 5000) errors.push({ path: 'description', code: 'too_long' });
    else description = raw.description;
  }

  const method = raw.method;
  if (method !== 'AUTOMATIC' && method !== 'CODE') errors.push({ path: 'method', code: 'invalid' });

  let code: string | null = null;
  const hasCode = raw.code !== null && raw.code !== undefined && String(raw.code).trim() !== '';
  if (hasCode) {
    const normalized = normalizePromotionCode(raw.code);
    if (VOUCHER_RE.test(normalized)) errors.push({ path: 'code', code: 'code_reserved_format' });
    else if (!CODE_RE.test(normalized)) errors.push({ path: 'code', code: 'invalid_code' });
    else code = normalized;
  } else if (method === 'CODE') {
    errors.push({ path: 'code', code: 'required' });
  }

  const zoneOk = isValidTimeZone(ctx.timeZone);
  if (!zoneOk) errors.push({ path: 'timeZone', code: 'invalid_timezone' });
  const startsAt = zoneOk ? zonedWallTimeToUtc(String(raw.startsAt ?? ''), ctx.timeZone) : null;
  if (zoneOk && !startsAt) errors.push({ path: 'startsAt', code: 'invalid_date' });
  let endsAt: string | null = null;
  if (raw.endsAt !== null && raw.endsAt !== undefined && raw.endsAt !== '') {
    endsAt = zoneOk ? zonedWallTimeToUtc(String(raw.endsAt), ctx.timeZone) : null;
    if (zoneOk && !endsAt) errors.push({ path: 'endsAt', code: 'invalid_date' });
    else if (startsAt && endsAt <= startsAt) errors.push({ path: 'endsAt', code: 'ends_before_start' });
  }

  const priority = raw.priority ?? 0;
  if (!isInt(priority) || priority < -1000 || priority > 1000) errors.push({ path: 'priority', code: 'invalid' });

  const displayName: Record<string, string> = {};
  if (raw.displayName !== undefined && raw.displayName !== null) {
    if (!isObj(raw.displayName)) errors.push({ path: 'displayName', code: 'invalid' });
    else {
      for (const [locale, text] of Object.entries(raw.displayName)) {
        const path = `displayName.${locale}`;
        if (!ctx.locales.includes(locale)) errors.push({ path, code: 'unknown_locale' });
        else if (typeof text !== 'string') errors.push({ path, code: 'invalid' });
        else if (text.trim().length > 120) errors.push({ path, code: 'too_long' });
        else if (text.trim()) displayName[locale] = text.trim();
      }
    }
  }

  let active = true;
  if (raw.active !== undefined) {
    if (typeof raw.active !== 'boolean') errors.push({ path: 'active', code: 'invalid' });
    else active = raw.active;
  }
  const stacking = readStacking(raw.stacking, errors);

  const eligibility = readEligibility(raw.eligibility, errors);
  let requireVerifiedEmail = false;
  if (raw.requireVerifiedEmail !== undefined) {
    if (typeof raw.requireVerifiedEmail !== 'boolean') {
      errors.push({ path: 'requireVerifiedEmail', code: 'invalid' });
    } else requireVerifiedEmail = raw.requireVerifiedEmail;
  }

  const leaves = { n: 0, tooDeep: false };
  const conditions = readGroup(raw.conditions ?? { type: 'GROUP', operator: 'AND', children: [] }, 'conditions', errors, leaves);
  if (leaves.tooDeep) errors.push({ path: 'conditions', code: 'too_deep' });
  if (leaves.n > MAX_LEAVES) errors.push({ path: 'conditions', code: 'too_many' });

  const benefits: Benefit[] = [];
  if (!Array.isArray(raw.benefits) || raw.benefits.length < 1 || raw.benefits.length > 10) {
    errors.push({ path: 'benefits', code: 'required' });
  } else {
    // Gift choices are keyed by promotion (`giftChoices[promotionId]`): one GIFT benefit at most.
    let hasGift = false;
    raw.benefits.forEach((b: unknown, i: number) => {
      const benefit = readBenefit(b, `benefits.${i}`, errors);
      if (benefit?.type === 'BUY_X_GET_Y' && benefit.get.mode === 'GIFT') {
        if (hasGift) errors.push({ path: `benefits.${i}`, code: 'duplicate_gift' });
        hasGift = true;
      }
      if (benefit) benefits.push(benefit);
    });
  }

  const limit = (key: 'usageLimit' | 'perCustomerLimit' | 'perOrderLimit'): number | null => {
    const v = raw[key] ?? null;
    if (!validNullableLimit(v)) {
      errors.push({ path: key, code: 'invalid' });
      return null;
    }
    return v;
  };
  const usageLimit = limit('usageLimit');
  const perCustomerLimit = limit('perCustomerLimit');
  const perOrderLimit = limit('perOrderLimit');

  if (errors.length || !startsAt || (method !== 'AUTOMATIC' && method !== 'CODE')) {
    return { value: null, errors };
  }
  return {
    value: {
      name,
      description,
      method,
      code,
      displayName,
      priority: priority as number,
      active,
      startsAt,
      endsAt,
      usageLimit,
      perCustomerLimit,
      perOrderLimit,
      requireVerifiedEmail,
      eligibility,
      conditions,
      benefits,
      stacking,
    },
    errors,
  };
}
