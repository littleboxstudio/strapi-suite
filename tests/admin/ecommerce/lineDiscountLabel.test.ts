import { describe, it, expect } from 'vitest';
import { lineDiscountLabel } from '../../../admin/src/ecommerce/utils/orderDetail';
import type { OrderLine } from '../../../admin/src/ecommerce/orderTypes';

const promotions = [
  { promotionId: 1, name: 'Internal A', displayName: { pt: 'Verão', en: 'Summer' } },
  { promotionId: 2, name: 'Internal B' },
] as never[];
const manual = (locale: string) => (percent: string) =>
  `${locale === 'pt' ? 'Desconto manual' : 'Manual discount'} ${percent}`;
const line = (over: Partial<OrderLine>) =>
  ({ promotionIds: [], manualDiscountPercent: null, ...over }) as OrderLine;

describe('lineDiscountLabel', () => {
  it('names the promotions of the line, joined', () => {
    expect(lineDiscountLabel(line({ promotionIds: [1, 2] }), promotions, 'pt', manual('pt'))).toBe(
      'Verão, Internal B'
    );
    expect(lineDiscountLabel(line({ promotionIds: [1] }), promotions, 'en', manual('en'))).toBe(
      'Summer'
    );
  });
  it('names the manual discount with the locale decimal separator', () => {
    expect(
      lineDiscountLabel(line({ manualDiscountPercent: 12.5 }), promotions, 'pt', manual('pt'))
    ).toBe('Desconto manual −12,5 %');
    expect(
      lineDiscountLabel(line({ manualDiscountPercent: 10 }), promotions, 'en', manual('en'))
    ).toBe('Manual discount −10 %');
  });
  it('shows both, promotion names first then the manual label', () => {
    expect(
      lineDiscountLabel(
        line({ promotionIds: [1], manualDiscountPercent: 10 }),
        promotions,
        'en',
        manual('en')
      )
    ).toBe('Summer, Manual discount \u221210 %');
  });
  it('is null without a discount', () => {
    expect(lineDiscountLabel(line({}), promotions, 'en', manual('en'))).toBeNull();
    expect(
      lineDiscountLabel(line({ promotionIds: [99] }), promotions, 'en', manual('en'))
    ).toBeNull();
  });
});
