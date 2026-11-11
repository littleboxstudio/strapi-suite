/**
 * Variable catalog and fictional sample data for every e-mail template type.
 * Pure TypeScript: no Strapi imports. Monetary values arrive pre-formatted as strings.
 */

export const EMAIL_TEMPLATE_TYPES = [
  'ORDER_CONFIRMATION',
  'PAYMENT_CONFIRMATION',
  'PAYMENT_INSTRUCTIONS',
  'SUPPLEMENTARY_PAYMENT',
  'PARTIAL_SHIPMENT',
  'FULL_SHIPMENT',
  'DELIVERY_CONFIRMATION',
  'CANCELLATION',
  'REFUND_STARTED',
  'REFUND_COMPLETED',
  'INVOICE_AVAILABLE',
  'STORE_CREDIT_ISSUED',
  'EMAIL_VERIFICATION',
] as const;

export type EmailTemplateType = (typeof EMAIL_TEMPLATE_TYPES)[number];

export type VariableDef = {
  path: string;
  description: string;
  kind: 'value' | 'list';
  itemFields?: string[];
};

const ORDER_ITEM_FIELDS = ['name', 'option', 'sku', 'quantity', 'unitPrice', 'total'];
const PROMOTION_FIELDS = ['name', 'amount'];
const SHIPMENT_ITEM_FIELDS = ['name', 'option', 'sku', 'quantity'];
const TRACKING_ITEM_FIELDS = ['carrier', 'trackingCode', 'trackingUrl'];

const value = (path: string, description: string): VariableDef => ({
  path,
  description,
  kind: 'value',
});
const list = (path: string, description: string, itemFields: string[]): VariableDef => ({
  path,
  description,
  kind: 'list',
  itemFields,
});

const STORE: VariableDef[] = [
  value('store.name', 'Store name'),
  value('store.logoUrl', 'Store logo URL'),
  value('store.brandColor', 'Store brand colour (hex)'),
  value('store.url', 'Storefront URL'),
  value('store.supportEmail', 'Support e-mail address'),
];

const CUSTOMER_EMAIL = value('customer.email', 'Customer e-mail address');

const COMMON: VariableDef[] = [
  ...STORE,
  value('customer.firstName', 'Customer first name'),
  value('customer.lastName', 'Customer last name'),
  CUSTOMER_EMAIL,
  value('order.reference', 'Order reference'),
  value('order.date', 'Order date'),
];

/** Types sent before there is an order or a customer name: only the store and the address. */
const BASE: Partial<Record<EmailTemplateType, VariableDef[]>> = {
  EMAIL_VERIFICATION: [...STORE, CUSTOMER_EMAIL],
};

const PAYMENT_REQUEST: VariableDef[] = [
  value('payment.amountDue', 'Amount due'),
  value('payment.method', 'Payment method'),
  value('payment.instructions', 'Payment instructions'),
  value('payment.link', 'Payment link'),
  value('payment.expiresAt', 'Payment deadline'),
];

const SHIPMENT: VariableDef[] = [
  list('shipment.items', 'Items in this shipment', SHIPMENT_ITEM_FIELDS),
  value('shipment.carrier', 'Carrier'),
  value('shipment.trackingCode', 'Tracking code'),
  value('shipment.trackingUrl', 'Tracking URL'),
];

const REFUND: VariableDef[] = [
  value('refund.amount', 'Refunded amount'),
  value('refund.method', 'Refund method'),
  value('refund.reference', 'Refund reference'),
  value('refund.isPartial', 'Whether the refund is partial'),
  value('refund.description', 'Refund description'),
];

const SPECIFIC: Record<EmailTemplateType, VariableDef[]> = {
  ORDER_CONFIRMATION: [
    list('order.items', 'Ordered items', ORDER_ITEM_FIELDS),
    value('order.subtotal', 'Order subtotal'),
    value('order.shipping', 'Shipping cost'),
    value('order.discount', 'Discount'),
    list(
      'order.promotions',
      'Promotions applied (customer-visible name and discount amount)',
      PROMOTION_FIELDS
    ),
    value('order.total', 'Order total'),
    value('order.paymentStatus', 'Payment status'),
    value('payment.link', 'Payment link'),
    value('payment.amountDue', 'Amount due'),
    value('payment.expiresAt', 'Payment deadline'),
  ],
  PAYMENT_CONFIRMATION: [
    value('payment.amount', 'Amount paid'),
    value('payment.method', 'Payment method'),
    value('payment.amountDue', 'Amount still due'),
  ],
  PAYMENT_INSTRUCTIONS: PAYMENT_REQUEST,
  SUPPLEMENTARY_PAYMENT: PAYMENT_REQUEST,
  PARTIAL_SHIPMENT: [
    SHIPMENT[0],
    list('shipment.pendingItems', 'Items still to be shipped', SHIPMENT_ITEM_FIELDS),
    ...SHIPMENT.slice(1),
  ],
  FULL_SHIPMENT: [
    ...SHIPMENT,
    list(
      'shipment.allTracking',
      'Tracking of every shipment of the order (only when there is more than one)',
      TRACKING_ITEM_FIELDS
    ),
  ],
  DELIVERY_CONFIRMATION: [value('delivery.date', 'Delivery date')],
  CANCELLATION: [
    value('order.cancelledAt', 'Cancellation date'),
    value('order.amountPaid', 'Amount paid'),
  ],
  REFUND_STARTED: REFUND,
  REFUND_COMPLETED: REFUND,
  INVOICE_AVAILABLE: [value('invoice.number', 'Invoice number')],
  STORE_CREDIT_ISSUED: [
    value('credit.amount', 'Credit amount'),
    value('credit.code', 'Credit code'),
    value('credit.expiresAt', 'Credit expiry date'),
    value('credit.conditions', 'Credit conditions'),
  ],
  EMAIL_VERIFICATION: [
    value('verification.code', 'Verification code'),
    value('verification.validMinutes', 'Minutes the code stays valid'),
  ],
};

const SAMPLE_VALUES: Record<string, unknown> = {
  'store.name': 'Littlebox Store',
  'store.logoUrl': 'https://shop.example.com/logo.png',
  'store.brandColor': '#1F2937',
  'store.url': 'https://shop.example.com',
  'store.supportEmail': 'support@example.com',
  'customer.firstName': 'João',
  'customer.lastName': 'Silva',
  'customer.email': 'joao.silva@example.com',
  'order.reference': 'LB-10042',
  'order.date': '11/11/2026',
  'order.items': [
    {
      name: 'Ceramic Mug',
      option: 'Blue',
      sku: 'MUG-BLU',
      quantity: 2,
      unitPrice: '12,50 €',
      total: '25,00 €',
    },
    {
      name: 'Linen Tote Bag',
      option: '',
      sku: 'TOTE-01',
      quantity: 1,
      unitPrice: '9,90 €',
      total: '9,90 €',
    },
  ],
  'order.subtotal': '34,90 €',
  'order.shipping': '4,90 €',
  'order.discount': '5,00 €',
  'order.promotions': [
    { name: 'Summer Sale', amount: '3,00 €' },
    { name: 'Free Tote Bag', amount: '2,00 €' },
  ],
  'order.total': '34,80 €',
  'order.paymentStatus': 'Pending',
  'order.cancelledAt': '12/11/2026',
  'order.amountPaid': '34,80 €',
  'payment.link': 'https://checkout.example.com/pay/cs_test_123',
  'payment.amount': '34,80 €',
  'payment.amountDue': '34,80 €',
  'payment.method': 'Multibanco',
  'payment.instructions': 'Entity 12345, reference 123 456 789',
  'payment.expiresAt': '14/11/2026',
  'shipment.items': [
    { name: 'Ceramic Mug', option: 'Blue', sku: 'MUG-BLU', quantity: 2 },
    { name: 'Linen Tote Bag', option: '', sku: 'TOTE-01', quantity: 1 },
  ],
  'shipment.pendingItems': [
    { name: 'Notebook', option: 'A5', sku: 'NOTE-A5', quantity: 1 },
    { name: 'Pencil Set', option: '', sku: 'PEN-SET', quantity: 3 },
  ],
  'shipment.carrier': 'CTT',
  'shipment.trackingCode': 'RR123456789PT',
  'shipment.trackingUrl': 'https://tracking.example.com/RR123456789PT',
  'shipment.allTracking': [
    {
      carrier: 'CTT',
      trackingCode: 'RR123456789PT',
      trackingUrl: 'https://tracking.example.com/RR123456789PT',
    },
    {
      carrier: 'DPD',
      trackingCode: '09981234567',
      trackingUrl: 'https://tracking.example.com/09981234567',
    },
  ],
  'delivery.date': '15/11/2026',
  'refund.amount': '9,90 €',
  'refund.method': 'Card',
  'refund.reference': 'RF-2001',
  'refund.isPartial': true,
  'refund.description': 'Refund for Linen Tote Bag',
  'invoice.number': 'FT 2026/123',
  'credit.amount': '10,00 €',
  'credit.code': 'CREDIT-7Q2X',
  'credit.expiresAt': '11/11/2027',
  'credit.conditions': 'Valid for one purchase on the online store.',
  'verification.code': '482913',
  'verification.validMinutes': '10',
};

export function getVariableCatalog(type: EmailTemplateType): VariableDef[] {
  return [...(BASE[type] ?? COMMON), ...SPECIFIC[type]].map((def) => ({
    ...def,
    ...(def.itemFields ? { itemFields: [...def.itemFields] } : {}),
  }));
}

export function getSampleData(type: EmailTemplateType): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const { path } of getVariableCatalog(type)) {
    const keys = path.split('.');
    let target = data;
    for (const key of keys.slice(0, -1)) {
      target[key] = (target[key] as Record<string, unknown> | undefined) ?? {};
      target = target[key] as Record<string, unknown>;
    }
    target[keys[keys.length - 1]] = structuredClone(SAMPLE_VALUES[path]);
  }
  return data;
}
