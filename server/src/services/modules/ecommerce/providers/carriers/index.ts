import { cttExpressoAdapter } from './cttExpresso';
import type { CarrierAdapter } from './types';

/** Built-in adapters, keyed by provider id (as `registry.ts` does for definitions). */
export const builtInCarrierAdapters = (): [string, CarrierAdapter][] => [
  ['ctt-expresso', { ...cttExpressoAdapter }],
];

export type { CarrierAdapter, CarrierShipmentRequest, CarrierShipmentResult, CarrierTrackingEvent } from './types';
