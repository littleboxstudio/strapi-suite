import { describe, it, expect, vi } from 'vitest';
import {
  EcommerceBillingError,
  EcommerceCarrierError,
  EcommerceValidationError,
} from '../../../server/src/services/modules/ecommerce/errors';
import { handleDomainError } from '../../../server/src/controllers/modules/ecommerce/errors';

const mkCtx = (): any => ({ badRequest: vi.fn(), notFound: vi.fn(), status: 200, body: undefined });
const labels = { invalid: 'Invalid', notFound: 'Not found' };

describe('handleDomainError (fulfillment)', () => {
  it('maps carrier and billing errors to 400 with the code only', () => {
    for (const err of [
      new EcommerceCarrierError('TIMEOUT'),
      new EcommerceBillingError('BILLING_NOT_CONFIGURED'),
    ]) {
      const ctx = mkCtx();
      handleDomainError(ctx, err, labels);
      expect(ctx.badRequest).toHaveBeenCalledWith(err.code, { code: err.code });
    }
  });

  it('defaults the message to the code and keeps the uncertain flag', () => {
    const e = new EcommerceBillingError('BILLING_REQUEST_FAILED', undefined, true);
    expect(e.message).toBe('BILLING_REQUEST_FAILED');
    expect(e.uncertain).toBe(true);
    expect(new EcommerceCarrierError('NOT_IMPLEMENTED').uncertain).toBe(false);
  });

  it('inspects every code: a conflict code in second place gives 409', () => {
    const ctx = mkCtx();
    handleDomainError(
      ctx,
      new EcommerceValidationError('x', [
        { path: 'a', code: 'REQUIRED' },
        { path: 'b', code: 'QUANTITY_EXCEEDS_PENDING' },
      ]),
      labels
    );
    expect(ctx.status).toBe(409);
    expect(ctx.body.error.details.code).toBe('QUANTITY_EXCEEDS_PENDING');
    expect(ctx.badRequest).not.toHaveBeenCalled();
  });

  it.each([
    'PAYMENT_NOT_INVOICEABLE', 'ALREADY_DELIVERED', 'SHIPMENT_PENDING', 'SHIPMENT_UNCERTAIN', 'SHIPMENT_HAS_RETURNS',
    'ORDER_CHANGED', 'SHIPMENT_STATE_CHANGED',
  ])('%s gives 409', (code) => {
    const ctx = mkCtx();
    handleDomainError(ctx, new EcommerceValidationError('x', [{ path: 'a', code }]), labels);
    expect(ctx.status).toBe(409);
  });

  it('non-conflict validation errors stay 400', () => {
    const ctx = mkCtx();
    handleDomainError(ctx, new EcommerceValidationError('x', [{ path: 'a', code: 'REQUIRED' }]), labels);
    expect(ctx.badRequest).toHaveBeenCalledWith('Invalid', { errors: [{ path: 'a', code: 'REQUIRED' }] });
  });
});
