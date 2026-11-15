import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  dpdCreateExpedition,
  dpdDownloadLabel,
  dpdToken,
} from '../../../../server/src/services/modules/ecommerce/providers/carriers/dpd/client';
import {
  PUDO_NAMESPACE,
  PUDO_SOAP_ACTION,
  searchPudo,
} from '../../../../server/src/services/modules/ecommerce/providers/carriers/dpd/pickupClient';
import {
  createDpdPortugalAdapter,
  dpdPortugalAdapter,
} from '../../../../server/src/services/modules/ecommerce/providers/carriers/dpdPortugal';
import { getProviderDefinition } from '../../../../server/src/services/modules/ecommerce/providers/registry';
import { EcommerceCarrierError } from '../../../../server/src/services/modules/ecommerce/errors';
import type { CarrierShipmentRequest } from '../../../../server/src/services/modules/ecommerce/providers/carriers/types';

const SECRETS = {
  clientSecret: 'dpd-client-secret-XYZ123',
  password: 'dpd-password-ABC987',
  pickupKey: 'dpd-pickup-key-QWE555',
};
const SECRET_VALUES = Object.values(SECRETS).concat(['tok-SECRET-TOKEN-777']);

const config = (over: Record<string, unknown> = {}) => ({
  authEndpoint: 'https://dpd.test/auth',
  expeditionEndpoint: 'https://dpd.test/expedition',
  clientId: 'client-1',
  username: 'user-1',
  accountHome: 'HOME-001',
  accountShop: 'SHOP-002',
  pickupEndpoint: 'http://pudo.test/mypudo/mypudo.asmx?wsdl',
  senderName: 'Loja Teste',
  senderAddress: 'Rua do Remetente 1',
  senderPostalCode: '4000123',
  senderCity: 'Porto',
  senderPhone: '912345678',
  senderEmail: 'loja@example.com',
  ...over,
});
const rt = (over: Record<string, unknown> = {}, secrets: Record<string, string> = SECRETS) => ({
  config: config(over),
  secrets: { ...secrets },
});

const json = (status: number, body: unknown) =>
  ({
    status,
    ok: status >= 200 && status < 300,
    text: async () => JSON.stringify(body),
    json: async () => body,
  }) as unknown as Response;
const xml = (status: number, body: string) =>
  ({ status, ok: status >= 200 && status < 300, text: async () => body }) as unknown as Response;

const stubFetch = (impl: (url: string, init: any) => any) => {
  const fn = vi.fn(impl);
  vi.stubGlobal('fetch', fn);
  return fn;
};
afterEach(() => vi.unstubAllGlobals());

const TOKEN_OK = { status_code: 200, result: { access_token: 'tok-SECRET-TOKEN-777' } };
const EXPEDITION_OK = {
  status_code: 200,
  result: { num_guia: ['09876543210123'], pdf_url: 'https://labels.dpd.test/abc.pdf' },
};

/** Expects `p` to reject with `code` and no secret value anywhere in the error. */
async function rejectsWith(p: Promise<unknown>, code: string, uncertain = false) {
  const err = await p.then(
    () => null,
    (e) => e
  );
  expect(err).toBeInstanceOf(EcommerceCarrierError);
  expect(err.code).toBe(code);
  expect(err.uncertain).toBe(uncertain);
  const text = `${err.message} ${JSON.stringify(err)} ${String(err.stack)}`;
  for (const s of SECRET_VALUES) expect(text).not.toContain(s);
  return err;
}

const pudoXml = (inner: string) => `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <soap:Body>
    <GetPudoListResponse xmlns="http://MyPudo.pickup-services.com/">
      <GetPudoListResult>
        <RESPONSE quality="1">${inner}</RESPONSE>
      </GetPudoListResult>
    </GetPudoListResponse>
  </soap:Body>
</soap:Envelope>`;

const TWO_PUDOS = pudoXml(`
  <REQUEST_ID>DPD-PT</REQUEST_ID>
  <PUDO_ITEMS>
    <PUDO_ITEM active="true">
      <PUDO_ID>PT10001</PUDO_ID>
      <NAME>Papelaria &amp; Livraria</NAME>
      <ADDRESS1>Rua Augusta</ADDRESS1>
      <ADDRESS2 />
      <STREETNUM>10</STREETNUM>
      <ZIPCODE>1100053</ZIPCODE>
      <CITY>Lisboa</CITY>
      <OPENING_HOURS_ITEMS>
        <OPENING_HOURS_ITEM><DAY_ID>1</DAY_ID><START_TM>09:00</START_TM><END_TM>13:00</END_TM></OPENING_HOURS_ITEM>
        <OPENING_HOURS_ITEM><DAY_ID>1</DAY_ID><START_TM>14:00</START_TM><END_TM>19:00</END_TM></OPENING_HOURS_ITEM>
      </OPENING_HOURS_ITEMS>
    </PUDO_ITEM>
    <PUDO_ITEM active="true">
      <PUDO_ID>PT10002</PUDO_ID>
      <NAME>Café da Esquina</NAME>
      <ADDRESS1>Praça do Comércio</ADDRESS1>
      <ADDRESS2>Loja B</ADDRESS2>
      <STREETNUM></STREETNUM>
      <ZIPCODE>1100-148</ZIPCODE>
      <CITY>Lisboa</CITY>
      <OPENING_HOURS_ITEMS>
        <OPENING_HOURS_ITEM><DAY_ID>6</DAY_ID><START_TM>10:00</START_TM><END_TM>12:00</END_TM></OPENING_HOURS_ITEM>
      </OPENING_HOURS_ITEMS>
    </PUDO_ITEM>
  </PUDO_ITEMS>`);

const PUDO_ERROR = pudoXml(`<REQUEST_ID>DPD-PT</REQUEST_ID><ERROR>Invalid key</ERROR>`);

// ---------------------------------------------------------------------------

describe('dpdToken', () => {
  it('posts the password grant and returns the access token', async () => {
    const f = stubFetch(async () => json(200, TOKEN_OK));
    await expect(dpdToken(rt(), { timeoutMs: 5000 })).resolves.toBe('tok-SECRET-TOKEN-777');
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('https://dpd.test/auth');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({
      username: 'user-1',
      password: SECRETS.password,
      client_id: 'client-1',
      client_secret: SECRETS.clientSecret,
      grant_type: 'password',
    });
  });

  it('status_code 401 → DPD_AUTH_FAILED without secrets', async () => {
    stubFetch(async () => json(200, { status_code: 401, message: `bad ${SECRETS.password}` }));
    await rejectsWith(dpdToken(rt(), { timeoutMs: 5000 }), 'DPD_AUTH_FAILED');
  });

  it('a 200 without a token → DPD_AUTH_FAILED', async () => {
    stubFetch(async () => json(200, { status_code: 200, result: {} }));
    await rejectsWith(dpdToken(rt(), { timeoutMs: 5000 }), 'DPD_AUTH_FAILED');
  });

  it('a network error → CARRIER_UNREACHABLE without secrets', async () => {
    stubFetch(async () => {
      throw new Error(`boom ${SECRETS.clientSecret}`);
    });
    await rejectsWith(dpdToken(rt(), { timeoutMs: 5000 }), 'CARRIER_UNREACHABLE');
  });

  it('missing credentials → CARRIER_NOT_CONFIGURED without calling DPD', async () => {
    const f = stubFetch(async () => json(200, TOKEN_OK));
    await rejectsWith(dpdToken(rt({}, { clientSecret: SECRETS.clientSecret }), {}), 'CARRIER_NOT_CONFIGURED');
    expect(f).not.toHaveBeenCalled();
  });
});

describe('dpdCreateExpedition', () => {
  it('sends the body with the bearer token and returns the guide and label url', async () => {
    const f = stubFetch(async (url) => (url.endsWith('/auth') ? json(200, TOKEN_OK) : json(200, EXPEDITION_OK)));
    const body = { encomenda_referencia: 'LB-SHP-1' };
    await expect(dpdCreateExpedition(rt(), body, { timeoutMs: 5000 })).resolves.toEqual({
      trackingCode: '09876543210123',
      labelUrl: 'https://labels.dpd.test/abc.pdf',
    });
    const [url, init] = f.mock.calls[1];
    expect(url).toBe('https://dpd.test/expedition');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer tok-SECRET-TOKEN-777');
    expect(JSON.parse(init.body)).toEqual(body);
  });

  it('a 4xx → DPD_SHIPMENT_FAILED (certain)', async () => {
    stubFetch(async (url) => (url.endsWith('/auth') ? json(200, TOKEN_OK) : json(400, { message: 'bad' })));
    await rejectsWith(dpdCreateExpedition(rt(), {}, { timeoutMs: 5000 }), 'DPD_SHIPMENT_FAILED');
  });

  it('a status_code other than 200 → DPD_SHIPMENT_FAILED (certain)', async () => {
    stubFetch(async (url) =>
      url.endsWith('/auth') ? json(200, TOKEN_OK) : json(200, { status_code: 422, result: null })
    );
    await rejectsWith(dpdCreateExpedition(rt(), {}, { timeoutMs: 5000 }), 'DPD_SHIPMENT_FAILED');
  });

  it('a 5xx → DPD_SHIPMENT_FAILED, uncertain', async () => {
    stubFetch(async (url) => (url.endsWith('/auth') ? json(200, TOKEN_OK) : json(502, {})));
    await rejectsWith(dpdCreateExpedition(rt(), {}, { timeoutMs: 5000 }), 'DPD_SHIPMENT_FAILED', true);
  });

  it('a 200 without a guide number → DPD_SHIPMENT_FAILED, uncertain', async () => {
    stubFetch(async (url) =>
      url.endsWith('/auth') ? json(200, TOKEN_OK) : json(200, { status_code: 200, result: {} })
    );
    await rejectsWith(dpdCreateExpedition(rt(), {}, { timeoutMs: 5000 }), 'DPD_SHIPMENT_FAILED', true);
  });

  it('a network error or timeout on the expedition → uncertain', async () => {
    stubFetch(async (url) => {
      if (url.endsWith('/auth')) return json(200, TOKEN_OK);
      throw new Error(`timeout Bearer tok-SECRET-TOKEN-777`);
    });
    await rejectsWith(dpdCreateExpedition(rt(), {}, { timeoutMs: 5000 }), 'CARRIER_UNREACHABLE', true);
  });

  it('a stalled expedition is aborted after timeoutMs and is uncertain', async () => {
    stubFetch(async (url) => (url.endsWith('/auth') ? json(200, TOKEN_OK) : new Promise(() => undefined)));
    await rejectsWith(dpdCreateExpedition(rt(), {}, { timeoutMs: 20 }), 'CARRIER_UNREACHABLE', true);
  });

  it('an auth failure is certain (nothing was sent)', async () => {
    const f = stubFetch(async () => json(200, { status_code: 401 }));
    await rejectsWith(dpdCreateExpedition(rt(), {}, { timeoutMs: 5000 }), 'DPD_AUTH_FAILED');
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe('dpdDownloadLabel', () => {
  it('downloads the label url', async () => {
    const pdf = Buffer.from('%PDF-1.4 test');
    const f = stubFetch(async () => ({ status: 200, ok: true, arrayBuffer: async () => pdf }) as any);
    const out = await dpdDownloadLabel('https://labels.dpd.test/abc.pdf', { timeoutMs: 5000 });
    expect(out.equals(pdf)).toBe(true);
    expect(f.mock.calls[0][0]).toBe('https://labels.dpd.test/abc.pdf');
  });

  it('a non-200 → CARRIER_REQUEST_FAILED; unreachable → CARRIER_UNREACHABLE', async () => {
    stubFetch(async () => ({ status: 404, ok: false, arrayBuffer: async () => new ArrayBuffer(0) }) as any);
    await rejectsWith(dpdDownloadLabel('https://labels.dpd.test/abc.pdf', {}), 'CARRIER_REQUEST_FAILED');
    stubFetch(async () => {
      throw new Error('down');
    });
    await rejectsWith(dpdDownloadLabel('https://labels.dpd.test/abc.pdf', {}), 'CARRIER_UNREACHABLE');
  });

  it('refuses a non-http url without fetching', async () => {
    const f = stubFetch(async () => json(200, {}));
    await rejectsWith(dpdDownloadLabel('file:///etc/passwd', {}), 'CARRIER_REQUEST_FAILED');
    expect(f).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------

describe('searchPudo', () => {
  it('posts a SOAP 1.1 GetPudoList envelope to the endpoint without ?wsdl', async () => {
    const f = stubFetch(async () => xml(200, TWO_PUDOS));
    await searchPudo('http://pudo.test/mypudo/mypudo.asmx?wsdl', SECRETS.pickupKey, '1000-001', { timeoutMs: 5000 });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('http://pudo.test/mypudo/mypudo.asmx');
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('text/xml; charset=utf-8');
    expect(init.headers.SOAPAction).toBe(`"${PUDO_SOAP_ACTION}"`);
    expect(PUDO_NAMESPACE).toBe('http://MyPudo.pickup-services.com/');
    expect(PUDO_SOAP_ACTION).toBe('http://MyPudo.pickup-services.com/GetPudoList');
    const body: string = init.body;
    expect(body).toContain(`<GetPudoList xmlns="${PUDO_NAMESPACE}">`);
    expect(body).toContain('<carrier>CHR</carrier>');
    expect(body).toContain(`<key>${SECRETS.pickupKey}</key>`);
    expect(body).toContain('<zipCode>1000-001</zipCode>');
    expect(body).toContain('<city>?</city>');
    expect(body).toContain('<countrycode>PRT</countrycode>');
    expect(body).toContain('<requestID>DPD-PT</requestID>');
  });

  it('escapes XML in the arguments', async () => {
    const f = stubFetch(async () => xml(200, TWO_PUDOS));
    await searchPudo('http://pudo.test/x.asmx', 'a<b&c', '1000', {});
    expect(f.mock.calls[0][1].body).toContain('<key>a&lt;b&amp;c</key>');
  });

  it('normalizes two PUDO_ITEMs with hours', async () => {
    stubFetch(async () => xml(200, TWO_PUDOS));
    const points = await searchPudo('http://pudo.test/x.asmx', 'k', '1100-053', {});
    expect(points).toEqual([
      {
        id: 'PT10001',
        name: 'Papelaria & Livraria',
        address: 'Rua Augusta 10',
        address2: null,
        postalCode: '1100-053',
        city: 'Lisboa',
        country: 'PT',
        openingHours: [
          { day: 1, from: '09:00', to: '13:00' },
          { day: 1, from: '14:00', to: '19:00' },
        ],
      },
      {
        id: 'PT10002',
        name: 'Café da Esquina',
        address: 'Praça do Comércio',
        address2: 'Loja B',
        postalCode: '1100-148',
        city: 'Lisboa',
        country: 'PT',
        openingHours: [{ day: 6, from: '10:00', to: '12:00' }],
      },
    ]);
  });

  it('reads a result sent as escaped XML text', async () => {
    const inner = TWO_PUDOS.slice(TWO_PUDOS.indexOf('<RESPONSE'), TWO_PUDOS.indexOf('</RESPONSE>') + 11);
    const escaped = inner.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const doc = TWO_PUDOS.replace(inner, escaped);
    stubFetch(async () => xml(200, doc));
    const points = await searchPudo('http://pudo.test/x.asmx', 'k', '1100-053', {});
    expect(points.map((p) => p.id)).toEqual(['PT10001', 'PT10002']);
    expect(points[0].name).toBe('Papelaria & Livraria');
  });

  it('no PUDO_ITEMS → empty list', async () => {
    stubFetch(async () => xml(200, pudoXml('<REQUEST_ID>DPD-PT</REQUEST_ID><PUDO_ITEMS />')));
    await expect(searchPudo('http://pudo.test/x.asmx', 'k', '1000-001', {})).resolves.toEqual([]);
  });

  it('RESPONSE.ERROR → PICKUP_SEARCH_FAILED without the key', async () => {
    stubFetch(async () => xml(200, PUDO_ERROR));
    await rejectsWith(searchPudo('http://pudo.test/x.asmx', SECRETS.pickupKey, '1000-001', {}), 'PICKUP_SEARCH_FAILED');
  });

  it('transport failures → PICKUP_SEARCH_FAILED', async () => {
    stubFetch(async () => xml(500, '<soap:Fault/>'));
    await rejectsWith(searchPudo('http://pudo.test/x.asmx', SECRETS.pickupKey, '1000-001', {}), 'PICKUP_SEARCH_FAILED');
    stubFetch(async () => {
      throw new Error(`down ${SECRETS.pickupKey}`);
    });
    await rejectsWith(searchPudo('http://pudo.test/x.asmx', SECRETS.pickupKey, '1000-001', {}), 'PICKUP_SEARCH_FAILED');
    stubFetch(async () => xml(200, 'not xml at all'));
    await rejectsWith(searchPudo('http://pudo.test/x.asmx', SECRETS.pickupKey, '1000-001', {}), 'PICKUP_SEARCH_FAILED');
  });
});

// ---------------------------------------------------------------------------

const request = (over: Partial<CarrierShipmentRequest> = {}): CarrierShipmentRequest => ({
  ourReference: 'LB-SHP-42',
  orderReference: 'ORD-1001',
  serviceId: 'EXPRESS',
  destination: {
    firstName: 'Ana',
    lastName: 'Silva',
    line1: 'Avenida da Liberdade 100',
    line2: '3º Esq',
    postalCode: '1250096',
    city: 'Lisboa',
    country: 'PT',
    phone: '931234567',
  },
  contact: { name: 'Ana Silva', email: 'ana@example.com', phone: '+351931234567' },
  items: [{ weight: 0.25, quantity: 2 }] as any,
  weightGrams: 500,
  parcels: 1,
  ...over,
});

/** 2026-11-14 23:30 UTC is already 2026-11-15 nowhere in Portugal's winter (UTC+0). */
const clock = () => new Date('2026-11-14T23:30:00Z');

describe('dpdPortugal adapter createShipment', () => {
  const adapter = createDpdPortugalAdapter({ now: clock });

  const capture = () =>
    stubFetch(async (url) => (url.endsWith('/auth') ? json(200, TOKEN_OK) : json(200, EXPEDITION_OK)));

  it('EXPRESS: home account, sender from the config, recipient from the request', async () => {
    const f = capture();
    const result = await adapter.createShipment!(request(), rt(), { timeoutMs: 5000 });
    expect(result).toEqual({
      externalId: '09876543210123',
      trackingCode: '09876543210123',
      trackingUrl: 'https://tracking.dpd.pt/track-and-trace?reference=09876543210123',
      cost: null,
      labelAvailable: true,
      labelRef: 'https://labels.dpd.test/abc.pdf',
    });
    const body = JSON.parse(f.mock.calls[1][1].body);
    expect(body.sub_account.code).toBe('HOME-001');
    expect(body.destinatario_usar_endereco_pickup).toBe(false);
    expect(body.recipient_pickup_store.number).toBe('');
    expect(body.sender).toMatchObject({ name: 'Loja Teste', mobile: '912345678', email: 'loja@example.com' });
    expect(body.shipper).toMatchObject({ address: 'Rua do Remetente 1', zip_code: '4000-123', location: 'Porto' });
    expect(body.contact).toMatchObject({ name: 'Ana Silva', mobile: '931234567', email: 'ana@example.com' });
    expect(body.address).toMatchObject({
      country: { id: 'PT', iso2: 'PT' },
      address: 'Avenida da Liberdade 100 3º Esq',
      zip_code: '1250-096',
      location: 'Lisboa',
    });
    expect(body.encomenda_referencia).toBe('LB-SHP-42');
    expect(body.expedition_date).toBe('2026-11-14');
    expect(body.encomenda_peso_envio).toBe('0.5');
    expect(body.encomenda_num_volumes).toBe(1);
  });

  it('PICKUP: shop account and the pickup point id', async () => {
    const f = capture();
    await adapter.createShipment!(
      request({ serviceId: 'PICKUP', pickupPoint: { id: 'PT10001', name: 'Papelaria' }, parcels: 3 }),
      rt(),
      { timeoutMs: 5000 }
    );
    const body = JSON.parse(f.mock.calls[1][1].body);
    expect(body.sub_account.code).toBe('SHOP-002');
    expect(body.destinatario_usar_endereco_pickup).toBe(true);
    expect(body.recipient_pickup_store.number).toBe('PT10001');
    expect(body.encomenda_num_volumes).toBe(3);
  });

  it('falls back to the items weight and 1 parcel', async () => {
    const f = capture();
    await adapter.createShipment!(request({ weightGrams: undefined, parcels: undefined }), rt(), {
      timeoutMs: 5000,
    });
    const body = JSON.parse(f.mock.calls[1][1].body);
    expect(body.encomenda_peso_envio).toBe('0.5');
    expect(body.encomenda_num_volumes).toBe(1);
  });

  it('the date is today in Europe/Lisbon', async () => {
    const f = capture();
    const summer = createDpdPortugalAdapter({ now: () => new Date('2026-07-14T23:30:00Z') });
    await summer.createShipment!(request(), rt(), { timeoutMs: 5000 });
    expect(JSON.parse(f.mock.calls[1][1].body).expedition_date).toBe('2026-07-15');
  });

  it('PICKUP without a pickup point → PICKUP_POINT_REQUIRED, nothing sent', async () => {
    const f = capture();
    await rejectsWith(adapter.createShipment!(request({ serviceId: 'PICKUP' }), rt(), undefined), 'PICKUP_POINT_REQUIRED');
    expect(f).not.toHaveBeenCalled();
  });

  it('a missing sub-account → CARRIER_NOT_CONFIGURED, nothing sent', async () => {
    const f = capture();
    await rejectsWith(adapter.createShipment!(request(), rt({ accountHome: '' }), undefined), 'CARRIER_NOT_CONFIGURED');
    expect(f).not.toHaveBeenCalled();
  });

  it('an unknown service → NOT_SUPPORTED', async () => {
    capture();
    await rejectsWith(adapter.createShipment!(request({ serviceId: 'X' }), rt(), undefined), 'NOT_SUPPORTED');
  });

  it('has no cancelShipment and no track', () => {
    expect(dpdPortugalAdapter.cancelShipment).toBeUndefined();
    expect(dpdPortugalAdapter.track).toBeUndefined();
    expect(typeof dpdPortugalAdapter.createShipment).toBe('function');
    expect(typeof dpdPortugalAdapter.getLabel).toBe('function');
  });
});

describe('dpdPortugal adapter getLabel', () => {
  it('downloads labelRef', async () => {
    const pdf = Buffer.from('%PDF-1.4');
    const f = stubFetch(async () => ({ status: 200, ok: true, arrayBuffer: async () => pdf }) as any);
    const label = await dpdPortugalAdapter.getLabel!('0987', rt(), { timeoutMs: 5000 }, 'https://labels.dpd.test/abc.pdf');
    expect(label.filename).toBe('dpd-0987.pdf');
    expect(label.content.equals(pdf)).toBe(true);
    expect(f.mock.calls[0][0]).toBe('https://labels.dpd.test/abc.pdf');
  });

  it('without labelRef → CARRIER_REQUEST_FAILED', async () => {
    await rejectsWith(dpdPortugalAdapter.getLabel!('0987', rt(), undefined), 'CARRIER_REQUEST_FAILED');
  });
});

// ---------------------------------------------------------------------------

describe('dpd-portugal testConnection', () => {
  const test = (r: ReturnType<typeof rt>) => getProviderDefinition('dpd-portugal')!.testConnection!(r);
  const services = (pickup: boolean) => ({
    services: {
      EXPRESS: { active: true, name: {}, tax: 23, rates: {} },
      PICKUP: { active: pickup, name: {}, tax: 23, rates: {} },
    },
  });

  it('ok with a token, no pickup search when PICKUP is off', async () => {
    const f = stubFetch(async () => json(200, TOKEN_OK));
    await expect(test(rt(services(false)))).resolves.toEqual({ ok: true });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('with PICKUP on, also searches 1000-001', async () => {
    const f = stubFetch(async (url) => (url.endsWith('/auth') ? json(200, TOKEN_OK) : xml(200, TWO_PUDOS)));
    await expect(test(rt(services(true)))).resolves.toEqual({ ok: true });
    expect(f.mock.calls[1][0]).toBe('http://pudo.test/mypudo/mypudo.asmx');
    expect(f.mock.calls[1][1].body).toContain('<zipCode>1000-001</zipCode>');
  });

  it('uses the default pickup endpoint when none is set', async () => {
    const f = stubFetch(async (url) => (url.endsWith('/auth') ? json(200, TOKEN_OK) : xml(200, TWO_PUDOS)));
    await test(rt({ ...services(true), pickupEndpoint: '' }));
    expect(f.mock.calls[1][0]).toBe('http://mypudo.pickup-services.com/mypudo/mypudo.asmx');
  });

  it('a pickup ERROR fails without leaking the key', async () => {
    stubFetch(async (url) => (url.endsWith('/auth') ? json(200, TOKEN_OK) : xml(200, PUDO_ERROR)));
    const r = await test(rt(services(true)));
    expect(r.ok).toBe(false);
    expect(r.code).toBe('UNREACHABLE');
    for (const s of SECRET_VALUES) expect(JSON.stringify(r)).not.toContain(s);
  });

  it('PICKUP on without a key → MISSING_FIELDS', async () => {
    stubFetch(async () => json(200, TOKEN_OK));
    const r = await test(rt(services(true), { clientSecret: SECRETS.clientSecret, password: SECRETS.password }));
    expect(r).toMatchObject({ ok: false, code: 'MISSING_FIELDS' });
    expect(r.message).toContain('pickupKey');
  });

  it('a refused token → INVALID_CREDENTIALS without secrets', async () => {
    stubFetch(async () => json(200, { status_code: 401 }));
    const r = await test(rt(services(false)));
    expect(r.code).toBe('INVALID_CREDENTIALS');
    for (const s of SECRET_VALUES) expect(JSON.stringify(r)).not.toContain(s);
  });

  it('unreachable → UNREACHABLE', async () => {
    stubFetch(async () => {
      throw new Error(`x ${SECRETS.password}`);
    });
    const r = await test(rt(services(false)));
    expect(r.code).toBe('UNREACHABLE');
    for (const s of SECRET_VALUES) expect(JSON.stringify(r)).not.toContain(s);
  });

  it('missing credentials → MISSING_FIELDS without calling DPD', async () => {
    const f = stubFetch(async () => json(200, TOKEN_OK));
    const r = await test({ config: { ...config(), clientId: '' }, secrets: { password: 'p' } });
    expect(r).toMatchObject({ ok: false, code: 'MISSING_FIELDS' });
    expect(r.message).toContain('clientId');
    expect(r.message).toContain('clientSecret');
    expect(f).not.toHaveBeenCalled();
  });
});
