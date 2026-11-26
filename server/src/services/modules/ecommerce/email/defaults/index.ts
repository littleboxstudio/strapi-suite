import type { EmailTemplateType } from '../catalog';
import orderConfirmation from './orderConfirmation';
import paymentConfirmation from './paymentConfirmation';
import paymentInstructions from './paymentInstructions';
import supplementaryPayment from './supplementaryPayment';
import partialShipment from './partialShipment';
import fullShipment from './fullShipment';
import trackingUpdated from './trackingUpdated';
import readyForPickup from './readyForPickup';
import deliveryConfirmation from './deliveryConfirmation';
import cancellation from './cancellation';
import refundStarted from './refundStarted';
import refundCompleted from './refundCompleted';
import invoiceAvailable from './invoiceAvailable';
import creditNoteIssued from './creditNoteIssued';
import storeCreditIssued from './storeCreditIssued';
import storeCreditUpdated from './storeCreditUpdated';
import emailVerification from './emailVerification';
import * as accountVerification from './accountVerification';
import * as passwordReset from './passwordReset';
import * as passwordChanged from './passwordChanged';
import * as emailChangeVerification from './emailChangeVerification';
import * as emailChanged from './emailChanged';
import * as registrationAttempt from './registrationAttempt';

export type DefaultTemplate = { subject: string; html: string };

/** Built-in English templates, used when a locale has no customization. */
export const DEFAULT_TEMPLATES: Record<EmailTemplateType, DefaultTemplate> = {
  ORDER_CONFIRMATION: orderConfirmation,
  PAYMENT_CONFIRMATION: paymentConfirmation,
  PAYMENT_INSTRUCTIONS: paymentInstructions,
  SUPPLEMENTARY_PAYMENT: supplementaryPayment,
  PARTIAL_SHIPMENT: partialShipment,
  FULL_SHIPMENT: fullShipment,
  TRACKING_UPDATED: trackingUpdated,
  READY_FOR_PICKUP: readyForPickup,
  DELIVERY_CONFIRMATION: deliveryConfirmation,
  CANCELLATION: cancellation,
  REFUND_STARTED: refundStarted,
  REFUND_COMPLETED: refundCompleted,
  INVOICE_AVAILABLE: invoiceAvailable,
  CREDIT_NOTE_ISSUED: creditNoteIssued,
  STORE_CREDIT_ISSUED: storeCreditIssued,
  STORE_CREDIT_UPDATED: storeCreditUpdated,
  EMAIL_VERIFICATION: emailVerification,
  ACCOUNT_VERIFICATION: accountVerification.en,
  PASSWORD_RESET: passwordReset.en,
  PASSWORD_CHANGED: passwordChanged.en,
  EMAIL_CHANGE_VERIFICATION: emailChangeVerification.en,
  EMAIL_CHANGED: emailChanged.en,
  REGISTRATION_ATTEMPT: registrationAttempt.en,
};

/** Built-in Portuguese (pt-PT) templates; types without one fall back to English. */
const PT_TEMPLATES: Partial<Record<EmailTemplateType, DefaultTemplate>> = {
  ACCOUNT_VERIFICATION: accountVerification.pt,
  PASSWORD_RESET: passwordReset.pt,
  PASSWORD_CHANGED: passwordChanged.pt,
  EMAIL_CHANGE_VERIFICATION: emailChangeVerification.pt,
  EMAIL_CHANGED: emailChanged.pt,
  REGISTRATION_ATTEMPT: registrationAttempt.pt,
};

/** The built-in template for a locale code (`pt`, `pt-PT`…): Portuguese when available, else English. */
export const defaultTemplate = (type: EmailTemplateType, locale: string | null | undefined): DefaultTemplate =>
  (/^pt(-|_|$)/i.test(locale ?? '') ? PT_TEMPLATES[type] : undefined) ?? DEFAULT_TEMPLATES[type];
