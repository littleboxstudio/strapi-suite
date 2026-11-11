import { describe, it, expect, vi } from 'vitest';
import { EcommerceValidationError } from '../../../server/src/services/modules/ecommerce/errors';
import { handleDomainError } from '../../../server/src/controllers/modules/ecommerce/errors';

const mkCtx = (): any => ({ badRequest: vi.fn(), notFound: vi.fn(), status: 200, body: undefined });
const labels = { invalid: 'Invalid', notFound: 'Not found' };

describe('handleDomainError (promotions)', () => {
  for (const code of [
    'PROMOTION_UNAVAILABLE',
    'STORE_CREDIT_INSUFFICIENT',
    'TOTAL_CHANGED',
    'PROMOTION_IN_USE',
    'PROMOTION_VERSION_CONFLICT',
  ]) {
    it(`${code} gives 409`, () => {
      const ctx = mkCtx();
      const errors = [{ path: 'promotions.1', code, detail: 'X' }];
      handleDomainError(ctx, new EcommerceValidationError('x', errors), labels);
      expect(ctx.status).toBe(409);
      expect(ctx.body.error.details).toEqual({ code, errors });
      expect(ctx.badRequest).not.toHaveBeenCalled();
    });
  }

  it('code_taken stays 400', () => {
    const ctx = mkCtx();
    handleDomainError(ctx, new EcommerceValidationError('x', [{ path: 'code', code: 'code_taken' }]), labels);
    expect(ctx.badRequest).toHaveBeenCalled();
    expect(ctx.status).toBe(200);
  });
});
