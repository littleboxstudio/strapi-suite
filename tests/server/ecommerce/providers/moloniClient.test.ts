import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetMoloniTokensForTests,
  createMoloniClient,
  describeShape,
} from '../../../../server/src/services/modules/ecommerce/providers/billing/moloni/client';
import { EcommerceBillingError } from '../../../../server/src/services/modules/ecommerce/errors';
import { TOKEN, json, moloniFake } from './moloniFake';

const rt = {
  config: { clientId: 'cid', username: 'user@x.pt', companyId: 42 },
  secrets: { clientSecret: 'CSECRET', password: 'PSECRET' },
};

beforeEach(() => __resetMoloniTokensForTests());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const fail = (p: Promise<unknown>) => p.then(() => null, (e) => e);

describe('createMoloniClient', () => {
  it('posts JSON with access_token, json=true and company_id', async () => {
    const m = moloniFake({ 'taxes/getAll': () => [{ tax_id: 1, value: 23 }] });
    const out = await createMoloniClient(rt).call('taxes/getAll', { foo: 1 });
    expect(out).toEqual([{ tax_id: 1, value: 23 }]);
    const c = m.of('taxes/getAll')[0];
    expect(c.init.method).toBe('POST');
    expect(c.init.headers['Content-Type']).toBe('application/json');
    expect(c.query.get('access_token')).toBe('AT-1');
    expect(c.query.get('json')).toBe('true');
    expect(c.body).toEqual({ foo: 1, company_id: 42 });
    const g = m.of('grant')[0];
    expect(g.query.get('grant_type')).toBe('password');
    expect(g.query.get('client_id')).toBe('cid');
    expect(g.query.get('client_secret')).toBe('CSECRET');
    expect(g.query.get('username')).toBe('user@x.pt');
    expect(g.query.get('password')).toBe('PSECRET');
  });

  it('passes a 20 s timeout to timedFetch', async () => {
    vi.useFakeTimers();
    moloniFake({ 'taxes/getAll': () => new Promise(() => undefined) });
    const p = fail(createMoloniClient(rt).call('taxes/getAll'));
    await vi.advanceTimersByTimeAsync(19_000);
    let settled = false;
    p.then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1_500);
    const err: any = await p;
    expect(err.code).toBe('BILLING_UNREACHABLE');
  });

  it('grants once for two calls (token cached per clientId:username)', async () => {
    const m = moloniFake({ 'taxes/getAll': () => [] });
    await createMoloniClient(rt).call('taxes/getAll');
    await createMoloniClient(rt).call('taxes/getAll');
    expect(m.of('grant')).toHaveLength(1);
    expect(m.of('taxes/getAll')).toHaveLength(2);
  });

  it('two concurrent calls share a single grant', async () => {
    const m = moloniFake({ 'taxes/getAll': () => [] });
    const c = createMoloniClient(rt);
    await Promise.all([c.call('taxes/getAll'), c.call('taxes/getAll')]);
    expect(m.of('grant')).toHaveLength(1);
  });

  it('renews with refresh_token 60 s before expiry', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-11T10:00:00Z'));
    let n = 0;
    const m = moloniFake({
      grant: () => ({ access_token: `AT-${++n}`, expires_in: 3600, refresh_token: `RT-${n}` }),
      'taxes/getAll': () => [],
    });
    await createMoloniClient(rt).call('taxes/getAll');
    vi.setSystemTime(new Date('2026-11-11T10:58:00Z')); // 2 min left: still valid
    await createMoloniClient(rt).call('taxes/getAll');
    expect(m.of('grant')).toHaveLength(1);
    vi.setSystemTime(new Date('2026-11-11T10:59:30Z')); // 30 s left: renew
    await createMoloniClient(rt).call('taxes/getAll');
    const grants = m.of('grant');
    expect(grants).toHaveLength(2);
    expect(grants[1].query.get('grant_type')).toBe('refresh_token');
    expect(grants[1].query.get('refresh_token')).toBe('RT-1');
    expect(grants[1].query.get('client_id')).toBe('cid');
    expect(grants[1].query.get('client_secret')).toBe('CSECRET');
    expect(m.of('taxes/getAll')[2].query.get('access_token')).toBe('AT-2');
  });

  it('falls back to the password grant when the refresh is refused', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-11T10:00:00Z'));
    const m = moloniFake({
      grant: (_b, q) =>
        q.get('grant_type') === 'refresh_token' ? json(400, { error: 'invalid_grant' }) : TOKEN,
      'taxes/getAll': () => [],
    });
    await createMoloniClient(rt).call('taxes/getAll');
    vi.setSystemTime(new Date('2026-11-11T11:00:00Z'));
    await createMoloniClient(rt).call('taxes/getAll');
    expect(m.of('grant').map((g) => g.query.get('grant_type'))).toEqual(['password', 'refresh_token', 'password']);
  });

  it('an invalid-token response forces a new grant and a single retry', async () => {
    let calls = 0;
    const m = moloniFake({
      'taxes/getAll': () => (++calls === 1 ? json(401, { error: 'invalid_token' }) : [{ tax_id: 1 }]),
    });
    expect(await createMoloniClient(rt).call('taxes/getAll')).toEqual([{ tax_id: 1 }]);
    expect(m.of('grant').map((g) => g.query.get('grant_type'))).toEqual(['password', 'password']);
    expect(m.of('taxes/getAll')).toHaveLength(2);
  });

  it('stops after one retry when the token is still invalid', async () => {
    const m = moloniFake({ 'taxes/getAll': () => json(401, { error: 'invalid_token' }) });
    const err: any = await fail(createMoloniClient(rt).call('taxes/getAll'));
    expect(err).toBeInstanceOf(EcommerceBillingError);
    expect(err.code).toBe('BILLING_AUTH_FAILED');
    expect(m.of('taxes/getAll')).toHaveLength(2);
  });

  it('refused grant -> BILLING_AUTH_FAILED (not UNREACHABLE), no secrets in message', async () => {
    const m = moloniFake({
      grant: () => json(400, { error: 'invalid_grant', error_description: 'bad password PSECRET' }),
      'taxes/getAll': () => [],
    });
    const err: any = await fail(createMoloniClient(rt).call('taxes/getAll'));
    expect(err).toBeInstanceOf(EcommerceBillingError);
    expect(err.code).toBe('BILLING_AUTH_FAILED');
    expect(err.uncertain).toBe(false);
    expect(err.message).not.toMatch(/PSECRET|CSECRET|AT-1|moloni\.pt/);
    expect(m.of('taxes/getAll')).toHaveLength(0);
  });

  it('array error body -> BILLING_REQUEST_FAILED with field:code only', async () => {
    moloniFake({
      'customers/insert': () => [
        { code: '2', field: 'vat', description: 'NIF 123456789 inválido para João' },
        { code: '1', field: 'name', description: 'Nome em falta' },
      ],
    });
    const err: any = await fail(createMoloniClient(rt).call('customers/insert', { vat: '123456789' }, { write: true }));
    expect(err).toBeInstanceOf(EcommerceBillingError);
    expect(err.code).toBe('BILLING_REQUEST_FAILED');
    expect(err.uncertain).toBe(false);
    expect(err.message).toContain('vat:2');
    expect(err.message).toContain('name:1');
    expect(err.message).not.toMatch(/123456789|João|inválido|Nome|SECRET|AT-1/);
  });

  it('the default string error list ("<code> <field> <bounds>") is a rejection, with the meaning of each code', async () => {
    moloniFake({
      'invoices/insert': () => ['1 customer_id', '2 language_id 1 0', '16 vat 123456789'],
    });
    const err: any = await fail(createMoloniClient(rt).call('invoices/insert', { vat: '123456789' }, { write: true }));
    expect(err).toBeInstanceOf(EcommerceBillingError);
    expect(err.code).toBe('BILLING_REQUEST_FAILED');
    // Moloni rejected it: nothing was issued.
    expect(err.uncertain).toBe(false);
    expect(err.message).toBe(
      'Moloni rejected invoices/insert (customer_id:1 (required), language_id:2 (number out of range), vat:16 (customer identification required (CIVA art. 36 n.º 15))).'
    );
    expect(err.message).not.toMatch(/123456789/);
  });

  it('a human_errors object list, with the field inside the code', async () => {
    moloniFake({ 'invoices/insert': () => [{ code: '1 name', description: "Field 'name' is required" }] });
    const err: any = await fail(createMoloniClient(rt).call('invoices/insert', {}, { write: true }));
    expect(err.message).toBe('Moloni rejected invoices/insert (name:1 (required)).');
  });

  it('errors nested in lists (one per document line) are a rejection too', async () => {
    moloniFake({ 'invoiceReceipts/insert': () => [['1 products.0.product_id', '5 products.0.exemption_reason']] });
    const err: any = await fail(createMoloniClient(rt).call('invoiceReceipts/insert', {}, { write: true }));
    expect(err.uncertain).toBe(false);
    expect(err.message).toBe(
      'Moloni rejected invoiceReceipts/insert (products.0.product_id:1 (required), products.0.exemption_reason:5 (invalid value)).'
    );
  });

  it('a list of plain values is not mistaken for errors', async () => {
    moloniFake({ 'documentSets/getAll': () => ['abc', 'def'] });
    await expect(createMoloniClient(rt).call('documentSets/getAll', {})).resolves.toEqual(['abc', 'def']);
  });

  it('{ valid: 0 } -> BILLING_REQUEST_FAILED', async () => {
    moloniFake({ 'products/insert': () => ({ valid: 0 }) });
    const err: any = await fail(createMoloniClient(rt).call('products/insert', {}, { write: true }));
    expect(err.code).toBe('BILLING_REQUEST_FAILED');
  });

  it('rejecting fetch -> BILLING_UNREACHABLE; uncertain only on writes', async () => {
    moloniFake({
      'taxes/getAll': () => {
        throw new Error('ECONNRESET https://api.moloni.pt/v1/taxes/getAll/?access_token=AT-1');
      },
      'invoiceReceipts/insert': () => {
        throw new Error('socket hang up');
      },
    });
    const read: any = await fail(createMoloniClient(rt).call('taxes/getAll'));
    expect(read.code).toBe('BILLING_UNREACHABLE');
    expect(read.uncertain).toBe(false);
    expect(read.message).not.toContain('AT-1');
    const write: any = await fail(createMoloniClient(rt).call('invoiceReceipts/insert', {}, { write: true }));
    expect(write.code).toBe('BILLING_UNREACHABLE');
    expect(write.uncertain).toBe(true);
  });

  it('timeout on a write -> uncertain', async () => {
    vi.useFakeTimers();
    moloniFake({ 'invoiceReceipts/insert': () => new Promise(() => undefined) });
    const p = fail(createMoloniClient(rt).call('invoiceReceipts/insert', {}, { write: true }));
    await vi.advanceTimersByTimeAsync(20_001);
    const err: any = await p;
    expect(err.code).toBe('BILLING_UNREACHABLE');
    expect(err.uncertain).toBe(true);
  });

  it('unreachable grant -> BILLING_UNREACHABLE, never uncertain (nothing written)', async () => {
    moloniFake({
      grant: () => {
        throw new Error('down');
      },
    });
    const err: any = await fail(createMoloniClient(rt).call('invoiceReceipts/insert', {}, { write: true }));
    expect(err.code).toBe('BILLING_UNREACHABLE');
    expect(err.uncertain).toBe(false);
  });

  it('5xx on a write is uncertain', async () => {
    moloniFake({ 'invoiceReceipts/insert': () => json(502, { error: 'bad gateway' }) });
    const err: any = await fail(createMoloniClient(rt).call('invoiceReceipts/insert', {}, { write: true }));
    expect(err.code).toBe('BILLING_UNREACHABLE');
    expect(err.uncertain).toBe(true);
  });

  it('missing required fields -> BILLING_CONFIG_MISSING, no fetch', async () => {
    const m = moloniFake({});
    const err: any = await fail(
      createMoloniClient({ config: { clientId: 'cid' }, secrets: { password: 'p' } }).call('taxes/getAll')
    );
    expect(err).toBeInstanceOf(EcommerceBillingError);
    expect(err.code).toBe('BILLING_CONFIG_MISSING');
    expect(err.message).toBe('Missing fields: clientSecret, username, companyId');
    expect(m.f).not.toHaveBeenCalled();
  });
});

describe('describeShape', () => {
  it('names the shape of an answer, never its values', () => {
    expect(describeShape(['1 x', 2])).toBe('a list of 2 (string; number)');
    expect(describeShape([[{ a: 1 }, 'x']])).toBe('a list of 1 (a list of 2 (an object with a; string))');
    expect(describeShape([])).toBe('an empty list');
    expect(describeShape({ valid: 1, secret: 'v' })).toBe('an object with valid, secret');
    expect(describeShape(null)).toBe('no body');
    expect(describeShape('oops')).toBe('a string');
  });
});
