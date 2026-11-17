import { describe, it, expect } from 'vitest';
import contentTypes from '../../../server/src/content-types';
import config from '../../../server/src/config';
import {
  mergePaymentMethodNames,
  paymentMethodKey,
} from '../../../server/src/services/modules/ecommerce/domain/paymentMethodSuggestions';
import { setupCommerce, createOrder, UIDS } from './helpers/commerceSetup';

const P = 'plugin::littlebox-strapi-suite.ltb-st-module-ecommerce-';

describe('paymentMethodKey', () => {
  it('lowercases and removes every whitespace', () => {
    expect(paymentMethodKey('MB Way')).toBe('mbway');
    expect(paymentMethodKey('  mb\tWAY \n')).toBe('mbway');
    expect(paymentMethodKey('Transferência  Bancária')).toBe('transferênciabancária');
  });

  it('is empty for blank or non-string input', () => {
    expect(paymentMethodKey('   ')).toBe('');
    expect(paymentMethodKey(undefined as any)).toBe('');
    expect(paymentMethodKey(null as any)).toBe('');
  });
});

describe('mergePaymentMethodNames', () => {
  it('dedupes by key (first spelling wins), trims, drops blanks and sorts', () => {
    expect(
      mergePaymentMethodNames(['MB Way', 'Cash'], [' mbway ', 'Transferência', '', '  ', 'cash'])
    ).toEqual(['Cash', 'MB Way', 'Transferência']);
  });
});

describe('payment-method-suggestion content-type', () => {
  it('is registered, hidden and well formed', () => {
    const schema: any = (contentTypes as any)['ltb-st-module-ecommerce-payment-method-suggestion']?.schema;
    expect(schema).toBeDefined();
    expect(schema.collectionName).toBe('ltb_st_module_ecommerce_payment_method_suggestions');
    expect(schema.info.singularName).toBe('ltb-st-module-ecommerce-payment-method-suggestion');
    expect(schema.pluginOptions['content-manager'].visible).toBe(false);
    expect(schema.pluginOptions['content-type-builder'].visible).toBe(false);
    expect(schema.pluginOptions.i18n.localized).toBe(false);
    expect(schema.options.draftAndPublish).toBe(false);
    expect(schema.attributes.name).toMatchObject({ type: 'string', required: true, maxLength: 255 });
    expect(schema.attributes.key).toMatchObject({ type: 'string', required: true, unique: true });
  });

  it('registers the UID', () => {
    const u = (config as any).default.uuid.modules.ecommerce;
    expect(u.paymentMethodSuggestion).toBe(`${P}payment-method-suggestion`);
  });
});

describe('manual payment saves its method as a suggestion', () => {
  const pay = (c: any, id: number, methodLabel: string | undefined, key: string, amount = 100) =>
    c.payments.addManualPayment(id, { amount, methodLabel, idempotencyKey: key }, 'user:1');

  it('saves a new method once, trimmed, with its key', async () => {
    const c = setupCommerce();
    const id = await createOrder(c);
    await pay(c, id, '  MB Way  ', 'k1');
    expect(c.tables[UIDS.paymentMethodSuggestion]).toEqual([
      expect.objectContaining({ name: 'MB Way', key: 'mbway' }),
    ]);
  });

  it('case and whitespace variants do not duplicate', async () => {
    const c = setupCommerce();
    const id = await createOrder(c);
    await pay(c, id, 'MB Way', 'k1');
    await pay(c, id, 'mbway', 'k2');
    await pay(c, id, 'M B  WAY', 'k3');
    await pay(c, id, 'Cash', 'k4');
    expect(c.tables[UIDS.paymentMethodSuggestion].map((r: any) => r.name)).toEqual([
      'MB Way',
      'Cash',
    ]);
  });

  it('a lost insert race (unique violation) is ignored', async () => {
    const c = setupCommerce();
    const id = await createOrder(c);
    const original = c.strapi.db.query;
    c.strapi.db.query = (uid: string) => {
      const q = original(uid);
      if (uid !== UIDS.paymentMethodSuggestion) return q;
      // The existence check misses; the insert then hits the row a concurrent request wrote.
      return {
        ...q,
        findOne: async () => null,
        create: async (p: any) => {
          c.tables[UIDS.paymentMethodSuggestion].push({ id: 99, name: 'MB WAY', key: 'mbway' });
          return q.create(p);
        },
      };
    };
    const payment = await pay(c, id, 'MB Way', 'k1');
    expect(payment.methodLabel).toBe('MB Way');
    expect(c.tables[UIDS.paymentMethodSuggestion]).toHaveLength(1);
  });

  it('a failure to save the suggestion never fails the payment', async () => {
    const c = setupCommerce();
    const id = await createOrder(c);
    const original = c.strapi.db.query;
    c.strapi.db.query = (uid: string) => {
      const q = original(uid);
      if (uid !== UIDS.paymentMethodSuggestion) return q;
      const boom = async () => {
        throw new Error('db down');
      };
      return { ...q, findOne: boom, create: boom };
    };
    const payment = await pay(c, id, 'MB Way', 'k1');
    expect(payment).toMatchObject({ method: 'MANUAL', methodLabel: 'MB Way' });
    expect(c.tables[UIDS.payment]).toHaveLength(1);
    expect(c.log.warn).toHaveBeenCalled();
  });

  it('a payment without a method saves nothing', async () => {
    const c = setupCommerce();
    const id = await createOrder(c);
    await pay(c, id, undefined, 'k1');
    expect(c.tables[UIDS.paymentMethodSuggestion]).toHaveLength(0);
  });

  it('a refused payment saves nothing', async () => {
    const c = setupCommerce();
    const id = await createOrder(c);
    await expect(pay(c, id, 'MB Way', 'k1', -5)).rejects.toThrow();
    expect(c.tables[UIDS.paymentMethodSuggestion]).toHaveLength(0);
  });
});

describe('EcommercePaymentMethodSuggestionService.list', () => {
  it('merges the table and existing manual payments, deduplicated by key and sorted', async () => {
    const c = setupCommerce();
    const t = c.tables;
    t[UIDS.paymentMethodSuggestion].push(
      { id: 1, name: 'Transferência', key: 'transferência' },
      { id: 2, name: 'MB Way', key: 'mbway' }
    );
    t[UIDS.payment].push(
      { id: 1, method: 'MANUAL', metadata: { methodLabel: 'mb way' } },
      { id: 2, method: 'MANUAL', metadata: { methodLabel: 'Cash' } },
      { id: 3, method: 'MANUAL', metadata: { methodLabel: 'CASH ' } },
      { id: 4, method: 'MANUAL', metadata: { methodLabel: null } },
      { id: 5, method: 'MANUAL', metadata: null },
      { id: 6, method: 'STRIPE', metadata: { methodLabel: 'Stripe card' } },
      { id: 7, method: 'STORE_CREDIT', metadata: { methodLabel: 'Credit' } }
    );
    const svc = c.services.EcommercePaymentMethodSuggestionService;
    expect(await svc.list()).toEqual({ names: ['Cash', 'MB Way', 'Transferência'] });
  });

  it('is empty when nothing was ever written', async () => {
    const c = setupCommerce();
    expect(await c.services.EcommercePaymentMethodSuggestionService.list()).toEqual({ names: [] });
  });
});

describe('EcommercePaymentMethodSuggestionService.remove (hide)', () => {
  const svc = (c: any) => c.services.EcommercePaymentMethodSuggestionService;
  const pay = (c: any, id: number, methodLabel: string, key: string) =>
    c.payments.addManualPayment(id, { amount: 100, methodLabel, idempotencyKey: key }, 'user:1');

  it('the schema has a hidden flag', () => {
    const schema: any = (contentTypes as any)['ltb-st-module-ecommerce-payment-method-suggestion'].schema;
    expect(schema.attributes.hidden).toMatchObject({ type: 'boolean', default: false });
  });

  it('hides a table row: excluded from the table and from existing payments', async () => {
    const c = setupCommerce();
    c.tables[UIDS.paymentMethodSuggestion].push(
      { id: 1, name: 'MB Way', key: 'mbway', hidden: false },
      { id: 2, name: 'Cash', key: 'cash', hidden: false }
    );
    c.tables[UIDS.payment].push({ id: 1, method: 'MANUAL', metadata: { methodLabel: 'MB WAY' } });
    expect(await svc(c).remove('mb way')).toEqual({ key: 'mbway', hidden: true });
    expect(c.tables[UIDS.paymentMethodSuggestion]).toHaveLength(2);
    expect(c.tables[UIDS.paymentMethodSuggestion][0]).toMatchObject({ key: 'mbway', hidden: true });
    expect(await svc(c).list()).toEqual({ names: ['Cash'] });
  });

  it('hides a method that only exists in payments with a hidden row', async () => {
    const c = setupCommerce();
    c.tables[UIDS.payment].push(
      { id: 1, method: 'MANUAL', metadata: { methodLabel: 'Multibanco' } },
      { id: 2, method: 'MANUAL', metadata: { methodLabel: 'Cash' } }
    );
    await svc(c).remove('Multibanco');
    expect(c.tables[UIDS.paymentMethodSuggestion]).toEqual([
      expect.objectContaining({ key: 'multibanco', hidden: true }),
    ]);
    expect(await svc(c).list()).toEqual({ names: ['Cash'] });
  });

  it('is idempotent, also for an unknown key', async () => {
    const c = setupCommerce();
    await svc(c).remove('PayPal');
    await svc(c).remove('pay pal');
    expect(c.tables[UIDS.paymentMethodSuggestion]).toEqual([
      expect.objectContaining({ key: 'paypal', hidden: true }),
    ]);
    expect(await svc(c).list()).toEqual({ names: [] });
  });

  it('refuses a blank key', async () => {
    const c = setupCommerce();
    await expect(svc(c).remove('   ')).rejects.toThrow();
  });

  it('a new payment with a hidden method un-hides it', async () => {
    const c = setupCommerce();
    const id = await createOrder(c);
    await pay(c, id, 'MB Way', 'k1');
    await svc(c).remove('mbway');
    expect(await svc(c).list()).toEqual({ names: [] });
    await pay(c, id, 'mb way', 'k2');
    expect(c.tables[UIDS.paymentMethodSuggestion]).toEqual([
      expect.objectContaining({ name: 'MB Way', key: 'mbway', hidden: false }),
    ]);
    expect(await svc(c).list()).toEqual({ names: ['MB Way'] });
  });
});
