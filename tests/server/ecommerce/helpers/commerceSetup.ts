import { vi } from 'vitest';

import EcommerceOrderService from '../../../../server/src/services/modules/ecommerce/orders';
import EcommercePaymentService from '../../../../server/src/services/modules/ecommerce/payments';
import EcommerceStripePaymentService from '../../../../server/src/services/modules/ecommerce/stripePayments';
import EcommerceStripeWebhookService from '../../../../server/src/services/modules/ecommerce/stripeWebhooks';
import EcommerceOrderHistoryService from '../../../../server/src/services/modules/ecommerce/orderHistory';
import EcommerceStockService from '../../../../server/src/services/modules/ecommerce/stock';
import EcommerceCustomerService from '../../../../server/src/services/modules/ecommerce/customers';
import EcommerceStoreCreditService from '../../../../server/src/services/modules/ecommerce/storeCredits';
import EcommerceRefundService from '../../../../server/src/services/modules/ecommerce/refunds';
import EcommerceNotificationService from '../../../../server/src/services/modules/ecommerce/notifications';
import EcommerceShipmentService from '../../../../server/src/services/modules/ecommerce/shipments';
import { createEventBus } from '../../../../server/src/services/modules/ecommerce/events';
import { createFakeDb, type FakeRelations } from './fakeDb';

const P = 'plugin::littlebox-strapi-suite.ltb-st-module-ecommerce-';
export const UIDS = {
  product: `${P}product`,
  productTranslation: `${P}product-translation`,
  variant: `${P}variant`,
  variantTranslation: `${P}variant-translation`,
  image: `${P}image`,
  customer: `${P}customer`,
  order: `${P}order`,
  orderLine: `${P}order-line`,
  payment: `${P}payment`,
  stockMovement: `${P}stock-movement`,
  orderHistory: `${P}order-history`,
  stripeSession: `${P}stripe-session`,
  refund: `${P}refund`,
  storeCredit: `${P}store-credit`,
  storeCreditMovement: `${P}store-credit-movement`,
  webhookEvent: `${P}webhook-event`,
  notification: `${P}notification`,
  shipment: `${P}shipment`,
  shipmentEvent: `${P}shipment-event`,
  orderReturn: `${P}order-return`,
  invoice: `${P}invoice`,
  invoiceAllocation: `${P}invoice-allocation`,
};

const RELATIONS: FakeRelations = {
  [UIDS.product]: {
    translations: [UIDS.productTranslation, 'product'],
    variants: [UIDS.variant, 'product'],
    images: [UIDS.image, 'product'],
  },
  [UIDS.variant]: {
    translations: [UIDS.variantTranslation, 'variant'],
    images: [UIDS.image, 'variant'],
  },
  [UIDS.customer]: { orders: [UIDS.order, 'customer'] },
  [UIDS.order]: {
    lines: [UIDS.orderLine, 'order'],
    payments: [UIDS.payment, 'order'],
    history: [UIDS.orderHistory, 'order'],
    customer: [UIDS.customer, 'customer', 'manyToOne'],
  },
  [UIDS.payment]: { order: [UIDS.order, 'order', 'manyToOne'] },
  [UIDS.stripeSession]: {
    order: [UIDS.order, 'order', 'manyToOne'],
    payment: [UIDS.payment, 'payment', 'manyToOne'],
  },
  [UIDS.refund]: {
    order: [UIDS.order, 'order', 'manyToOne'],
    payment: [UIDS.payment, 'payment', 'manyToOne'],
    storeCredit: [UIDS.storeCredit, 'storeCredit', 'manyToOne'],
  },
  [UIDS.storeCredit]: {
    customer: [UIDS.customer, 'customer', 'manyToOne'],
    sourceOrder: [UIDS.order, 'sourceOrder', 'manyToOne'],
    sourceRefund: [UIDS.refund, 'sourceRefund', 'manyToOne'],
  },
  [UIDS.shipment]: { order: [UIDS.order, 'order', 'manyToOne'] },
  [UIDS.shipmentEvent]: {
    shipment: [UIDS.shipment, 'shipment', 'manyToOne'],
    order: [UIDS.order, 'order', 'manyToOne'],
  },
  [UIDS.orderReturn]: { order: [UIDS.order, 'order', 'manyToOne'] },
  [UIDS.invoice]: {
    order: [UIDS.order, 'order', 'manyToOne'],
    creditedInvoice: [UIDS.invoice, 'creditedInvoice', 'manyToOne'],
  },
  [UIDS.invoiceAllocation]: {
    invoice: [UIDS.invoice, 'invoice', 'manyToOne'],
    payment: [UIDS.payment, 'payment', 'manyToOne'],
    order: [UIDS.order, 'order', 'manyToOne'],
  },
  [UIDS.notification]: { order: [UIDS.order, 'order', 'manyToOne'] },
  [UIDS.storeCreditMovement]: {
    storeCredit: [UIDS.storeCredit, 'storeCredit', 'manyToOne'],
    order: [UIDS.order, 'order', 'manyToOne'],
    payment: [UIDS.payment, 'payment', 'manyToOne'],
    refund: [UIDS.refund, 'refund', 'manyToOne'],
  },
};

/** Full e-commerce service graph over the fake DB. Stripe is whatever the test file mocks. */
export function setupCommerce(opts: { stripeActive?: boolean; resendActive?: boolean } = {}) {
  const db = createFakeDb(Object.values(UIDS), RELATIONS, {
    enforceUnique: [
      UIDS.stockMovement,
      UIDS.order,
      UIDS.payment,
      UIDS.stripeSession,
      UIDS.refund,
      UIDS.storeCredit,
      UIDS.storeCreditMovement,
      UIDS.webhookEvent,
      UIDS.notification,
      UIDS.shipment,
      UIDS.shipmentEvent,
      UIDS.orderReturn,
      UIDS.invoice,
      UIDS.invoiceAllocation,
    ],
  });
  const services: Record<string, any> = {};
  const bus = createEventBus(() => undefined);
  const log = { warn: vi.fn(), error: vi.fn(), info: vi.fn() };
  const strapi: any = {
    log,
    db: {
      query: db.query,
      transaction: db.transaction,
      connection: (table: string) => db.connection(table),
      getConnection: (table: string) => db.connection(table),
      metadata: db.metadata,
    },
    config: { get: () => ({ uuid: { modules: { ecommerce: UIDS } } }) },
    plugin: (id: string) =>
      id === 'i18n'
        ? { service: () => ({ getDefaultLocale: async () => 'en' }) }
        : { service: (name: string) => services[name] },
  };
  services.EcommerceStockService = EcommerceStockService({ strapi });
  services.EcommerceCustomerService = EcommerceCustomerService({ strapi });
  services.EcommerceOrderHistoryService = EcommerceOrderHistoryService({ strapi });
  services.EcommerceShippingService = {
    findOption: async (_req: any, providerId: string, serviceId: string) => ({
      providerId,
      serviceId,
      name: 'Standard',
      price: 500,
      tax: 23,
    }),
  };
  services.EcommerceSettingsService = {
    getStoreSettings: async () => ({
      shippingCountries: ['PT'],
      storefrontUrl: 'https://shop.example/',
      paymentSuccessPath: '/checkout/success',
      paymentCancelPath: '/checkout/cancel',
    }),
    getRuntime: async (id: string) =>
      id === 'stripe'
        ? {
            config: {},
            secrets: { secretKey: 'sk_test_x', webhookSecret: 'whsec_test_123' },
            active: opts.stripeActive ?? true,
          }
        : id === 'resend' && opts.resendActive !== undefined
          ? {
              config: { fromEmail: 'shop@example.pt', fromName: 'Shop' },
              secrets: { apiKey: 're_test_x' },
              active: opts.resendActive,
            }
          : null,
  };
  services.EcommerceEventBus = { collector: bus.collector, subscribe: bus.subscribe };
  services.EcommerceOrderService = EcommerceOrderService({ strapi });
  services.EcommercePaymentService = EcommercePaymentService({ strapi });
  services.EcommerceStripePaymentService = EcommerceStripePaymentService({ strapi });
  services.EcommerceStripeWebhookService = EcommerceStripeWebhookService({ strapi });
  services.EcommerceStoreCreditService = EcommerceStoreCreditService({ strapi });
  services.EcommerceRefundService = EcommerceRefundService({ strapi });
  services.EcommerceShipmentService = EcommerceShipmentService({ strapi });
  services.EcommerceEmailTemplateService = {
    render: vi.fn(async (type: string, locale: string, data: Record<string, unknown>) => ({
      subject: `${type}:${locale}`,
      html: JSON.stringify(data),
    })),
  };
  services.EcommerceNotificationService = EcommerceNotificationService({ strapi });

  const t = db.tables;
  t[UIDS.product].push({ id: 1, active: true });
  t[UIDS.productTranslation].push({ id: 1, product: 1, locale: 'en', name: 'Shirt' });
  t[UIDS.variant].push({
    id: 10,
    product: 1,
    sku: 'SH-M',
    price: 2000,
    tax: 23,
    stock: 5,
    active: true,
  });

  const events: any[] = [];
  bus.subscribe('*', async (e) => {
    events.push(e);
  });
  return {
    strapi,
    db,
    services,
    orders: services.EcommerceOrderService,
    payments: services.EcommercePaymentService,
    storeCredits: services.EcommerceStoreCreditService,
    refunds: services.EcommerceRefundService,
    webhooks: services.EcommerceStripeWebhookService,
    notifications: services.EcommerceNotificationService,
    bus,
    tables: t,
    events,
    log,
  };
}

export type Commerce = ReturnType<typeof setupCommerce>;

const address = {
  firstName: 'Ana',
  lastName: 'Silva',
  line1: 'Rua A 1',
  postalCode: '1000-001',
  city: 'Lisboa',
  country: 'PT',
};

/** Total 4500: 2 × 2000 + 500 shipping. Customer `ana@example.pt`. */
export const createOrder = async (c: Commerce, email = 'Ana@Example.pt') => {
  const order = await c.orders.create(
    {
      customer: { firstName: 'Ana', lastName: 'Silva', email },
      shippingAddress: address,
      billingAddress: address,
      locale: 'en',
      lines: [{ variantId: 10, quantity: 2 }],
      shipping: { providerId: 'manual', serviceId: '1' },
    },
    { actor: 'user:1', source: 'admin' }
  );
  return order.id ?? order.order?.id;
};

export const customerIdOf = (c: Commerce, orderId: number): number =>
  c.tables[UIDS.order].find((o) => o.id === orderId).customer;
