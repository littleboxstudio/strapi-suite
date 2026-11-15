import { describe, it, expect } from 'vitest';
import {
  buildExpeditionBody,
  formatPostalCode,
  formatWeightKg,
  normalizePudoItems,
  splitAddress,
  type DpdExpeditionInput,
} from '../../../../server/src/services/modules/ecommerce/providers/carriers/dpd/payload';

const input = (over: Partial<DpdExpeditionInput> = {}): DpdExpeditionInput => ({
  service: 'EXPRESS',
  subAccount: 'HOME-001',
  sender: {
    name: 'Loja Teste',
    address: 'Rua do Remetente 1',
    postalCode: '4000123',
    city: 'Porto',
    phone: '912345678',
    email: 'loja@example.com',
  },
  recipient: {
    name: 'Ana Silva',
    phone: '+351 931 234 567',
    email: 'ana@example.com',
    address: 'Avenida da Liberdade 100',
    postalCode: '1250-096',
    city: 'Lisboa',
    country: 'PT',
  },
  reference: 'LB-SHP-42',
  date: '2026-11-14',
  weightGrams: 1250,
  parcels: 2,
  ...over,
});

describe('buildExpeditionBody', () => {
  it('EXPRESS uses the home account and no pickup store', () => {
    const body = buildExpeditionBody(input()) as any;
    expect(body.sub_account).toEqual({ code: 'HOME-001' });
    expect(body.destinatario_usar_endereco_pickup).toBe(false);
    expect(body.recipient_pickup_store).toEqual({ number: '' });
  });

  it('PICKUP uses the shop account, the pudo id and the pickup_store_* fields', () => {
    const body = buildExpeditionBody(
      input({ service: 'PICKUP', subAccount: 'SHOP-002', pickupPointId: 'PT12345' })
    ) as any;
    expect(body.sub_account).toEqual({ code: 'SHOP-002' });
    expect(body.destinatario_usar_endereco_pickup).toBe(true);
    expect(body.recipient_pickup_store).toEqual({ number: 'PT12345' });
    expect(body.pickup_store_name).toBe('Ana Silva');
    expect(body.pickup_store_mobile).toBe('931234567');
    expect(body.pickup_store_mobile_code).toBe('351');
    expect(body.pickup_store_email).toBe('ana@example.com');
  });

  it('fills sender, shipper, recipient, address and contact with the DPD names', () => {
    const body = buildExpeditionBody(input()) as any;
    expect(body.sender).toMatchObject({
      name: 'Loja Teste',
      mobile: '912345678',
      mobile_code: '351',
      email: 'loja@example.com',
      save: false,
    });
    expect(body.shipper).toMatchObject({
      name: 'Loja Teste',
      address: 'Rua do Remetente 1',
      zip_code: '4000-123',
      location: 'Porto',
      country: { id: 'PT' },
    });
    expect(body.recipient).toMatchObject({ name: 'Ana Silva', save: false });
    expect(body.address).toMatchObject({
      country: { id: 'PT', iso2: 'PT' },
      address: 'Avenida da Liberdade 100',
      zip_code: '1250-096',
      location: 'Lisboa',
      save: false,
    });
    expect(body.contact).toMatchObject({
      name: 'Ana Silva',
      mobile: '931234567',
      mobile_code: '351',
      email: 'ana@example.com',
      save: false,
    });
  });

  it('fills the shipment options', () => {
    const body = buildExpeditionBody(input()) as any;
    expect(body).toMatchObject({
      encomenda_referencia: 'LB-SHP-42',
      expedition_date: '2026-11-14',
      encomenda_peso_envio: '1.25',
      encomenda_num_volumes: 2,
      opcoes_servico_enviar_a_cobranca: false,
      opcoes_servico_predict_para_entrega: false,
      etiqueta_formato: { id: 1 },
      pdf_response: true,
      zpl_response: false,
      qr_response: false,
      etiqueta_enviar_etiqueta_por_email: false,
    });
  });

  it('cuts names at 64 characters', () => {
    const long = 'N'.repeat(80);
    const body = buildExpeditionBody(
      input({ recipient: { ...input().recipient, name: long } })
    ) as any;
    expect(body.recipient.name).toHaveLength(64);
    expect(body.contact.name).toHaveLength(64);
  });

  it('splits a 70-character recipient address 32/32', () => {
    const address = 'A'.repeat(32) + 'B'.repeat(32) + 'C'.repeat(6);
    const body = buildExpeditionBody(
      input({ recipient: { ...input().recipient, address } })
    ) as any;
    expect(body.address.address).toBe(`${'A'.repeat(32)} ${'B'.repeat(32)}`);
  });
});

describe('formatWeightKg', () => {
  it('250 g → "0.25"', () => expect(formatWeightKg(250)).toBe('0.25'));
  it('20 g → "0.1" (minimum)', () => expect(formatWeightKg(20)).toBe('0.1'));
  it('0 or invalid → "0.1"', () => {
    expect(formatWeightKg(0)).toBe('0.1');
    expect(formatWeightKg(Number.NaN)).toBe('0.1');
  });
  it('keeps up to 3 decimals', () => expect(formatWeightKg(1234.6)).toBe('1.235'));
});

describe('splitAddress', () => {
  it('splits into two 32-character parts', () => {
    const s = 'A'.repeat(32) + 'B'.repeat(32) + 'C'.repeat(6);
    expect(splitAddress(s)).toEqual(['A'.repeat(32), 'B'.repeat(32)]);
  });
  it('drops an empty 2nd part', () => expect(splitAddress('Rua 1')).toEqual(['Rua 1']));
});

describe('formatPostalCode', () => {
  it('1000001 → 1000-001', () => expect(formatPostalCode('1000001')).toBe('1000-001'));
  it('keeps a formatted code', () => expect(formatPostalCode(' 1000-001 ')).toBe('1000-001'));
  it('leaves other lengths alone', () => expect(formatPostalCode('28001')).toBe('28001'));
});

describe('normalizePudoItems', () => {
  const items = [
    {
      PUDO_ID: 'PT10001',
      NAME: 'Papelaria Central',
      ADDRESS1: 'Rua Augusta',
      ADDRESS2: '',
      STREETNUM: '10',
      ZIPCODE: '1100053',
      CITY: 'Lisboa',
      OPENING_HOURS_ITEMS: {
        OPENING_HOURS_ITEM: [
          { DAY_ID: '1', START_TM: '09:00', END_TM: '13:00' },
          { DAY_ID: '1', START_TM: '14:00', END_TM: '19:00' },
        ],
      },
    },
    {
      PUDO_ID: 'PT10002',
      NAME: 'Café da Esquina',
      ADDRESS1: 'Praça do Comércio',
      ADDRESS2: 'Loja B',
      STREETNUM: '',
      ZIPCODE: '1100-148',
      CITY: 'Lisboa',
      OPENING_HOURS_ITEMS: { OPENING_HOURS_ITEM: { DAY_ID: '6', START_TM: '10:00', END_TM: '12:00' } },
    },
  ];

  it('normalizes items with opening hours', () => {
    expect(normalizePudoItems({ PUDO_ITEM: items })).toEqual([
      {
        id: 'PT10001',
        name: 'Papelaria Central',
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

  it('accepts an array or a single item, skips items without an id', () => {
    expect(normalizePudoItems(items)).toHaveLength(2);
    expect(normalizePudoItems(items[0])).toHaveLength(1);
    expect(normalizePudoItems([{ NAME: 'x' }, ...items])).toHaveLength(2);
    expect(normalizePudoItems(null)).toEqual([]);
    expect(normalizePudoItems('')).toEqual([]);
  });
});
