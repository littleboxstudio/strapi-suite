import { describe, it, expect } from 'vitest';
import en from '../../../admin/src/core/translations/en.json';
import pt from '../../../admin/src/core/translations/pt.json';
import { IntlMessageFormat } from 'intl-messageformat';
import {
  addCondition,
  addScenario,
  addScenarioCondition,
  activationInput,
  describeBenefit,
  describeConditions,
  markedParts,
  markValue,
  describePromotion,
  emptyBenefit,
  emptyPromotionForm,
  errorMapFromIssues,
  promotionFormFromView,
  removeNode,
  removeScenario,
  removeScenarioCondition,
  scenariosOf,
  setStacking,
  toPromotionInput,
  toScenarioTree,
  unmappedErrors,
  updateNode,
  validatePromotionForm,
  wallTimeNow,
  type GroupNode,
  type PromotionForm,
} from '../../../admin/src/ecommerce/utils/promotionForm';
import { formatCents } from '../../../admin/src/ecommerce/utils/money';
import type { Promotion } from '../../../admin/src/ecommerce/promotionTypes';


const PREFIX = 'littlebox-strapi-suite.';
const translator =
  (messages: Record<string, string>, locale: string) => (id: string, values?: Record<string, any>) => {
    const message = messages[PREFIX + id];
    if (message === undefined) throw new Error(`missing translation ${id} (${locale})`);
    return String(new IntlMessageFormat(message, locale).format(values));
  };
const tEn = translator(en, 'en');
const tPt = translator(pt, 'pt-PT');
const moneyEn = (c: number) => formatCents(c, 'en');
const moneyPt = (c: number) => formatCents(c, 'pt-PT');
const nbsp = (s: string) => s.replace(/ /g, ' ');

const baseForm = (over: Partial<PromotionForm> = {}): PromotionForm => ({
  ...emptyPromotionForm('en', '2026-07-01T10:00'),
  name: 'Summer',
  method: 'CODE',
  code: 'VERAO20',
  benefits: [{ ...emptyBenefit('ORDER_PERCENT'), percent: '10' }],
  ...over,
});

describe('toPromotionInput', () => {
  it('converts 12,50 € to 1250 cents and keeps 12.5 %', () => {
    const form = baseForm({
      benefits: [
        { ...emptyBenefit('ORDER_FIXED'), amount: '12,50' },
        { ...emptyBenefit('PRODUCT_PERCENT'), percent: '12.5', target: { productIds: [3], variantIds: [] } },
      ],
    });
    const input = toPromotionInput(form);
    expect(input.benefits[0]).toEqual({ type: 'ORDER_FIXED', amount: 1250 });
    expect(input.benefits[1]).toEqual({
      type: 'PRODUCT_PERCENT',
      target: { productIds: [3], variantIds: [] },
      percent: 12.5,
      maxQuantity: null,
    });
  });

  it('upper-cases the code, drops empty display names and maps empty limits to null', () => {
    const input = toPromotionInput(
      baseForm({
        code: ' verao20 ',
        displayName: { en: ' Summer sale ', pt: '  ' },
        usageLimit: '',
        perCustomerLimit: '2',
        priority: '',
        eligibilityMode: 'CUSTOMERS',
        customers: [
          { id: 4, firstName: 'Ana', lastName: 'Silva', email: 'a@x.pt' },
          { id: 9, firstName: null, lastName: null, email: 'b@x.pt' },
        ],
      })
    );
    expect(input.code).toBe('VERAO20');
    expect(input.displayName).toEqual({ en: 'Summer sale' });
    expect(input.usageLimit).toBeNull();
    expect(input.perCustomerLimit).toBe(2);
    expect(input.priority).toBe(0);
    expect(input.eligibility).toEqual({ mode: 'CUSTOMERS', customerIds: [4, 9] });
    expect(input).not.toHaveProperty('requireVerifiedEmail');
    expect(input.endsAt).toBeNull();
  });

  it('maps a Buy X Get Y gift and a condition tree without UI keys', () => {
    const form = baseForm();
    form.benefits = [
      {
        ...emptyBenefit('BUY_X_GET_Y'),
        buyTarget: { productIds: [1], variantIds: [] },
        buyQuantity: '2',
        getMode: 'GIFT',
        getVariantIds: [9],
        getQuantity: '1',
        rewardKind: 'FREE',
      },
    ];
    let tree = addCondition(form.conditions, []);
    tree = updateNode(tree, [0], { type: 'SUBTOTAL', operator: 'gte', value: '50' });
    const input = toPromotionInput({ ...form, conditions: tree });
    expect(input.benefits[0]).toEqual({
      type: 'BUY_X_GET_Y',
      buy: { target: { productIds: [1], variantIds: [] }, quantity: 2, minAmount: null },
      get: { mode: 'GIFT', variantIds: [9], quantity: 1 },
      reward: { kind: 'FREE' },
    });
    expect(input.conditions).toEqual({
      type: 'GROUP',
      operator: 'AND',
      children: [{ type: 'SUBTOTAL', operator: 'gte', value: 5000 }],
    });
  });

  it('round-trips a server view', () => {
    const view = {
      id: 4,
      name: 'X',
      description: null,
      code: 'X20',
      method: 'CODE',
      displayName: { pt: 'Promo' },
      priority: 3,
      eligibility: { mode: 'ALL' },
      conditions: {
        type: 'GROUP',
        operator: 'OR',
        children: [
          { type: 'SUBTOTAL_BETWEEN', min: 1000, max: 2050 },
          { type: 'GROUP', operator: 'AND', children: [{ type: 'EMAIL', operator: 'contains', value: '@x.pt' }] },
        ],
      },
      benefits: [
        { type: 'PRODUCT_FIXED', target: { productIds: [], variantIds: [5] }, amount: 250, per: 'SET', maxQuantity: 3 },
        { type: 'SHIPPING_FREE', maxAmount: null },
      ],
      stacking: { exclusive: false, withProduct: true, withOrder: false, withShipping: true },
      perOrderLimit: 2,
      active: false,
      startsAt: '2026-07-01T10:00',
      endsAt: null,
      usageLimit: 100,
      perCustomerLimit: null,
      status: 'INACTIVE',
      redemptions: 0,
      version: 3,
      timezone: 'Europe/Lisbon',
      createdAt: null,
      updatedAt: null,
      labels: { products: {}, variants: { 5: { name: 'Sock', option: 'Red', sku: 'S-R' } } },
    } as Promotion;
    const form = promotionFormFromView(view);
    expect(form.benefits[0].amount).toBe('2.50');
    expect(form.labels.variants[5].name).toBe('Sock');
    const { id, status, redemptions, version, timezone, createdAt, updatedAt, labels, ...definition } = view;
    // The editor shows conditions as scenarios: the lone condition under OR becomes its own group.
    expect(toPromotionInput(form)).toEqual({
      ...definition,
      conditions: {
        type: 'GROUP',
        operator: 'OR',
        children: [
          { type: 'GROUP', operator: 'AND', children: [{ type: 'SUBTOTAL_BETWEEN', min: 1000, max: 2050 }] },
          { type: 'GROUP', operator: 'AND', children: [{ type: 'EMAIL', operator: 'contains', value: '@x.pt' }] },
        ],
      },
    });
  });
});

describe('condition tree', () => {
  const root = (): GroupNode => emptyPromotionForm('en', '').conditions;

  it('does not remove the root, removes any other node', () => {
    const tree = addCondition(addCondition(root(), []), []);
    expect(removeNode(tree, [])).toBeNull();
    expect(removeNode(tree, [1])!.children).toHaveLength(1);
  });

  it('updateNode resets an operator the new type does not allow', () => {
    let tree = addCondition(root(), []);
    tree = updateNode(tree, [0], { type: 'EMAIL', operator: 'contains' });
    tree = updateNode(tree, [0], { type: 'TOTAL_QUANTITY' });
    expect((tree.children[0] as any).operator).toBe('gte');
    tree = updateNode(tree, [], { operator: 'OR' });
    expect(tree.operator).toBe('OR');
  });
});

describe('condition scenarios', () => {
  const root = (): GroupNode => emptyPromotionForm('en', '').conditions;
  const leaf = (type: string, extra: Record<string, unknown> = {}) => ({ type, operator: 'gte', value: 1, ...extra });
  const view = (conditions: any) =>
    promotionFormFromView(
      {
        name: 'X',
        method: 'AUTOMATIC',
        displayName: {},
        eligibility: { mode: 'ALL' },
        conditions,
        benefits: [],
        stacking: { exclusive: true, withProduct: false, withOrder: false, withShipping: false },
        startsAt: '2026-07-01T10:00',
        labels: { products: {}, variants: {} },
      } as any,
      'en'
    ).conditions;

  it('keeps one scenario as a plain AND list', () => {
    let tree = addScenarioCondition(root(), 0);
    tree = addScenarioCondition(tree, 0);
    expect(tree.operator).toBe('AND');
    expect(tree.children.map((c) => c.type)).toEqual(['SUBTOTAL', 'SUBTOTAL']);
    expect(scenariosOf(tree)).toHaveLength(1);
    expect(scenariosOf(root())).toEqual([]);
  });

  it('a second scenario turns the root into OR of AND groups, and back', () => {
    const one = addScenarioCondition(addScenarioCondition(root(), 0), 0);
    const two = addScenario(one);
    expect(two.key).toBe(one.key);
    expect(two.operator).toBe('OR');
    expect(two.children.map((g) => (g as GroupNode).operator)).toEqual(['AND', 'AND']);
    expect(scenariosOf(two).map((sc) => sc.length)).toEqual([2, 1]);
    const back = removeScenario(two, 1);
    expect(back.operator).toBe('AND');
    expect(back.children).toHaveLength(2);
    expect(back.children.every((c) => c.type !== 'GROUP')).toBe(true);
  });

  it('removing the last condition of a scenario removes the scenario', () => {
    const two = addScenario(addScenarioCondition(root(), 0));
    const one = removeScenarioCondition(two, 1, 0);
    expect(one.operator).toBe('AND');
    expect(scenariosOf(one)).toHaveLength(1);
    expect(scenariosOf(removeScenarioCondition(one, 0, 0))).toEqual([]);
  });

  it('rewrites older trees as scenarios with the same meaning', () => {
    // a AND (b OR c) -> (a AND b) OR (a AND c)
    const tree = view({
      type: 'GROUP',
      operator: 'AND',
      children: [
        leaf('TOTAL_QUANTITY', { value: 1 }),
        { type: 'GROUP', operator: 'OR', children: [leaf('TOTAL_QUANTITY', { value: 2 }), leaf('TOTAL_QUANTITY', { value: 3 })] },
      ],
    });
    expect(tree.operator).toBe('OR');
    expect(scenariosOf(tree).map((sc) => sc.map((c) => c.value))).toEqual([
      ['1', '2'],
      ['1', '3'],
    ]);
    const keys = scenariosOf(tree).flat().map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
    // root OR of single conditions -> one scenario each
    const ors = view({ type: 'GROUP', operator: 'OR', children: [leaf('TOTAL_QUANTITY'), leaf('DISTINCT_PRODUCTS')] });
    expect(scenariosOf(ors).map((sc) => sc.length)).toEqual([1, 1]);
    // an empty group is true: the whole tree has no real condition
    const empty = view({ type: 'GROUP', operator: 'OR', children: [leaf('TOTAL_QUANTITY'), { type: 'GROUP', operator: 'AND', children: [] }] });
    expect(scenariosOf(empty)).toEqual([]);
  });

  it('keeps a tree that would pass the condition limit as it is', () => {
    const or = (n: number) => ({ type: 'GROUP', operator: 'OR', children: Array.from({ length: n }, () => leaf('TOTAL_QUANTITY')) });
    const big = { type: 'GROUP', operator: 'AND', children: [or(5), or(5), or(5)] };
    const tree = view(big);
    expect(toScenarioTree(tree)).toBeNull();
    expect(tree.operator).toBe('AND');
    expect(tree.children).toHaveLength(3);
  });

  it('marks the values the user filled in, never the "…" of an empty field', () => {
    let tree = updateNode(addScenarioCondition(root(), 0), [0], { type: 'SUBTOTAL', operator: 'gte', value: '50' });
    tree = addScenarioCondition(tree, 0); // an empty subtotal
    const parts = markedParts(describeConditions(tree, moneyEn, tEn, undefined, markValue));
    expect(parts.filter((x) => x.value).map((x) => nbsp(x.text))).toEqual(['at least', '€50.00', 'at least']);
    expect(nbsp(parts.map((x) => x.text).join(''))).toBe(nbsp(describeConditions(tree, moneyEn, tEn)));
  });

  it('describes when the promotion applies', () => {
    expect(describeConditions(root(), moneyEn, tEn)).toBe('Applies to any cart (no conditions)');
    let tree = updateNode(addScenarioCondition(root(), 0), [0], { type: 'SUBTOTAL', operator: 'gte', value: '50' });
    tree = addScenarioCondition(tree, 0);
    tree = updateNode(tree, [1], { type: 'CART_CONTAINS', target: { productIds: [7], variantIds: [] } });
    tree = addScenario(tree);
    tree = updateNode(tree, [1, 0], { type: 'EMAIL', operator: 'contains', value: '@shop.pt' });
    const labels = { products: { 7: 'Mug' }, variants: {} };
    expect(nbsp(describeConditions(tree, moneyEn, tEn, labels))).toBe(
      'Applies when (the subtotal is at least €50.00 and the cart contains any of Mug) or the e-mail contains “@shop.pt”'
    );
    expect(nbsp(describeConditions(tree, moneyPt, tPt, labels))).toBe(
      'Aplica-se quando (o subtotal é pelo menos 50,00 € e o carrinho contém algum de Mug) ou o e-mail contém “@shop.pt”'
    );
  });
});

describe('validatePromotionForm', () => {
  it('accepts a valid form', () => {
    expect(validatePromotionForm(baseForm())).toEqual({});
  });

  it('requires a code for CODE promotions and checks its format', () => {
    expect(validatePromotionForm(baseForm({ code: '' }))).toMatchObject({ code: 'required' });
    expect(validatePromotionForm(baseForm({ code: 'abcd-efgh-jklm' }))).toMatchObject({
      code: 'code_reserved_format',
    });
    expect(validatePromotionForm(baseForm({ code: 'A B' }))).toMatchObject({ code: 'invalid_code' });
    expect(validatePromotionForm(baseForm({ method: 'AUTOMATIC', code: '' }))).toEqual({});
  });

  it('rejects a 0 % benefit', () => {
    const form = baseForm({ benefits: [{ ...emptyBenefit('ORDER_PERCENT'), percent: '0' }] });
    expect(validatePromotionForm(form)).toMatchObject({ 'benefits.0.percent': 'invalid_percent' });
  });

  it('rejects an end before the start', () => {
    expect(validatePromotionForm(baseForm({ endsAt: '2026-06-30T10:00' }))).toMatchObject({
      endsAt: 'ends_before_start',
    });
    expect(validatePromotionForm(baseForm({ endsAt: '2026-07-01T10:00' }))).toMatchObject({
      endsAt: 'ends_before_start',
    });
    expect(validatePromotionForm(baseForm({ startsAt: '' }))).toMatchObject({ startsAt: 'invalid_date' });
  });

  it('uses the server paths for conditions and benefits', () => {
    let tree = addScenario(addCondition(baseForm().conditions, []));
    tree = updateNode(tree, [0, 0], { type: 'EMAIL', operator: 'eq', value: 'nope' });
    const form = baseForm({
      conditions: tree,
      benefits: [{ ...emptyBenefit('BUY_X_GET_Y'), buyQuantity: '0', rewardKind: 'PERCENT', rewardPercent: '101' }],
      usageLimit: '0',
    });
    expect(validatePromotionForm(form)).toMatchObject({
      'conditions.children.0.children.0.value': 'invalid_email',
      'benefits.0.buy.target': 'required',
      'benefits.0.buy.quantity': 'invalid_value',
      'benefits.0.get.target': 'required',
      'benefits.0.reward.percent': 'invalid_percent',
      usageLimit: 'invalid',
    });
    expect(validatePromotionForm(baseForm({ benefits: [] }))).toMatchObject({ benefits: 'required' });
  });

  it('allows at most one GIFT benefit per promotion (duplicate_gift on the later ones, as the server)', () => {
    const gift = { ...emptyBenefit('BUY_X_GET_Y'), getMode: 'GIFT' as const };
    const errors = validatePromotionForm(baseForm({ benefits: [gift, emptyBenefit('BUY_X_GET_Y'), gift] }));
    expect(errors['benefits.2']).toBe('duplicate_gift');
    expect(errors['benefits.0']).toBeUndefined();
    expect(errors['benefits.1']).toBeUndefined();
    // The server issue lands on the benefit itself, which the benefit editor displays.
    const map = errorMapFromIssues([{ path: 'benefits.1', code: 'duplicate_gift' }]);
    expect(map).toEqual({ 'benefits.1': 'duplicate_gift' });
    expect(unmappedErrors(map)).toEqual([]);
    const key = 'littlebox-strapi-suite.ecommerce.promotions.form.errors.duplicate_gift';
    expect((en as Record<string, string>)[key]).toEqual(expect.any(String));
    expect((pt as Record<string, string>)[key]).toEqual(expect.any(String));
  });

  it('specific customers need at least one customer', () => {
    expect(validatePromotionForm(baseForm({ eligibilityMode: 'CUSTOMERS', customers: [] }))).toMatchObject({
      'eligibility.customerIds': 'required',
    });
    expect(
      validatePromotionForm(
        baseForm({ eligibilityMode: 'CUSTOMERS', customers: [{ id: 1, firstName: 'A', lastName: 'B', email: 'a@x.pt' }] })
      )['eligibility.customerIds']
    ).toBeUndefined();
  });
});

describe('errorMapFromIssues', () => {
  it('keeps the first code per path', () => {
    expect(
      errorMapFromIssues([
        { path: 'code', code: 'code_taken' },
        { path: 'code', code: 'invalid' },
        { path: 'conditions', code: 'too_many' },
      ])
    ).toEqual({ code: 'code_taken', conditions: 'too_many' });
  });
});

describe('setStacking', () => {
  it('exclusive turns the other options off', () => {
    const s = setStacking(
      { exclusive: false, withProduct: true, withOrder: true, withShipping: true },
      'exclusive',
      true
    );
    expect(s).toEqual({ exclusive: true, withProduct: false, withOrder: false, withShipping: false });
  });
  it('leaving exclusive turns them back on; a class toggles alone', () => {
    const off = setStacking(
      { exclusive: true, withProduct: false, withOrder: false, withShipping: false },
      'exclusive',
      false
    );
    expect(off).toEqual({ exclusive: false, withProduct: true, withOrder: true, withShipping: true });
    expect(setStacking(off, 'withOrder', false)).toEqual({ ...off, withOrder: false });
  });
});

describe('describeBenefit', () => {
  it('free shipping with a maximum', () => {
    const b = { type: 'SHIPPING_FREE', maxAmount: 1000 } as const;
    expect(nbsp(describeBenefit(b, moneyEn, tEn))).toBe('Free shipping (up to €10.00)');
    expect(nbsp(describeBenefit(b, moneyPt, tPt))).toBe('Portes grátis (até 10,00 €)');
    expect(describeBenefit({ type: 'SHIPPING_FREE', maxAmount: null }, moneyEn, tEn)).toBe('Free shipping');
  });
  it('describes every type in both languages', () => {
    const target = { productIds: [1], variantIds: [] };
    const all = [
      { type: 'PRODUCT_PERCENT', target, percent: 12.5, maxQuantity: 2 },
      { type: 'PRODUCT_FIXED', target, amount: 300, per: 'UNIT', maxQuantity: null },
      { type: 'PRODUCT_FIXED', target, amount: 300, per: 'SET', maxQuantity: null },
      {
        type: 'BUY_X_GET_Y',
        buy: { target, quantity: 3, minAmount: 2000 },
        get: { mode: 'IN_CART', target, quantity: 1 },
        reward: { kind: 'PERCENT', percent: 50 },
      },
      { type: 'ORDER_PERCENT', percent: 10 },
      { type: 'ORDER_FIXED', amount: 500 },
      { type: 'SHIPPING_PERCENT', percent: 50 },
      { type: 'SHIPPING_FIXED', amount: 200 },
    ] as const;
    for (const b of all) {
      expect(describeBenefit(b as any, moneyEn, tEn)).not.toBe('');
      expect(describeBenefit(b as any, moneyPt, tPt)).not.toBe('');
    }
    expect(describeBenefit(all[0] as any, moneyEn, tEn)).toBe('12.5% off the selected products (up to 2 units)');
    expect(nbsp(describeBenefit(all[5] as any, moneyPt, tPt))).toBe('Desconto de 5,00 € na encomenda');
  });
});

describe('describePromotion', () => {
  it('describes a Buy 2 Get 1', () => {
    const form = baseForm({
      benefits: [
        {
          ...emptyBenefit('BUY_X_GET_Y'),
          buyTarget: { productIds: [1], variantIds: [] },
          buyQuantity: '2',
          getTarget: { productIds: [1], variantIds: [] },
          getQuantity: '1',
          rewardKind: 'FREE',
        },
      ],
    });
    const en = describePromotion(form, moneyEn, tEn);
    expect(en).toContain('Buy 2, get 1 free');
    expect(en).toContain('Code VERAO20');
    const pt = describePromotion(form, moneyPt, tPt);
    expect(pt).toContain('Compre 2, receba 1 grátis');
  });
  it('survives an incomplete form', () => {
    const form = baseForm({ benefits: [{ ...emptyBenefit('ORDER_FIXED'), amount: 'abc' }] });
    expect(() => describePromotion(form, moneyEn, tEn)).not.toThrow();
  });
});

describe('wallTimeNow', () => {
  it('formats the current minute in the store time zone', () => {
    const now = new Date('2026-07-01T09:05:30Z');
    expect(wallTimeNow('Europe/Lisbon', now)).toBe('2026-07-01T10:05');
    expect(wallTimeNow('UTC', now)).toBe('2026-07-01T09:05');
  });
});

describe('fix round 1', () => {
  const view = (over: Partial<Promotion> = {}): Promotion =>
    ({
      id: 4,
      name: 'X',
      description: null,
      code: 'X20',
      method: 'CODE',
      displayName: { pt: 'Promo', fr: 'Promo FR' },
      priority: 0,
      eligibility: { mode: 'ALL' },
      conditions: { type: 'GROUP', operator: 'AND', children: [] },
      benefits: [{ type: 'ORDER_FIXED', amount: 1250 }],
      stacking: { exclusive: false, withProduct: true, withOrder: true, withShipping: true },
      perOrderLimit: null,
      active: true,
      startsAt: '2026-07-01T10:00',
      endsAt: null,
      usageLimit: null,
      perCustomerLimit: null,
      status: 'ACTIVE',
      redemptions: 2,
      version: 7,
      timezone: 'Europe/Lisbon',
      createdAt: null,
      updatedAt: null,
      labels: { products: {}, variants: {} },
      ...over,
    }) as Promotion;

  it('activation / deactivation sends the stored definition with only `active` changed and the version, never form edits', () => {
    const body = activationInput(view(), false, ['en', 'pt']);
    expect(body).toMatchObject({ name: 'X', code: 'X20', active: false, version: 7 });
    expect(activationInput(view({ active: false }), true).active).toBe(true);
    expect(body.benefits).toEqual([{ type: 'ORDER_FIXED', amount: 1250 }]);
    expect(body.displayName).toEqual({ pt: 'Promo' });
    expect(body).not.toHaveProperty('status');
    expect(body).not.toHaveProperty('labels');
  });

  it('drops display names of locales that no longer exist', () => {
    const form = promotionFormFromView(view());
    expect(toPromotionInput(form, ['en', 'pt']).displayName).toEqual({ pt: 'Promo' });
    expect(toPromotionInput(form).displayName).toEqual({ pt: 'Promo', fr: 'Promo FR' });
  });

  it('formats loaded amounts in the admin locale', () => {
    expect(promotionFormFromView(view(), 'pt-PT').benefits[0].amount).toBe('12,50');
    expect(promotionFormFromView(view(), 'en').benefits[0].amount).toBe('12.50');
  });

  it('lists server errors that no field shows, by section', () => {
    expect(
      unmappedErrors({
        name: 'required',
        'stacking.withOrder': 'invalid',
        method: 'invalid',
        version: 'required',
        'benefits.0.get.mode': 'invalid',
        'benefits.0.percent': 'invalid_percent',
        'conditions.children.0.value': 'invalid_value',
        displayName: 'invalid',
      })
    ).toEqual([
      { section: 'general', path: 'displayName', code: 'invalid' },
      { section: 'method', path: 'method', code: 'invalid' },
      { section: 'benefits', path: 'benefits.0.get.mode', code: 'invalid' },
      { section: 'stacking', path: 'stacking.withOrder', code: 'invalid' },
      { section: 'other', path: 'version', code: 'required' },
    ]);
  });

  it('an incomplete gift benefit reads "…" instead of 0 gifts', () => {
    const text = describeBenefit(
      {
        type: 'BUY_X_GET_Y',
        buy: { target: { productIds: [1], variantIds: [] }, quantity: 2, minAmount: null },
        get: { mode: 'GIFT', variantIds: [], quantity: null as any },
        reward: { kind: 'FREE' },
      },
      moneyEn,
      tEn
    );
    expect(text).toBe('Buy 2, get … free');
  });

  it('compares end and start in UTC in the store time zone (spring-forward gap)', () => {
    // Lisbon, 2026-03-29: 01:00 -> 02:00. 01:30 does not exist and moves forward (01:30Z);
    // 02:15 is 01:15Z, so the end is before the start although its wall time is later.
    const form = baseForm({ startsAt: '2026-03-29T01:30', endsAt: '2026-03-29T02:15' });
    expect(validatePromotionForm(form, 'Europe/Lisbon')).toMatchObject({ endsAt: 'ends_before_start' });
    expect(validatePromotionForm(form, 'UTC')).toEqual({});
    expect(validatePromotionForm(baseForm({ endsAt: '2026-07-01T11:00' }), 'Europe/Lisbon')).toEqual({});
  });
});

describe('specific customers', () => {
  it('the form reads the customers from the view; a new form has none', () => {
    const view = {
      name: 'VIP',
      method: 'AUTOMATIC',
      displayName: {},
      conditions: { type: 'GROUP', operator: 'AND', children: [] },
      benefits: [],
      stacking: { exclusive: false, withProduct: true, withOrder: true, withShipping: true },
      startsAt: '2026-07-01T10:00',
      eligibility: { mode: 'CUSTOMERS', customerIds: [3] },
      eligibilityCustomers: [{ id: 3, firstName: 'Rui', lastName: null, email: 'r@x.pt' }],
    } as unknown as Promotion;
    const form = promotionFormFromView(view);
    expect(form.eligibilityMode).toBe('CUSTOMERS');
    expect(form.customers.map((c) => c.id)).toEqual([3]);
    expect(emptyPromotionForm('en', '2026-07-01T10:00').customers).toEqual([]);
  });
  it('has en and pt texts', () => {
    for (const t of [tEn, tPt]) {
      for (const k of ['eligibility.CUSTOMERS', 'customers.search', 'customers.empty', 'customers.required', 'customers.remove', 'activate', 'deactivate', 'editTimezone']) {
        expect(t(`ecommerce.promotions.form.${k}`)).not.toContain('ecommerce.promotions');
      }
    }
  });
});
