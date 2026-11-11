import EcommercePromotionService from '../../../../server/src/services/modules/ecommerce/promotions';
import type { FakeRelations } from './fakeDb';

const P = 'plugin::littlebox-strapi-suite.ltb-st-module-ecommerce-';

/** The promotion tables the order service reads (create, cancel, get). */
export const PROMOTION_UIDS = {
  promotion: `${P}promotion`,
  promotionRedemption: `${P}promotion-redemption`,
  promotionCustomerUsage: `${P}promotion-customer-usage`,
};

export const promotionRelations = (uids: { order: string; customer: string }): FakeRelations => ({
  [PROMOTION_UIDS.promotionRedemption]: {
    promotion: [PROMOTION_UIDS.promotion, 'promotion', 'manyToOne'],
    order: [uids.order, 'order', 'manyToOne'],
    customer: [uids.customer, 'customer', 'manyToOne'],
  },
  [PROMOTION_UIDS.promotionCustomerUsage]: {
    promotion: [PROMOTION_UIDS.promotion, 'promotion', 'manyToOne'],
  },
});

/** Registers the real promotion service on a local strapi fake. */
export const registerPromotionService = (strapi: any, services: Record<string, any>) => {
  services.EcommercePromotionService = EcommercePromotionService({ strapi });
};
