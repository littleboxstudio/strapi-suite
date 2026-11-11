import type { EmailTemplateType } from '../catalog';
import orderConfirmation from './orderConfirmation';
import paymentConfirmation from './paymentConfirmation';
import paymentInstructions from './paymentInstructions';
import supplementaryPayment from './supplementaryPayment';
import partialShipment from './partialShipment';
import fullShipment from './fullShipment';
import deliveryConfirmation from './deliveryConfirmation';
import cancellation from './cancellation';
import refundStarted from './refundStarted';
import refundCompleted from './refundCompleted';
import invoiceAvailable from './invoiceAvailable';
import storeCreditIssued from './storeCreditIssued';
import emailVerification from './emailVerification';

export type DefaultTemplate = { subject: string; html: string };

/** Built-in English templates, used when a locale has no customization. */
export const DEFAULT_TEMPLATES: Record<EmailTemplateType, DefaultTemplate> = {
  ORDER_CONFIRMATION: orderConfirmation,
  PAYMENT_CONFIRMATION: paymentConfirmation,
  PAYMENT_INSTRUCTIONS: paymentInstructions,
  SUPPLEMENTARY_PAYMENT: supplementaryPayment,
  PARTIAL_SHIPMENT: partialShipment,
  FULL_SHIPMENT: fullShipment,
  DELIVERY_CONFIRMATION: deliveryConfirmation,
  CANCELLATION: cancellation,
  REFUND_STARTED: refundStarted,
  REFUND_COMPLETED: refundCompleted,
  INVOICE_AVAILABLE: invoiceAvailable,
  STORE_CREDIT_ISSUED: storeCreditIssued,
  EMAIL_VERIFICATION: emailVerification,
};
