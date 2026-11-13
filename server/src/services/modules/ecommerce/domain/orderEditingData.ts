import { readShippingLines, type ShippingLine } from './shippingLines';
import { readManualDiscounts, type ManualDiscount } from './manualDiscounts';
import { readReviewFlags, type ReviewFlag } from './orderEditing';

/** What the three order-editing columns hold for an order created before they existed. */
export function legacyEditingData(order: any): {
  shippingLines: { lines: ShippingLine[] };
  manualDiscounts: { items: ManualDiscount[] };
  reviewFlags: { flags: ReviewFlag[] };
} {
  return {
    shippingLines: { lines: readShippingLines(order) },
    manualDiscounts: { items: readManualDiscounts(order) },
    reviewFlags: { flags: readReviewFlags(order.reviewFlags) },
  };
}
