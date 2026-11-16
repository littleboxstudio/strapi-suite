import { describe, it, expect } from 'vitest';
import { lineDiscountLabel } from '../../../admin/src/ecommerce/utils/orderDetail';
import type { OrderLine } from '../../../admin/src/ecommerce/orderTypes';

const promotions = [
  { promotionId: 1, name: 'Internal A', displayName: { pt: 'Verão', en: 'Summer' } },
  { promotionId: 2, name: 'Internal B' },
] as never[];
const line = (over: Partial<OrderLine>) =>
  ({ promotionIds: [], manualDiscountPercent: null, ...over }) as OrderLine;

describe('lineDiscountLabel', () => {
  it('names the promotions of the line, joined', () => {
    expect(lineDiscountLabel(line({ promotionIds: [1, 2] }), promotions, 'pt')).toBe('Verão, Internal B');
    expect(lineDiscountLabel(line({ promotionIds: [1] }), promotions, 'en')).toBe('Summer');
  });
  it('names the manual discount with the locale decimal separator', () => {
    expect(lineDiscountLabel(line({ manualDiscountPercent: 12.5 }), promotions, 'pt')).toBe(
      'Desconto manual −12,5 %'
    );
    expect(lineDiscountLabel(line({ manualDiscountPercent: 10 }), promotions, 'en')).toBe(
      'Manual discount −10 %'
    );
  });
  it('is null without a discount', () => {
    expect(lineDiscountLabel(line({}), promotions, 'en')).toBeNull();
    expect(lineDiscountLabel(line({ promotionIds: [99] }), promotions, 'en')).toBeNull();
  });
});
