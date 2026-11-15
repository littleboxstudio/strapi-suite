import type { DpdServiceId } from '../../../domain/dpdServices';

/**
 * Pure builders for the DPD Portugal API (spec 2). The field names are DPD's, copied from the
 * working integration the spec cites; the null fields are sent as it sent them.
 */

const MOBILE_CODE = '351';
const NAME_MAX = 64;
const ADDRESS_PART = 32;

export type DpdExpeditionInput = {
  service: DpdServiceId;
  subAccount: string;
  sender: { name: string; address: string; postalCode: string; city: string; phone: string; email: string };
  recipient: {
    name: string;
    phone?: string;
    email: string;
    address: string;
    postalCode: string;
    city: string;
    country: string;
  };
  /** PICKUP only: the PUDO id. */
  pickupPointId?: string;
  /** `LB-SHP-<id>` */
  reference: string;
  /** yyyy-MM-dd */
  date: string;
  weightGrams: number;
  parcels: number;
};

export type PickupPoint = {
  id: string;
  name: string;
  address: string;
  address2: string | null;
  postalCode: string;
  city: string;
  country: 'PT';
  openingHours: { day: number; from: string; to: string }[];
};

const text = (v: unknown): string =>
  typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : typeof v === 'number' ? String(v) : '';

const cut = (v: unknown, max: number) => text(v).slice(0, max).trim();

/** `encomenda_peso_envio`: kg with up to 3 decimals and a dot, at least 0.1 (Ruling 14). */
export function formatWeightKg(grams: number): string {
  const kg = Number.isFinite(grams) && grams > 0 ? grams / 1000 : 0;
  return String(Number(Math.max(0.1, kg).toFixed(3)));
}

/** `NNNN-NNN` when the code has 7 digits; otherwise trimmed as given (Ruling 15). */
export function formatPostalCode(postalCode: string): string {
  const value = text(postalCode);
  const digits = value.replace(/\D/g, '');
  return digits.length === 7 ? `${digits.slice(0, 4)}-${digits.slice(4)}` : value;
}

/** Two 32-character parts; the 2nd is dropped when empty (Ruling 15). */
export function splitAddress(address: string): string[] {
  const value = text(address);
  return [value.slice(0, ADDRESS_PART).trim(), value.slice(ADDRESS_PART, ADDRESS_PART * 2).trim()].filter(
    (part, i) => i === 0 || part !== ''
  );
}

/** National number for `mobile` (with `mobile_code` 351): digits only, without a 351/00351 prefix. */
export function mobileNumber(phone: string | undefined): string {
  const raw = text(phone);
  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('00351')) digits = digits.slice(5);
  else if ((raw.startsWith('+351') || digits.length === 12) && digits.startsWith('351')) digits = digits.slice(3);
  return digits;
}

/** The DPD expedition body (spec 2.1): EXPRESS to the address, PICKUP to `pickupPointId`. */
export function buildExpeditionBody(input: DpdExpeditionInput): Record<string, unknown> {
  const pickup = input.service === 'PICKUP';
  const { sender, recipient } = input;
  const senderName = cut(sender.name, NAME_MAX);
  const recipientName = cut(recipient.name, NAME_MAX);
  const recipientMobile = mobileNumber(recipient.phone);
  const recipientEmail = text(recipient.email);
  const country = text(recipient.country).toUpperCase();
  return {
    sub_account: { code: text(input.subAccount) },
    sender: {
      id: null,
      name: senderName,
      phone: null,
      phone_code: null,
      mobile: mobileNumber(sender.phone),
      mobile_code: MOBILE_CODE,
      email: text(sender.email),
      save: false,
    },
    shipper: {
      id: null,
      name: senderName,
      address: splitAddress(sender.address).join(' '),
      zip_code: formatPostalCode(sender.postalCode),
      location: text(sender.city),
      country: { id: 'PT' },
    },
    recipient: { id: null, name: recipientName, client_code: null, save: false },
    address: {
      id: null,
      country: { id: country, iso2: country },
      address: splitAddress(recipient.address).join(' '),
      zip_code: formatPostalCode(recipient.postalCode),
      location: text(recipient.city),
      save: false,
    },
    contact: {
      id: null,
      name: recipientName,
      phone: null,
      phone_code: null,
      mobile: recipientMobile,
      mobile_code: MOBILE_CODE,
      email: recipientEmail,
      save: false,
    },
    destinatario_usar_endereco_pickup: pickup,
    recipient_pickup_store: { number: pickup ? text(input.pickupPointId) : '' },
    pickup_store_name: recipientName,
    pickup_store_mobile: recipientMobile,
    pickup_store_mobile_code: MOBILE_CODE,
    pickup_store_email: recipientEmail,
    opcoes_servico_predict_para_entrega: false,
    encomenda_referencia: text(input.reference),
    opcoes_servico_codigo_at: null,
    encomenda_observacao: null,
    expedition_date: input.date,
    expedition_time: null,
    encomenda_peso_envio: formatWeightKg(input.weightGrams),
    encomenda_num_volumes: input.parcels,
    opcoes_servico_enviar_a_cobranca: false,
    opcoes_servico_montante: null,
    etiqueta_hide_nome: false,
    etiqueta_hide_telemovel: false,
    etiqueta_hide_email: false,
    etiqueta_formato: { id: 1 },
    etiqueta_enviar_etiqueta_por_email: false,
    zpl_response: false,
    pdf_response: true,
    qr_response: false,
  };
}

// ---------------------------------------------------------------------------
// Pickup points
// ---------------------------------------------------------------------------

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : v === undefined || v === null || v === '' ? [] : [v]);

const hours = (raw: unknown): PickupPoint['openingHours'] => {
  const container = isRecord(raw) ? raw.OPENING_HOURS_ITEM : raw;
  const result: PickupPoint['openingHours'] = [];
  for (const h of list(container)) {
    if (!isRecord(h)) continue;
    const day = Number(text(h.DAY_ID));
    const from = text(h.START_TM);
    const to = text(h.END_TM);
    if (!Number.isInteger(day) || !from || !to) continue;
    result.push({ day, from, to });
  }
  return result;
};

/**
 * `PUDO_ITEMS` contents (`{ PUDO_ITEM }`), a list of items or one item → pickup points. Items
 * without `PUDO_ID` are skipped. `STREETNUM` is appended to `ADDRESS1` when it is not already in it.
 */
export function normalizePudoItems(raw: unknown): PickupPoint[] {
  const items = isRecord(raw) && 'PUDO_ITEM' in raw ? list(raw.PUDO_ITEM) : list(raw);
  const points: PickupPoint[] = [];
  for (const item of items) {
    if (!isRecord(item)) continue;
    const id = text(item.PUDO_ID);
    if (!id) continue;
    const street = text(item.ADDRESS1);
    const number = text(item.STREETNUM);
    const address = number && !street.includes(number) ? `${street} ${number}`.trim() : street;
    points.push({
      id,
      name: text(item.NAME),
      address,
      address2: text(item.ADDRESS2) || null,
      postalCode: formatPostalCode(text(item.ZIPCODE)),
      city: text(item.CITY),
      country: 'PT',
      openingHours: hours(item.OPENING_HOURS_ITEMS),
    });
  }
  return points;
}
