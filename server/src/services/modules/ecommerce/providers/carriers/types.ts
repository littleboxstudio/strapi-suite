import type { Address } from '../../domain/orders';
import type { ProviderRuntime } from '../registry';
import type { ShippingOption, ShippingQuoteRequest } from '../../shipping';

export type CarrierShipmentRequest = {
  /** LB-SHP-<shipmentId> */
  ourReference: string;
  orderReference: string;
  serviceId: string;
  destination: Address;
  contact: { name: string; email: string; phone?: string };
  items: ShippingQuoteRequest['items'];
  /** DPD Pickup: the order's pickup point. Other carriers ignore it. */
  pickupPoint?: { id: string; name: string };
  /** Number of parcels (DPD); 1 when absent. */
  parcels?: number;
  /** Weight of the shipped units in grams (as `orderWeightGrams`); from `items` when absent. */
  weightGrams?: number;
};

export type CarrierShipmentResult = {
  externalId: string;
  trackingCode: string | null;
  trackingUrl: string | null;
  /** Reported by the carrier; not stored (shipments carry no cost). */
  cost: number | null;
  labelAvailable: boolean;
  /** Private carrier reference to fetch the label later (DPD: the label URL). Never serialized. */
  labelRef?: string;
};

export type CarrierTrackingEvent = {
  code: string;
  description: string;
  occurredAt: string;
  delivered: boolean;
};

/**
 * Passed by the services on every carrier call, quotes included: adapters hand `timeoutMs` to
 * `timedFetch` (which assumes 10 s otherwise). A timed-out write must be thrown as `uncertain`.
 */
export type CarrierCallOptions = { timeoutMs: number };

export type CarrierAdapter = {
  /**
   * The carrier recognises a repeated `ourReference` and returns the shipment it already created,
   * so a manual retry after an uncertain outcome is safe. Absent means true; a carrier that may
   * create a second shipment (DPD) sets false and its uncertain shipments are settled by hand.
   */
  deduplicatesByReference?: boolean;
  quote?(
    req: ShippingQuoteRequest,
    rt: ProviderRuntime,
    opts?: CarrierCallOptions
  ): Promise<ShippingOption[]>;
  /** Retried with the same `ourReference` only when `deduplicatesByReference` is not false. */
  createShipment?(
    req: CarrierShipmentRequest,
    rt: ProviderRuntime,
    opts?: CarrierCallOptions
  ): Promise<CarrierShipmentResult>;
  cancelShipment?(externalId: string, rt: ProviderRuntime, opts?: CarrierCallOptions): Promise<void>;
  getLabel?(
    externalId: string,
    rt: ProviderRuntime,
    opts?: CarrierCallOptions,
    /** The shipment's `labelRef`, when the carrier returned one. */
    labelRef?: string
  ): Promise<{ filename: string; content: Buffer }>;
  track?(
    s: { externalId: string; trackingCode: string | null },
    rt: ProviderRuntime,
    opts?: CarrierCallOptions
  ): Promise<CarrierTrackingEvent[]>;
};
