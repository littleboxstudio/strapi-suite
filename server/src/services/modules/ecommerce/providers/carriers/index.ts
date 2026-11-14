import { cttExpressoAdapter } from './cttExpresso';
import { dpdPortugalAdapter } from './dpdPortugal';
import type { CarrierAdapter } from './types';

/** Built-in adapters, keyed by provider id (as `registry.ts` does for definitions). */
export const builtInCarrierAdapters = (): [string, CarrierAdapter][] => [
  ['ctt-expresso', { ...cttExpressoAdapter }],
  ['dpd-portugal', { ...dpdPortugalAdapter }],
];

export type { CarrierAdapter, CarrierCallOptions, CarrierShipmentRequest, CarrierShipmentResult, CarrierTrackingEvent } from './types';
