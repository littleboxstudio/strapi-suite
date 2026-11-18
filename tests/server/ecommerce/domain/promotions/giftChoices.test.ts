import { describe, it, expect } from 'vitest';
import {
  giftChoiceAt,
  MAX_GIFT_CHOICE_ITEMS,
  parseGiftChoice,
} from '../../../../../server/src/services/modules/ecommerce/domain/promotions/giftChoices';
import { giftsInOrder } from '../../../../../server/src/services/modules/ecommerce/orderPricing';

describe('gift choices', () => {
  it('a choice is one positive id or a non-empty list of them', () => {
    expect(parseGiftChoice(7)).toBe(7);
    expect(parseGiftChoice([7, 8, 7])).toEqual([7, 8, 7]);
    for (const bad of [0, -1, 1.5, '7', null, undefined, [], [7, 0], [7, '8'], {}, Array(MAX_GIFT_CHOICE_ITEMS + 1).fill(1)]) {
      expect(parseGiftChoice(bad)).toBeNull();
    }
    expect(parseGiftChoice(Array(MAX_GIFT_CHOICE_ITEMS).fill(1))).toHaveLength(MAX_GIFT_CHOICE_ITEMS);
  });

  it('a single id applies to every gift; a list to its own position', () => {
    expect(giftChoiceAt(7, 0)).toBe(7);
    expect(giftChoiceAt(7, 5)).toBe(7);
    expect(giftChoiceAt([7, 8], 1)).toBe(8);
    expect(giftChoiceAt([7, 8], 2)).toBeUndefined();
    expect(giftChoiceAt(undefined, 0)).toBeUndefined();
  });

  it('giftsInOrder lists each gift, the wished variant at its position when it was given', () => {
    const lines = [
      { variantId: 20, quantity: 2 },
      { variantId: 21, quantity: 2 },
    ];
    // quantity 2 per gift: one gift of 20, one of 21.
    expect(giftsInOrder(lines, 2, [20, 21], [21, 20])).toEqual([21, 20]);
    expect(giftsInOrder(lines, 2, [20, 21], undefined)).toEqual([20, 21]);
    expect(giftsInOrder([{ variantId: 21, quantity: 3 }], 1, [20, 21], 20)).toEqual([21, 21, 21]);
    expect(giftsInOrder([], 1, [20], 20)).toEqual([]);
  });
});
