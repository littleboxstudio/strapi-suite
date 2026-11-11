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

export type CarrierAdapter = {
  quote?(req: ShippingQuoteRequest, rt: ProviderRuntime): Promise<ShippingOption[]>;
  createShipment?(req: CarrierShipmentRequest, rt: ProviderRuntime): Promise<CarrierShipmentResult>;
  cancelShipment?(externalId: string, rt: ProviderRuntime): Promise<void>;
  getLabel?(externalId: string, rt: ProviderRuntime): Promise<{ filename: string; content: Buffer }>;
  track?(
    s: { externalId: string; trackingCode: string | null },
    rt: ProviderRuntime
  ): Promise<CarrierTrackingEvent[]>;
};
