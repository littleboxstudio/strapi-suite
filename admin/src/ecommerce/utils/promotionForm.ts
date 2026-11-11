/**
 * Promotion editor: form state <-> API body, the condition tree editing, the client-side
 * mirror of the server's validation (domain/promotions/definition.ts, same paths and codes)
 * and the generated summary. Money is typed in euros and sent in cents; percentages are
 * sent as numbers (12.5).
 */
import { formatAmountInput, MAX_MONEY_CENTS, parseMoneyToCents } from './money';
import type {
  EmailOperator,
  NumberOperator,
  ProductTarget,
  Promotion,
  PromotionBenefit,
  PromotionBenefitType,
  PromotionCondition,
  PromotionConditionGroup,
  PromotionDefinition,
  PromotionLabels,
  PromotionMethod,
  PromotionStacking,
} from '../promotionTypes';

export type PromotionErrors = Record<string, string>;
export type Translate = (id: string, values?: Record<string, any>) => string;
export type Money = (cents: number) => string;

/** Child indexes from the root group: `[]` is the root, `[1, 0]` the first child of its second child. */
export type NodePath = number[];

export type ConditionType = PromotionCondition['type'];

export type ConditionNode = {
  key: string;
  type: ConditionType;
  operator: string;
  /** Euros for SUBTOTAL, a count for the quantities, text for EMAIL. */
  value: string;
  min: string;
  max: string;
  match: 'ANY' | 'ALL' | 'NONE';
  target: ProductTarget;
};

export type GroupNode = {
  key: string;
  type: 'GROUP';
  operator: 'AND' | 'OR';
  children: (GroupNode | ConditionNode)[];
};

export type TreeNode = GroupNode | ConditionNode;

export type BenefitForm = {
  key: string;
  type: PromotionBenefitType;
  percent: string;
  amount: string;
  per: 'UNIT' | 'SET';
  maxQuantity: string;
  maxAmount: string;
  target: ProductTarget;
  buyTarget: ProductTarget;
  buyQuantity: string;
  buyMinAmount: string;
  getMode: 'IN_CART' | 'GIFT';
  getTarget: ProductTarget;
  getVariantIds: number[];
  getQuantity: string;
  rewardKind: 'FREE' | 'PERCENT' | 'FIXED';
  rewardPercent: string;
  rewardAmount: string;
};

export type PromotionForm = {
  name: string;
  description: string;
  priority: string;
  active: boolean;
  displayName: Record<string, string>;
  method: PromotionMethod;
  code: string;
  startsAt: string;
  endsAt: string;
  eligibilityMode: 'ALL' | 'EMAILS';
  /** One e-mail per line. */
  emails: string;
  requireVerifiedEmail: boolean;
  conditions: GroupNode;
  benefits: BenefitForm[];
  usageLimit: string;
  perCustomerLimit: string;
  perOrderLimit: string;
  stacking: PromotionStacking;
  /** Names of the chosen products and variants (display only, never sent). */
  labels: PromotionLabels;
};

export const CONDITION_TYPES: ConditionType[] = [
  'SUBTOTAL',
  'SUBTOTAL_BETWEEN',
  'CART_CONTAINS',
  'PRODUCT_QUANTITY',
  'TOTAL_QUANTITY',
  'DISTINCT_PRODUCTS',
  'EMAIL',
];
export const NUMBER_OPERATORS: NumberOperator[] = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'];
export const EMAIL_OPERATORS: EmailOperator[] = ['eq', 'neq', 'contains', 'not_contains'];
export const BENEFIT_TYPES: PromotionBenefitType[] = [
  'PRODUCT_PERCENT',
  'PRODUCT_FIXED',
  'BUY_X_GET_Y',
  'ORDER_PERCENT',
  'ORDER_FIXED',
  'SHIPPING_FREE',
  'SHIPPING_PERCENT',
  'SHIPPING_FIXED',
];
export const MAX_BENEFITS = 10;
export const MAX_CONDITION_DEPTH = 3;
export const MAX_CONDITIONS = 50;
export const MAX_GIFT_VARIANTS = 20;

const CODE_RE = /^[A-Z0-9_-]{3,40}$/;
const VOUCHER_RE = /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const WALL_TIME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const MAX_QUANTITY = 100_000;
const MAX_LIMIT = 1_000_000;
const MAX_EMAILS = 1000;

let keyCounter = 0;
const nextKey = (prefix: string) => `${prefix}-${++keyCounter}`;

const emptyTarget = (): ProductTarget => ({ productIds: [], variantIds: [] });
const copyTarget = (t: ProductTarget | undefined): ProductTarget => ({
  productIds: [...(t?.productIds ?? [])],
  variantIds: [...(t?.variantIds ?? [])],
});
const targetIsEmpty = (t: ProductTarget) => t.productIds.length === 0 && t.variantIds.length === 0;

/** Operators a condition type accepts; the first is the default. */
export function operatorsFor(type: ConditionType): string[] {
  if (type === 'EMAIL') return EMAIL_OPERATORS;
  if (type === 'SUBTOTAL_BETWEEN' || type === 'CART_CONTAINS') return [];
  return ['gte', ...NUMBER_OPERATORS.filter((o) => o !== 'gte')];
}

export function emptyCondition(type: ConditionType = 'SUBTOTAL'): ConditionNode {
  return {
    key: nextKey('c'),
    type,
    operator: operatorsFor(type)[0] ?? '',
    value: '',
    min: '',
    max: '',
    match: 'ANY',
    target: emptyTarget(),
  };
}

const emptyGroup = (children: TreeNode[] = []): GroupNode => ({
  key: nextKey('g'),
  type: 'GROUP',
  operator: 'AND',
  children,
});

export function emptyBenefit(type: PromotionBenefitType = 'ORDER_PERCENT'): BenefitForm {
  return {
    key: nextKey('b'),
    type,
    percent: '',
    amount: '',
    per: 'UNIT',
    maxQuantity: '',
    maxAmount: '',
    target: emptyTarget(),
    buyTarget: emptyTarget(),
    buyQuantity: '',
    buyMinAmount: '',
    getMode: 'IN_CART',
    getTarget: emptyTarget(),
    getVariantIds: [],
    getQuantity: '',
    rewardKind: 'FREE',
    rewardPercent: '',
    rewardAmount: '',
  };
}

const DEFAULT_STACKING: PromotionStacking = {
  exclusive: false,
  withProduct: true,
  withOrder: true,
  withShipping: true,
};

/** A new promotion: code method, active, no conditions, one empty benefit. */
export function emptyPromotionForm(defaultLocale: string, startsAt: string): PromotionForm {
  return {
    name: '',
    description: '',
    priority: '0',
    active: true,
    displayName: defaultLocale ? { [defaultLocale]: '' } : {},
    method: 'CODE',
    code: '',
    startsAt,
    endsAt: '',
    eligibilityMode: 'ALL',
    emails: '',
    requireVerifiedEmail: false,
    conditions: emptyGroup(),
    benefits: [emptyBenefit()],
    usageLimit: '',
    perCustomerLimit: '',
    perOrderLimit: '',
    stacking: { ...DEFAULT_STACKING },
    labels: { products: {}, variants: {} },
  };
}

/** The current minute as wall time `YYYY-MM-DDTHH:mm` in `timeZone` (form default for the start). */
export function wallTimeNow(timeZone: string, now: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(now);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
    return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
  } catch {
    return now.toISOString().slice(0, 16);
  }
}

// ---------------------------------------------------------------------------
// View -> form
// ---------------------------------------------------------------------------

const centsToInput = (cents: number | null | undefined, locale: string): string =>
  typeof cents === 'number' && Number.isFinite(cents) ? formatAmountInput(cents, locale) : '';
const numberToInput = (n: number | null | undefined): string =>
  typeof n === 'number' && Number.isFinite(n) ? String(n) : '';

function conditionNodeFrom(c: PromotionCondition | PromotionConditionGroup, locale: string): TreeNode {
  if (c.type === 'GROUP') {
    return { ...emptyGroup(c.children.map((child) => conditionNodeFrom(child, locale))), operator: c.operator };
  }
  const node = emptyCondition(c.type);
  switch (c.type) {
    case 'SUBTOTAL':
      return { ...node, operator: c.operator, value: centsToInput(c.value, locale) };
    case 'SUBTOTAL_BETWEEN':
      return { ...node, min: centsToInput(c.min, locale), max: centsToInput(c.max, locale) };
    case 'CART_CONTAINS':
      return { ...node, match: c.match, target: copyTarget(c.target) };
    case 'PRODUCT_QUANTITY':
      return { ...node, operator: c.operator, value: numberToInput(c.value), target: copyTarget(c.target) };
    case 'TOTAL_QUANTITY':
    case 'DISTINCT_PRODUCTS':
      return { ...node, operator: c.operator, value: numberToInput(c.value) };
    case 'EMAIL':
      return { ...node, operator: c.operator, value: c.value };
    default:
      return node;
  }
}

function benefitFormFrom(b: PromotionBenefit, locale: string): BenefitForm {
  const form = emptyBenefit(b.type);
  switch (b.type) {
    case 'PRODUCT_PERCENT':
      return { ...form, target: copyTarget(b.target), percent: numberToInput(b.percent), maxQuantity: numberToInput(b.maxQuantity) };
    case 'PRODUCT_FIXED':
      return {
        ...form,
        target: copyTarget(b.target),
        amount: centsToInput(b.amount, locale),
        per: b.per,
        maxQuantity: numberToInput(b.maxQuantity),
      };
    case 'BUY_X_GET_Y':
      return {
        ...form,
        buyTarget: copyTarget(b.buy.target),
        buyQuantity: numberToInput(b.buy.quantity),
        buyMinAmount: centsToInput(b.buy.minAmount, locale),
        getMode: b.get.mode,
        getTarget: b.get.mode === 'IN_CART' ? copyTarget(b.get.target) : emptyTarget(),
        getVariantIds: b.get.mode === 'GIFT' ? [...b.get.variantIds] : [],
        getQuantity: numberToInput(b.get.quantity),
        rewardKind: b.reward.kind,
        rewardPercent: b.reward.kind === 'PERCENT' ? numberToInput(b.reward.percent) : '',
        rewardAmount: b.reward.kind === 'FIXED' ? centsToInput(b.reward.amount, locale) : '',
      };
    case 'ORDER_PERCENT':
    case 'SHIPPING_PERCENT':
      return { ...form, percent: numberToInput(b.percent) };
    case 'ORDER_FIXED':
    case 'SHIPPING_FIXED':
      return { ...form, amount: centsToInput(b.amount, locale) };
    case 'SHIPPING_FREE':
      return { ...form, maxAmount: centsToInput(b.maxAmount, locale) };
    default:
      return form;
  }
}

/** `locale`: the admin's, for the decimal separator of the loaded amounts (`12,50` in pt). */
export function promotionFormFromView(view: Promotion, locale = 'en'): PromotionForm {
  const conditions = conditionNodeFrom(
    view.conditions ?? { type: 'GROUP', operator: 'AND', children: [] },
    locale
  ) as GroupNode;
  return {
    name: view.name ?? '',
    description: view.description ?? '',
    priority: numberToInput(view.priority) || '0',
    active: view.active !== false,
    displayName: { ...(view.displayName ?? {}) },
    method: view.method,
    code: view.code ?? '',
    startsAt: view.startsAt ?? '',
    endsAt: view.endsAt ?? '',
    eligibilityMode: view.eligibility?.mode === 'EMAILS' ? 'EMAILS' : 'ALL',
    emails: view.eligibility?.mode === 'EMAILS' ? view.eligibility.emails.join('\n') : '',
    requireVerifiedEmail: view.requireVerifiedEmail === true,
    conditions,
    benefits: (view.benefits ?? []).map((b) => benefitFormFrom(b, locale)),
    usageLimit: numberToInput(view.usageLimit),
    perCustomerLimit: numberToInput(view.perCustomerLimit),
    perOrderLimit: numberToInput(view.perOrderLimit),
    stacking: { ...DEFAULT_STACKING, ...(view.stacking ?? {}) },
    labels: {
      products: { ...(view.labels?.products ?? {}) },
      variants: { ...(view.labels?.variants ?? {}) },
    },
  };
}

// ---------------------------------------------------------------------------
// Form -> API body
// ---------------------------------------------------------------------------

/** Euros typed by the admin (`12,50`, `12.5`) to cents; null when blank or unreadable. */
export function parseMoneyInput(raw: string): number | null {
  const s = (raw ?? '').trim();
  return s ? parseMoneyToCents(s) : null;
}

/** `12,5` or `12.5` to 12.5; null when blank or not a plain decimal. */
export function parsePercentInput(raw: string): number | null {
  const s = (raw ?? '').trim().replace(',', '.');
  return /^\d+(\.\d+)?$/.test(s) ? Number(s) : null;
}

/** A non-negative integer; null when blank or not digits. */
export function parseCountInput(raw: string): number | null {
  const s = (raw ?? '').trim();
  return /^\d+$/.test(s) ? Number(s) : null;
}

const parseInteger = (raw: string): number | null => {
  const s = (raw ?? '').trim();
  return /^-?\d+$/.test(s) ? Number(s) : null;
};

/** The non-empty lines of the e-mail list, trimmed (index = server path index). */
export function emailList(raw: string): string[] {
  return (raw ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export const normalizeCode = (raw: string): string => (raw ?? '').trim().toUpperCase();

function toCondition(node: TreeNode): PromotionCondition | PromotionConditionGroup {
  if (node.type === 'GROUP') {
    return { type: 'GROUP', operator: node.operator, children: node.children.map(toCondition) };
  }
  const op = node.operator as any;
  switch (node.type) {
    case 'SUBTOTAL':
      return { type: 'SUBTOTAL', operator: op, value: parseMoneyInput(node.value) as number };
    case 'SUBTOTAL_BETWEEN':
      return {
        type: 'SUBTOTAL_BETWEEN',
        min: parseMoneyInput(node.min) as number,
        max: parseMoneyInput(node.max) as number,
      };
    case 'CART_CONTAINS':
      return { type: 'CART_CONTAINS', match: node.match, target: copyTarget(node.target) };
    case 'PRODUCT_QUANTITY':
      return {
        type: 'PRODUCT_QUANTITY',
        target: copyTarget(node.target),
        operator: op,
        value: parseCountInput(node.value) as number,
      };
    case 'TOTAL_QUANTITY':
    case 'DISTINCT_PRODUCTS':
      return { type: node.type, operator: op, value: parseCountInput(node.value) as number };
    case 'EMAIL':
    default:
      return { type: 'EMAIL', operator: op, value: node.value.trim() };
  }
}

const nullableCount = (raw: string): number | null => parseCountInput(raw);

export function toBenefit(b: BenefitForm): PromotionBenefit {
  const percent = parsePercentInput(b.percent) as number;
  const amount = parseMoneyInput(b.amount) as number;
  switch (b.type) {
    case 'PRODUCT_PERCENT':
      return { type: 'PRODUCT_PERCENT', target: copyTarget(b.target), percent, maxQuantity: nullableCount(b.maxQuantity) };
    case 'PRODUCT_FIXED':
      return {
        type: 'PRODUCT_FIXED',
        target: copyTarget(b.target),
        amount,
        per: b.per,
        maxQuantity: nullableCount(b.maxQuantity),
      };
    case 'BUY_X_GET_Y': {
      const reward =
        b.rewardKind === 'PERCENT'
          ? { kind: 'PERCENT' as const, percent: parsePercentInput(b.rewardPercent) as number }
          : b.rewardKind === 'FIXED'
            ? { kind: 'FIXED' as const, amount: parseMoneyInput(b.rewardAmount) as number }
            : { kind: 'FREE' as const };
      const quantity = parseCountInput(b.getQuantity) as number;
      return {
        type: 'BUY_X_GET_Y',
        buy: {
          target: copyTarget(b.buyTarget),
          quantity: parseCountInput(b.buyQuantity) as number,
          minAmount: parseMoneyInput(b.buyMinAmount),
        },
        get:
          b.getMode === 'GIFT'
            ? { mode: 'GIFT', variantIds: [...b.getVariantIds], quantity }
            : { mode: 'IN_CART', target: copyTarget(b.getTarget), quantity },
        reward,
      };
    }
    case 'ORDER_PERCENT':
      return { type: 'ORDER_PERCENT', percent };
    case 'ORDER_FIXED':
      return { type: 'ORDER_FIXED', amount };
    case 'SHIPPING_FREE':
      return { type: 'SHIPPING_FREE', maxAmount: parseMoneyInput(b.maxAmount) };
    case 'SHIPPING_PERCENT':
      return { type: 'SHIPPING_PERCENT', percent };
    case 'SHIPPING_FIXED':
    default:
      return { type: 'SHIPPING_FIXED', amount };
  }
}

/** Non-empty names of the configured locales (a removed locale would be `unknown_locale`). */
function cleanDisplayName(names: Record<string, string>, locales?: string[]): Record<string, string> {
  const displayName: Record<string, string> = {};
  Object.entries(names ?? {}).forEach(([locale, text]) => {
    if (locales && !locales.includes(locale)) return;
    if (typeof text === 'string' && text.trim()) displayName[locale] = text.trim();
  });
  return displayName;
}

/**
 * The create/update body (without `version`). Run `validatePromotionForm` first.
 * `locales`: the configured locale codes; display names of other locales are dropped.
 */
export function toPromotionInput(form: PromotionForm, locales?: string[]): PromotionDefinition {
  const displayName = cleanDisplayName(form.displayName, locales);
  const code = normalizeCode(form.code);
  return {
    name: form.name.trim(),
    description: form.description.trim() ? form.description : null,
    code: code || null,
    method: form.method,
    displayName,
    priority: parseInteger(form.priority) ?? 0,
    eligibility:
      form.eligibilityMode === 'EMAILS' ? { mode: 'EMAILS', emails: emailList(form.emails) } : { mode: 'ALL' },
    conditions: toCondition(form.conditions) as PromotionConditionGroup,
    benefits: form.benefits.map(toBenefit),
    stacking: { ...form.stacking },
    perOrderLimit: nullableCount(form.perOrderLimit),
    active: form.active,
    startsAt: form.startsAt,
    endsAt: form.endsAt.trim() ? form.endsAt : null,
    usageLimit: nullableCount(form.usageLimit),
    perCustomerLimit: nullableCount(form.perCustomerLimit),
    requireVerifiedEmail: form.requireVerifiedEmail,
  };
}

/**
 * "Deactivate" after PROMOTION_IN_USE: the stored definition (not the form, whose unsaved
 * edits must not ride along) with `active: false` and the loaded `version`.
 */
export function deactivationInput(view: Promotion, locales?: string[]): PromotionDefinition & { version: number } {
  return {
    name: view.name,
    description: view.description ?? null,
    code: view.code ?? null,
    method: view.method,
    displayName: cleanDisplayName(view.displayName, locales),
    priority: view.priority ?? 0,
    eligibility: view.eligibility,
    conditions: view.conditions,
    benefits: view.benefits,
    stacking: view.stacking,
    perOrderLimit: view.perOrderLimit ?? null,
    active: false,
    startsAt: view.startsAt,
    endsAt: view.endsAt ?? null,
    usageLimit: view.usageLimit ?? null,
    perCustomerLimit: view.perCustomerLimit ?? null,
    requireVerifiedEmail: view.requireVerifiedEmail === true,
    version: view.version,
  };
}

// ---------------------------------------------------------------------------
// Condition tree editing (immutable; refusals return null)
// ---------------------------------------------------------------------------

export function nodeAt(tree: GroupNode, path: NodePath): TreeNode | null {
  let node: TreeNode = tree;
  for (const i of path) {
    if (node.type !== 'GROUP' || !node.children[i]) return null;
    node = node.children[i];
  }
  return node;
}

function replaceAt(tree: GroupNode, path: NodePath, fn: (node: TreeNode) => TreeNode): GroupNode {
  if (path.length === 0) return fn(tree) as GroupNode;
  const [head, ...rest] = path;
  return {
    ...tree,
    children: tree.children.map((child, i) =>
      i !== head ? child : rest.length === 0 ? fn(child) : child.type === 'GROUP' ? replaceAt(child, rest, fn) : child
    ),
  };
}

/** Depth of the group at `path` (the root is level 1). */
export const groupLevel = (path: NodePath): number => path.length + 1;

/** A group may be added inside the group at `path` while it stays within 3 levels. */
export const canAddGroup = (path: NodePath): boolean => groupLevel(path) < MAX_CONDITION_DEPTH;

export function addCondition(tree: GroupNode, path: NodePath, type?: ConditionType): GroupNode {
  if (nodeAt(tree, path)?.type !== 'GROUP') return tree;
  return replaceAt(tree, path, (g) => ({ ...(g as GroupNode), children: [...(g as GroupNode).children, emptyCondition(type)] }));
}

/** Adds a group (with one condition) inside the group at `path`; null at the 4th level. */
export function addGroup(tree: GroupNode, path: NodePath): GroupNode | null {
  if (nodeAt(tree, path)?.type !== 'GROUP' || !canAddGroup(path)) return null;
  return replaceAt(tree, path, (g) => ({
    ...(g as GroupNode),
    children: [...(g as GroupNode).children, emptyGroup([emptyCondition()])],
  }));
}

/** Removes the node at `path`; the root cannot be removed (null). */
export function removeNode(tree: GroupNode, path: NodePath): GroupNode | null {
  if (path.length === 0 || !nodeAt(tree, path)) return null;
  const parent = path.slice(0, -1);
  const index = path[path.length - 1];
  return replaceAt(tree, parent, (g) => ({
    ...(g as GroupNode),
    children: (g as GroupNode).children.filter((_, i) => i !== index),
  }));
}

/** Merges `patch` into the node at `path`; a type change resets an operator the type does not allow. */
export function updateNode(
  tree: GroupNode,
  path: NodePath,
  patch: Partial<Omit<ConditionNode, 'key'>> | Partial<Pick<GroupNode, 'operator'>>
): GroupNode {
  if (!nodeAt(tree, path)) return tree;
  return replaceAt(tree, path, (node) => {
    if (node.type === 'GROUP') {
      const operator = (patch as any).operator;
      return operator === 'AND' || operator === 'OR' ? { ...node, operator } : node;
    }
    const next = { ...node, ...(patch as Partial<ConditionNode>) } as ConditionNode;
    const allowed = operatorsFor(next.type);
    if (!allowed.includes(next.operator)) next.operator = allowed[0] ?? '';
    return next;
  });
}

/** The server path of a node (`conditions.children.0.children.1`). */
export const conditionPath = (path: NodePath): string =>
  ['conditions', ...path.flatMap((i) => ['children', String(i)])].join('.');

const countLeaves = (g: GroupNode): number =>
  g.children.reduce((n, c) => n + (c.type === 'GROUP' ? countLeaves(c) : 1), 0);
const depthOf = (g: GroupNode): number =>
  1 + Math.max(0, ...g.children.filter((c): c is GroupNode => c.type === 'GROUP').map(depthOf));

// ---------------------------------------------------------------------------
// Stacking
// ---------------------------------------------------------------------------

/** "Exclusive" turns the class options off (and back on when it is cleared). */
export function setStacking(
  stacking: PromotionStacking,
  key: keyof PromotionStacking,
  value: boolean
): PromotionStacking {
  if (key === 'exclusive') {
    return { exclusive: value, withProduct: !value, withOrder: !value, withShipping: !value };
  }
  if (stacking.exclusive) return stacking;
  return { ...stacking, [key]: value };
}

// ---------------------------------------------------------------------------
// Validation (mirrors validatePromotionInput on the server)
// ---------------------------------------------------------------------------

const validPercent = (n: number | null): boolean =>
  n !== null && Number.isFinite(n) && n > 0 && n <= 100 && Math.abs(n * 100 - Math.round(n * 100)) < 1e-9;
const validMoney = (n: number | null, min: number): boolean =>
  n !== null && Number.isInteger(n) && n >= min && n <= MAX_MONEY_CENTS;
const validCount = (n: number | null, min: number): boolean =>
  n !== null && n >= min && n <= MAX_QUANTITY;

function validWallTime(raw: string): boolean {
  const m = WALL_TIME_RE.exec(raw ?? '');
  if (!m) return false;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const date = new Date(Date.UTC(y, mo - 1, d, h, mi));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === mo - 1 &&
    date.getUTCDate() === d &&
    h < 24 &&
    mi < 60
  );
}

const HOUR_MS = 3_600_000;

/** The wall clock in `timeZone` at `utcMs`, read back as if it were UTC (ms). */
function wallAsUtcMs(utcMs: number, timeZone: string): number {
  const parts: Record<string, number> = {};
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  for (const part of f.formatToParts(new Date(utcMs))) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value);
  }
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour % 24, parts.minute, parts.second);
}

/**
 * UTC ms of a valid wall time in `timeZone`, as the server's `zonedWallTimeToUtc` resolves it:
 * a time in a spring-forward gap moves forward, an ambiguous one is the first occurrence.
 * Null when the zone is unknown.
 */
export function wallTimeToUtcMs(wall: string, timeZone: string): number | null {
  const m = WALL_TIME_RE.exec(wall ?? '');
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const naive = Date.UTC(y, mo - 1, d, h, mi);
  try {
    const before = wallAsUtcMs(naive - 24 * HOUR_MS, timeZone) - (naive - 24 * HOUR_MS);
    const after = wallAsUtcMs(naive + 24 * HOUR_MS, timeZone) - (naive + 24 * HOUR_MS);
    const candidates = [...new Set([before, after])]
      .map((offset) => naive - offset)
      .filter((utc) => wallAsUtcMs(utc, timeZone) === naive)
      .sort((a, b) => a - b);
    return candidates.length ? candidates[0] : naive - before;
  } catch {
    return null;
  }
}

/** End after start: in UTC through the store zone when known (DST), else as wall times. */
function endsAfterStart(startsAt: string, endsAt: string, timeZone?: string): boolean {
  if (timeZone) {
    const start = wallTimeToUtcMs(startsAt, timeZone);
    const end = wallTimeToUtcMs(endsAt, timeZone);
    if (start !== null && end !== null) return end > start;
  }
  return endsAt > startsAt;
}

function validateTarget(target: ProductTarget, path: string, errors: PromotionErrors) {
  if (targetIsEmpty(target)) errors[path] = 'required';
}

function validateCondition(node: ConditionNode, path: string, errors: PromotionErrors) {
  const set = (field: string, code: string) => {
    if (!errors[`${path}.${field}`]) errors[`${path}.${field}`] = code;
  };
  const allowed = operatorsFor(node.type);
  if (allowed.length && !allowed.includes(node.operator)) set('operator', 'invalid_operator');
  switch (node.type) {
    case 'SUBTOTAL':
      if (!validMoney(parseMoneyInput(node.value), 0)) set('value', 'invalid_value');
      break;
    case 'SUBTOTAL_BETWEEN': {
      const min = parseMoneyInput(node.min);
      const max = parseMoneyInput(node.max);
      if (!validMoney(min, 0)) set('min', 'invalid_value');
      if (!validMoney(max, 0)) set('max', 'invalid_value');
      else if (validMoney(min, 0) && (min as number) > (max as number)) set('max', 'invalid_value');
      break;
    }
    case 'CART_CONTAINS':
      validateTarget(node.target, `${path}.target`, errors);
      break;
    case 'PRODUCT_QUANTITY':
      validateTarget(node.target, `${path}.target`, errors);
      if (!validCount(parseCountInput(node.value), 0)) set('value', 'invalid_value');
      break;
    case 'TOTAL_QUANTITY':
    case 'DISTINCT_PRODUCTS':
      if (!validCount(parseCountInput(node.value), 0)) set('value', 'invalid_value');
      break;
    case 'EMAIL': {
      const value = node.value.trim().toLowerCase();
      if (!value || value.length > 254) set('value', 'invalid_value');
      else if ((node.operator === 'eq' || node.operator === 'neq') && !EMAIL_RE.test(value)) {
        set('value', 'invalid_email');
      }
      break;
    }
    default:
      set('type', 'invalid');
  }
}

function validateGroup(group: GroupNode, path: NodePath, errors: PromotionErrors) {
  group.children.forEach((child, i) => {
    const childPath = [...path, i];
    if (child.type === 'GROUP') validateGroup(child, childPath, errors);
    else validateCondition(child, conditionPath(childPath), errors);
  });
}

function validateBenefit(b: BenefitForm, path: string, errors: PromotionErrors) {
  const set = (field: string, code: string) => {
    errors[`${path}.${field}`] = code;
  };
  const percent = () => {
    if (!validPercent(parsePercentInput(b.percent))) set('percent', 'invalid_percent');
  };
  const amount = () => {
    if (!validMoney(parseMoneyInput(b.amount), 1)) set('amount', 'invalid_amount');
  };
  const maxQuantity = () => {
    if (b.maxQuantity.trim() && !validCount(parseCountInput(b.maxQuantity), 1)) set('maxQuantity', 'invalid_value');
  };
  switch (b.type) {
    case 'PRODUCT_PERCENT':
      validateTarget(b.target, `${path}.target`, errors);
      percent();
      maxQuantity();
      break;
    case 'PRODUCT_FIXED':
      validateTarget(b.target, `${path}.target`, errors);
      amount();
      maxQuantity();
      break;
    case 'BUY_X_GET_Y':
      validateTarget(b.buyTarget, `${path}.buy.target`, errors);
      if (!validCount(parseCountInput(b.buyQuantity), 1)) set('buy.quantity', 'invalid_value');
      if (b.buyMinAmount.trim() && !validMoney(parseMoneyInput(b.buyMinAmount), 0)) {
        set('buy.minAmount', 'invalid_amount');
      }
      if (b.getMode === 'GIFT') {
        if (b.getVariantIds.length < 1 || b.getVariantIds.length > MAX_GIFT_VARIANTS) set('get.variantIds', 'required');
      } else {
        validateTarget(b.getTarget, `${path}.get.target`, errors);
      }
      if (!validCount(parseCountInput(b.getQuantity), 1)) set('get.quantity', 'invalid_value');
      if (b.rewardKind === 'PERCENT' && !validPercent(parsePercentInput(b.rewardPercent))) {
        set('reward.percent', 'invalid_percent');
      }
      if (b.rewardKind === 'FIXED' && !validMoney(parseMoneyInput(b.rewardAmount), 1)) {
        set('reward.amount', 'invalid_amount');
      }
      break;
    case 'ORDER_PERCENT':
    case 'SHIPPING_PERCENT':
      percent();
      break;
    case 'ORDER_FIXED':
    case 'SHIPPING_FIXED':
      amount();
      break;
    case 'SHIPPING_FREE':
      if (b.maxAmount.trim() && !validMoney(parseMoneyInput(b.maxAmount), 1)) set('maxAmount', 'invalid_amount');
      break;
    default:
      set('type', 'invalid');
  }
}

/**
 * Path -> code, with the server's paths and codes, for what can be checked locally.
 * `timeZone`: the store's, so that end/start compare like the server (in UTC).
 */
export function validatePromotionForm(form: PromotionForm, timeZone?: string): PromotionErrors {
  const errors: PromotionErrors = {};

  const name = form.name.trim();
  if (!name) errors.name = 'required';
  else if (name.length > 120) errors.name = 'too_long';
  if (form.description.length > 5000) errors.description = 'too_long';

  const code = normalizeCode(form.code);
  if (code) {
    if (VOUCHER_RE.test(code)) errors.code = 'code_reserved_format';
    else if (!CODE_RE.test(code)) errors.code = 'invalid_code';
  } else if (form.method === 'CODE') {
    errors.code = 'required';
  }

  const startsOk = validWallTime(form.startsAt);
  if (!startsOk) errors.startsAt = 'invalid_date';
  if (form.endsAt.trim()) {
    if (!validWallTime(form.endsAt)) errors.endsAt = 'invalid_date';
    else if (startsOk && !endsAfterStart(form.startsAt, form.endsAt, timeZone)) errors.endsAt = 'ends_before_start';
  }

  if (form.priority.trim()) {
    const priority = parseInteger(form.priority);
    if (priority === null || priority < -1000 || priority > 1000) errors.priority = 'invalid';
  }

  Object.entries(form.displayName).forEach(([locale, text]) => {
    if ((text ?? '').trim().length > 120) errors[`displayName.${locale}`] = 'too_long';
  });

  if (form.eligibilityMode === 'EMAILS') {
    const emails = emailList(form.emails);
    if (emails.length < 1 || emails.length > MAX_EMAILS) errors['eligibility.emails'] = 'required';
    emails.slice(0, MAX_EMAILS).forEach((email, i) => {
      if (!EMAIL_RE.test(email.toLowerCase())) errors[`eligibility.emails.${i}`] = 'invalid_email';
    });
  }

  validateGroup(form.conditions, [], errors);
  if (depthOf(form.conditions) > MAX_CONDITION_DEPTH) errors.conditions = 'too_deep';
  else if (countLeaves(form.conditions) > MAX_CONDITIONS) errors.conditions = 'too_many';

  if (form.benefits.length < 1 || form.benefits.length > MAX_BENEFITS) errors.benefits = 'required';
  form.benefits.forEach((b, i) => validateBenefit(b, `benefits.${i}`, errors));

  (['usageLimit', 'perCustomerLimit', 'perOrderLimit'] as const).forEach((key) => {
    const raw = form[key].trim();
    if (!raw) return;
    const n = parseCountInput(raw);
    if (n === null || n < 1 || n > MAX_LIMIT) errors[key] = 'invalid';
  });

  return errors;
}

/** Server issues (`details.errors`) to a path -> code map; the first code of a path wins. */
export function errorMapFromIssues(issues: { path?: unknown; code?: unknown }[]): PromotionErrors {
  const map: PromotionErrors = {};
  issues.forEach((issue) => {
    if (typeof issue?.path !== 'string' || typeof issue?.code !== 'string') return;
    if (!(issue.path in map)) map[issue.path] = issue.code;
  });
  return map;
}

export type FormSection =
  | 'general'
  | 'method'
  | 'validity'
  | 'eligibility'
  | 'conditions'
  | 'benefits'
  | 'limits'
  | 'stacking'
  | 'other';

const SECTION_ORDER: FormSection[] = [
  'general',
  'method',
  'validity',
  'eligibility',
  'conditions',
  'benefits',
  'limits',
  'stacking',
  'other',
];

/** Paths a form field displays (everything under `conditions` is shown by the tree editor). */
const SHOWN_PATH =
  /^(name|description|priority|displayName\.[^.]+|code|startsAt|endsAt|timeZone|eligibility(\.emails(\.\d+)?)?|requireVerifiedEmail|conditions(\..*)?|benefits|usageLimit|perCustomerLimit|perOrderLimit)$|^benefits\.\d+(\.(type|percent|amount|per|maxQuantity|maxAmount|target(\..*)?|buy\.target(\..*)?|buy\.quantity|buy\.minAmount|get\.target(\..*)?|get\.variantIds(\..*)?|get\.quantity|reward\.kind|reward\.percent|reward\.amount))?$/;

function sectionOf(path: string): FormSection {
  const head = path.split('.')[0];
  if (['name', 'description', 'priority', 'displayName', 'active'].includes(head)) return 'general';
  if (head === 'method' || head === 'code') return 'method';
  if (['startsAt', 'endsAt', 'timeZone'].includes(head)) return 'validity';
  if (head === 'eligibility') return 'eligibility';
  if (head === 'conditions') return 'conditions';
  if (head === 'benefits') return 'benefits';
  if (['usageLimit', 'perCustomerLimit', 'perOrderLimit'].includes(head)) return 'limits';
  if (head === 'stacking') return 'stacking';
  return 'other';
}

/** Errors no field displays (e.g. `stacking.*`, `method`, `version`), with the section to show them in. */
export function unmappedErrors(errors: PromotionErrors): { section: FormSection; path: string; code: string }[] {
  return Object.entries(errors)
    .filter(([path]) => !SHOWN_PATH.test(path))
    .map(([path, code]) => ({ section: sectionOf(path), path, code }))
    .sort((a, b) => SECTION_ORDER.indexOf(a.section) - SECTION_ORDER.indexOf(b.section));
}

/** The first error at `prefix` or under it (`benefits.0.target` covers `.target.variantIds`). */
export function errorUnder(errors: PromotionErrors, prefix: string): string | undefined {
  if (errors[prefix]) return errors[prefix];
  const key = Object.keys(errors).find((path) => path.startsWith(`${prefix}.`));
  return key ? errors[key] : undefined;
}

/** Drops the errors at `prefix` and under it. */
export function clearErrorsUnder(errors: PromotionErrors, prefix: string): PromotionErrors {
  const keys = Object.keys(errors).filter((p) => p === prefix || p.startsWith(`${prefix}.`));
  if (!keys.length) return errors;
  const next = { ...errors };
  keys.forEach((k) => delete next[k]);
  return next;
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

const S = 'ecommerce.promotions.summary';
const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** One sentence for a benefit; unreadable amounts show as "…". */
export function describeBenefit(b: PromotionBenefit, money: Money, t: Translate): string {
  const m = (n: number | null | undefined) => (isNum(n) ? money(n) : '…');
  const p = (n: number | null | undefined) => (isNum(n) ? n : '…');
  switch (b.type) {
    case 'PRODUCT_PERCENT':
    case 'PRODUCT_FIXED': {
      const main =
        b.type === 'PRODUCT_PERCENT'
          ? t(`${S}.PRODUCT_PERCENT`, { percent: p(b.percent) })
          : t(`${S}.PRODUCT_FIXED.${b.per === 'SET' ? 'SET' : 'UNIT'}`, { amount: m(b.amount) });
      return isNum(b.maxQuantity) ? `${main} ${t(`${S}.maxQuantity`, { count: b.maxQuantity })}` : main;
    }
    case 'BUY_X_GET_Y': {
      const buy = p(b.buy.quantity);
      const get =
        b.get.mode === 'GIFT'
          ? isNum(b.get.quantity)
            ? t(`${S}.gifts`, { count: b.get.quantity })
            : '…'
          : String(p(b.get.quantity));
      const reward = b.reward;
      const main =
        reward.kind === 'PERCENT'
          ? t(`${S}.BUY_X_GET_Y.PERCENT`, { buy, get, percent: p(reward.percent) })
          : reward.kind === 'FIXED'
            ? t(`${S}.BUY_X_GET_Y.FIXED`, { buy, get, amount: m(reward.amount) })
            : t(`${S}.BUY_X_GET_Y.FREE`, { buy, get });
      return isNum(b.buy.minAmount) && b.buy.minAmount > 0
        ? `${main} ${t(`${S}.minAmount`, { amount: m(b.buy.minAmount) })}`
        : main;
    }
    case 'ORDER_PERCENT':
    case 'SHIPPING_PERCENT':
      return t(`${S}.${b.type}`, { percent: p(b.percent) });
    case 'ORDER_FIXED':
    case 'SHIPPING_FIXED':
      return t(`${S}.${b.type}`, { amount: m(b.amount) });
    case 'SHIPPING_FREE':
      return isNum(b.maxAmount)
        ? t(`${S}.SHIPPING_FREE.max`, { amount: m(b.maxAmount) })
        : t(`${S}.SHIPPING_FREE`);
    default:
      return '';
  }
}

const wallLabel = (v: string) => v.replace('T', ' ');

/** The summary lines of the whole promotion (method, validity, who, conditions, benefits, limits, stacking). */
export function describePromotion(form: PromotionForm, money: Money, t: Translate): string[] {
  const lines: string[] = [];
  const code = normalizeCode(form.code);
  lines.push(form.method === 'CODE' ? t(`${S}.code`, { code: code || '…' }) : t(`${S}.automatic`));
  if (form.startsAt) {
    lines.push(
      form.endsAt
        ? t(`${S}.validity.range`, { start: wallLabel(form.startsAt), end: wallLabel(form.endsAt) })
        : t(`${S}.validity.from`, { start: wallLabel(form.startsAt) })
    );
  }
  lines.push(
    form.eligibilityMode === 'EMAILS'
      ? t(`${S}.eligibility.emails`, { count: emailList(form.emails).length })
      : t(`${S}.eligibility.all`)
  );
  const leaves = countLeaves(form.conditions);
  lines.push(
    leaves === 0
      ? t(`${S}.conditions.none`)
      : t(`${S}.conditions.${form.conditions.operator}`, { count: leaves })
  );
  form.benefits.forEach((b) => {
    const text = describeBenefit(toBenefit(b), money, t);
    if (text) lines.push(text);
  });
  const limit = (key: 'usageLimit' | 'perCustomerLimit' | 'perOrderLimit') => {
    const n = parseCountInput(form[key]);
    if (n !== null && n > 0) lines.push(t(`${S}.limits.${key}`, { count: n }));
  };
  limit('usageLimit');
  limit('perCustomerLimit');
  limit('perOrderLimit');
  const s = form.stacking;
  if (s.exclusive || (!s.withProduct && !s.withOrder && !s.withShipping)) {
    lines.push(t(`${S}.stacking.exclusive`));
  } else {
    const classes = (['withProduct', 'withOrder', 'withShipping'] as const)
      .filter((k) => s[k])
      .map((k) => t(`${S}.stacking.${k}`));
    lines.push(t(`${S}.stacking.with`, { classes: classes.join(', ') }));
  }
  lines.push(t(`${S}.status.${form.active ? 'active' : 'inactive'}`));
  return lines;
}
