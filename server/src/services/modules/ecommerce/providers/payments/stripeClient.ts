import { createHmac, timingSafeEqual } from 'node:crypto';
import type { ProviderRuntime } from '../registry';
import { str, timedFetch } from '../http';
import { EcommercePaymentError } from '../../errors';

const BASE_URL = 'https://api.stripe.com/v1';
const STRIPE_VERSION = '2024-06-20';
const TIMEOUT_MS = 15000;

/** Form-encodes nested objects/arrays as `a[b][0][c]=v`. null/undefined values are skipped. */
export function encodeForm(data: Record<string, unknown>): string {
  const params = new URLSearchParams();
  const walk = (key: string, value: unknown) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) value.forEach((v, i) => walk(`${key}[${i}]`, v));
    else if (typeof value === 'object') {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) walk(`${key}[${k}]`, v);
    } else params.append(key, String(value));
  };
  for (const [k, v] of Object.entries(data)) walk(k, v);
  return params.toString();
}

type StripeResponse = { status: number; body: any };

export type CheckoutSessionParams = {
  amount: number;
  currency: 'EUR';
  description: string;
  customerEmail?: string;
  successUrl: string;
  cancelUrl: string;
  expiresAt: number;
  metadata: Record<string, string>;
  idempotencyKey: string;
};

export type RefundStatus = 'pending' | 'succeeded' | 'failed' | 'canceled' | 'requires_action';

export function createStripeClient(rt: ProviderRuntime) {
  async function request(
    method: 'GET' | 'POST',
    path: string,
    form?: Record<string, unknown>,
    idempotencyKey?: string
  ): Promise<StripeResponse> {
    const secretKey = str(rt, 'secretKey');
    if (!secretKey) throw new EcommercePaymentError('STRIPE_NOT_CONFIGURED', 'Stripe is not configured.');
    const headers: Record<string, string> = {
      Authorization: `Bearer ${secretKey}`,
      'Stripe-Version': STRIPE_VERSION,
    };
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    const init: RequestInit = { method, headers };
    if (form) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      init.body = encodeForm(form);
    }
    const res = await timedFetch<StripeResponse>(
      `${BASE_URL}${path}`,
      init,
      async (r) => ({ status: r.status, body: await r.json().catch(() => null) }),
      TIMEOUT_MS
    );
    if (!res) throw new EcommercePaymentError('STRIPE_UNREACHABLE', 'Could not reach Stripe.');
    return res;
  }

  /** Error message never echoes Stripe's response (it may quote the key). */
  const failed = (status: number) =>
    new EcommercePaymentError('STRIPE_REQUEST_FAILED', `Stripe rejected the request (HTTP ${status}).`);

  async function ok(p: Promise<StripeResponse>): Promise<any> {
    const res = await p;
    if (res.status < 200 || res.status >= 300 || !res.body) throw failed(res.status);
    return res.body;
  }

  async function retrieveCheckoutSession(id: string) {
    const b = await ok(request('GET', `/checkout/sessions/${encodeURIComponent(id)}`));
    return {
      id: b.id as string,
      status: b.status as 'open' | 'complete' | 'expired',
      paymentStatus: b.payment_status as 'paid' | 'unpaid' | 'no_payment_required',
      paymentIntentId: typeof b.payment_intent === 'string' ? (b.payment_intent as string) : null,
      amountTotal: (b.amount_total ?? null) as number | null,
      metadata: (b.metadata ?? {}) as Record<string, string>,
    };
  }

  return {
    async createCheckoutSession(p: CheckoutSessionParams) {
      const form: Record<string, unknown> = {
        mode: 'payment',
        success_url: p.successUrl,
        cancel_url: p.cancelUrl,
        expires_at: p.expiresAt,
        customer_email: p.customerEmail,
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: p.currency.toLowerCase(),
              unit_amount: p.amount,
              product_data: { name: p.description },
            },
          },
        ],
        metadata: p.metadata,
        // Copied to the PaymentIntent so refunds and charge events carry the same references.
        payment_intent_data: { metadata: p.metadata },
      };
      const b = await ok(request('POST', '/checkout/sessions', form, p.idempotencyKey));
      return {
        id: b.id as string,
        url: b.url as string,
        status: b.status as string,
        expiresAt: b.expires_at as number,
        paymentIntentId: typeof b.payment_intent === 'string' ? (b.payment_intent as string) : null,
      };
    },

    retrieveCheckoutSession,

    /**
     * Expires an open session and returns the resulting status. Stripe answers 400 when the
     * session is no longer open: its current status (`expired` or `complete`) is then read
     * back, so a session paid in the meantime is never mistaken for an expired one.
     */
    async expireCheckoutSession(id: string): Promise<'expired' | 'complete'> {
      const res = await request('POST', `/checkout/sessions/${encodeURIComponent(id)}/expire`, {});
      if (res.status >= 200 && res.status < 300 && res.body) {
        const status = res.body.status as string;
        if (status === 'expired' || status === 'complete') return status;
        throw failed(res.status);
      }
      if (res.status === 400) {
        const current = await retrieveCheckoutSession(id);
        if (current.status === 'expired' || current.status === 'complete') return current.status;
      }
      throw failed(res.status);
    },

    async createRefund(p: {
      paymentIntentId: string;
      amount: number;
      idempotencyKey: string;
      metadata: Record<string, string>;
    }) {
      const b = await ok(
        request(
          'POST',
          '/refunds',
          { payment_intent: p.paymentIntentId, amount: p.amount, metadata: p.metadata },
          p.idempotencyKey
        )
      );
      return { id: b.id as string, status: b.status as RefundStatus };
    },
  };
}

/** Verifies a `Stripe-Signature` header (`t=…,v1=…[,v1=…]`) against the raw request body. */
export function verifyStripeSignature(
  rawBody: Buffer,
  header: string,
  secret: string,
  nowSec: number = Date.now() / 1000,
  toleranceSec: number = 300
): boolean {
  if (!header || !secret) return false;
  let t = '';
  const sigs: string[] = [];
  for (const part of header.split(',')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k === 't') t = v;
    else if (k === 'v1') sigs.push(v);
  }
  const ts = Number(t);
  if (!t || !Number.isFinite(ts) || sigs.length === 0) return false;
  if (Math.abs(nowSec - ts) > toleranceSec) return false;
  const expected = createHmac('sha256', secret).update(`${t}.`).update(rawBody).digest();
  return sigs.some((s) => {
    if (!/^[0-9a-f]+$/i.test(s) || s.length !== expected.length * 2) return false;
    return timingSafeEqual(Buffer.from(s, 'hex'), expected);
  });
}

export type StripeClient = ReturnType<typeof createStripeClient>;
export type RetrievedCheckoutSession = Awaited<ReturnType<StripeClient['retrieveCheckoutSession']>>;
