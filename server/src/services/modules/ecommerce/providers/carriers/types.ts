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
};

export type CarrierShipmentResult = {
  externalId: string;
  trackingCode: string | null;
  trackingUrl: string | null;
  cost: number | null;
  labelAvailable: boolean;
};

export type CarrierTrackingEvent = {
  code: string;
  description: string;
  occurredAt: string;
  delivered: boolean;
};

/**
 * Passed by the services on every shipment call: adapters hand `timeoutMs` to `timedFetch`
 * (which assumes 10 s otherwise). A timed-out write must be thrown as `uncertain`.
 */
export type CarrierCallOptions = { timeoutMs: number };

export type CarrierAdapter = {
  quote?(req: ShippingQuoteRequest, rt: ProviderRuntime): Promise<ShippingOption[]>;
  /** Carriers deduplicate by `ourReference`, so a retry after an uncertain outcome is safe. */
  createShipment?(
    req: CarrierShipmentRequest,
    rt: ProviderRuntime,
    opts?: CarrierCallOptions
  ): Promise<CarrierShipmentResult>;
  cancelShipment?(externalId: string, rt: ProviderRuntime, opts?: CarrierCallOptions): Promise<void>;
  getLabel?(
    externalId: string,
    rt: ProviderRuntime,
    opts?: CarrierCallOptions
  ): Promise<{ filename: string; content: Buffer }>;
  track?(
    s: { externalId: string; trackingCode: string | null },
    rt: ProviderRuntime,
    opts?: CarrierCallOptions
  ): Promise<CarrierTrackingEvent[]>;
};
