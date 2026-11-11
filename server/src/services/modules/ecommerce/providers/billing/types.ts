import type { InvoiceCustomer, InvoiceLine } from '../../domain/invoicing';
import type { ProviderRuntime } from '../registry';

export type { InvoiceCustomer, InvoiceLine };

/** What the invoicing service asks a billing provider to issue. Money in cents, VAT included. */
export type InvoiceDraft = {
  kind: 'INVOICE' | 'CREDIT_NOTE';
  /** LB-INV-<invoiceId>: the reconciliation key (`findByReference`). */
  ourReference: string;
  /** "#1001" */
  orderReference: string;
  /** YYYY-MM-DD */
  date: string;
  locale: string;
  customer: InvoiceCustomer;
  lines: InvoiceLine[];
  total: number;
  payments: { method: 'STRIPE' | 'MANUAL' | 'STORE_CREDIT'; amount: number; date: string }[];
  /** Credit notes: the document being credited. */
  original?: { externalId: string; total: number };
  reason?: string;
};

export type IssuedDocument = {
  externalId: string;
  number: string;
  series: string | null;
  documentType: string;
  /** Cents, as reported by the provider (null when unknown). */
  total: number | null;
  issuedAt: string;
  /** e.g. RECEIPT_FAILED, TOTAL_MISMATCH:<diff> */
  warnings: string[];
};

/**
 * A billing provider. Errors are `EcommerceBillingError`; `uncertain = true` means the document may
 * have been issued (never re-issue automatically: reconcile with `findByReference`).
 */
export type BillingProvider = {
  id: string;
  capabilities: { creditNotes: boolean; findByReference: boolean };
  issue(draft: InvoiceDraft, rt: ProviderRuntime): Promise<IssuedDocument>;
  getDocument(externalId: string, rt: ProviderRuntime): Promise<IssuedDocument>;
  getPdf(externalId: string, rt: ProviderRuntime): Promise<Buffer>;
  findByReference(ourReference: string, rt: ProviderRuntime): Promise<IssuedDocument | null>;
};
