import { describe, it, expect, beforeEach } from 'vitest';
import {
  getProviderDefinitions,
  getProviderDefinition,
  registerProvider,
  validateProviderInput,
  __resetRegistryForTests,
} from '../../../../server/src/services/modules/ecommerce/providers/registry';

beforeEach(() => __resetRegistryForTests());

describe('provider registry', () => {
  it('has the 5 built-in definitions with categories', () => {
    const byId = Object.fromEntries(getProviderDefinitions().map((d) => [d.id, d]));
    expect(Object.keys(byId).sort()).toEqual(['ctt-expresso', 'manual', 'moloni', 'resend', 'stripe']);
    expect(byId.stripe.category).toBe('payment');
    expect(byId.moloni.category).toBe('billing');
    expect(byId.moloni.exclusive).toBe(true);
    expect(byId.moloni.verified).toBe(false);
    expect(byId['ctt-expresso'].category).toBe('carrier');
    expect(byId['ctt-expresso'].verified).toBe(false);
    expect(byId.manual.category).toBe('carrier');
    expect(byId.manual.fields).toEqual([]);
    expect(byId.manual.testConnection).toBeUndefined();
    expect(byId.resend.category).toBe('email');
  });

  it('exposes the exact fields', () => {
    const f = (id: string) =>
      getProviderDefinition(id)!.fields.map((x) => `${x.key}:${x.type}:${x.required ? '*' : ''}`);
    expect(f('stripe')).toEqual([
      'secretKey:secret:*', 'webhookSecret:secret:', 'publishableKey:string:',
      'paymentSuccessPath:string:*', 'paymentCancelPath:string:*',
    ]);
    expect(f('moloni')).toEqual([
      'clientId:string:*', 'clientSecret:secret:*', 'username:string:*', 'password:secret:*',
      'companyId:number:*', 'documentType:select:', 'documentSetId:number:', 'exemptionReason:string:',
      'paymentMethodId:number:', 'storeCreditPaymentMethodId:number:', 'productCategoryId:number:',
      'measurementUnitId:number:', 'shippingReference:string:',
    ]);
    expect(f('ctt-expresso')).toEqual([
      'clientId:string:*', 'contractNumber:string:*', 'username:string:*', 'password:secret:*',
    ]);
    expect(f('resend')).toEqual(['apiKey:secret:*', 'fromEmail:string:*', 'fromName:string:']);
    expect(getProviderDefinition('moloni')!.fields.find((x) => x.key === 'shippingReference')!.default).toBe('PORTES');
    const dt = getProviderDefinition('moloni')!.fields.find((x) => x.key === 'documentType')!;
    expect(dt.default).toBe('FR');
    expect(dt.options).toEqual(['FR', 'FT']);
    expect(getProviderDefinition('stripe')!.fields[0].label).toBe(
      'ecommerce.settings.providers.stripe.fields.secretKey'
    );
  });

  it('rejects duplicate ids and accepts new ones', () => {
    const def = { id: 'x', category: 'email' as const, name: 'X', fields: [], exclusive: false, verified: true };
    registerProvider(def);
    expect(getProviderDefinition('x')).toBe(def);
    expect(() => registerProvider(def)).toThrow();
    expect(() => registerProvider({ ...def, id: 'stripe' })).toThrow();
    __resetRegistryForTests();
    expect(getProviderDefinition('x')).toBeUndefined();
  });
});

describe('validateProviderInput', () => {
  const stripe = () => getProviderDefinition('stripe')!;
  const moloni = () => getProviderDefinition('moloni')!;

  it('requires a required secret only when none is stored', () => {
    const config = { paymentSuccessPath: '/ok', paymentCancelPath: '/no' };
    expect(validateProviderInput(stripe(), { config }, () => false)).toEqual([
      { path: 'secrets.secretKey', code: 'required' },
    ]);
    expect(validateProviderInput(stripe(), { config }, (k) => k === 'secretKey')).toEqual([]);
    expect(validateProviderInput(stripe(), { config, secrets: { secretKey: 'sk' } }, () => false)).toEqual([]);
    expect(validateProviderInput(stripe(), { config, secrets: { secretKey: '' } }, () => false)).toHaveLength(1);
  });

  it('validates email-format string fields (resend fromEmail)', () => {
    const resend = getProviderDefinition('resend')!;
    expect(resend.fields.find((f) => f.key === 'fromEmail')).toMatchObject({ type: 'string', format: 'email' });
    const secrets = { apiKey: 're_x' };
    expect(validateProviderInput(resend, { config: { fromEmail: 'shop@acme.example' }, secrets }, () => false)).toEqual([]);
    expect(validateProviderInput(resend, { config: { fromEmail: ' shop@acme.example ' }, secrets }, () => false)).toEqual([]);
    for (const bad of ['shop', 'shop@acme', 'a b@acme.example', 42]) {
      expect(validateProviderInput(resend, { config: { fromEmail: bad }, secrets }, () => false)).toEqual([
        { path: 'config.fromEmail', code: 'invalid_email' },
      ]);
    }
  });

  it('validates path-format string fields', () => {
    const def: any = {
      id: 'p', category: 'payment', name: 'P', exclusive: false, verified: true,
      fields: [{ key: 'back', type: 'string', format: 'path', required: false, label: 'x' }],
    };
    for (const bad of ['checkout/ok', '//evil.com', '/a b', '/a\\b', 42]) {
      expect(validateProviderInput(def, { config: { back: bad } }, () => false)).toEqual([
        { path: 'config.back', code: 'invalid_path' },
      ]);
    }
    expect(validateProviderInput(def, { config: { back: '/obrigado' } }, () => false)).toEqual([]);
  });

  it('the stripe definition carries the return paths with defaults', () => {
    const fields = getProviderDefinition('stripe')!.fields;
    expect(fields.find((f) => f.key === 'paymentSuccessPath')).toMatchObject({
      type: 'string', format: 'path', required: true, default: '/checkout/success',
    });
    expect(fields.find((f) => f.key === 'paymentCancelPath')).toMatchObject({
      type: 'string', format: 'path', required: true, default: '/checkout/cancel',
    });
  });

  it('requires plain fields and validates numbers and options', () => {
    const base = { clientId: 'a', username: 'u', companyId: 1 };
    const secrets = { clientSecret: 's', password: 'p' };
    expect(validateProviderInput(moloni(), { config: base, secrets }, () => false)).toEqual([]);
    expect(validateProviderInput(moloni(), { config: { ...base, companyId: '12' }, secrets }, () => false)).toEqual([]);
    expect(validateProviderInput(moloni(), { config: { ...base, companyId: 'abc' }, secrets }, () => false)).toEqual([
      { path: 'config.companyId', code: 'invalid_number' },
    ]);
    expect(validateProviderInput(moloni(), { config: { ...base, companyId: 1.5 }, secrets }, () => false)).toEqual([
      { path: 'config.companyId', code: 'invalid_number' },
    ]);
    expect(validateProviderInput(moloni(), { config: { ...base, documentType: 'XX' }, secrets }, () => false)).toEqual([
      { path: 'config.documentType', code: 'invalid_option' },
    ]);
    expect(validateProviderInput(moloni(), { config: { ...base, documentType: 'FT' }, secrets }, () => false)).toEqual([]);
    const missing = validateProviderInput(moloni(), {}, () => false).map((i) => i.path);
    expect(missing).toEqual([
      'config.clientId', 'secrets.clientSecret', 'config.username', 'secrets.password', 'config.companyId',
    ]);
  });
});
