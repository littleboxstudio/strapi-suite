import { EcommerceCarrierError } from '../../errors';
import type { CarrierAdapter } from './types';

const notImplemented = async (): Promise<never> => {
  throw new EcommerceCarrierError('NOT_IMPLEMENTED', 'CTT Expresso integration is not implemented yet.');
};

/** Structure only: no CTT documentation or credentials are available. */
export const cttExpressoAdapter: CarrierAdapter = {
  quote: notImplemented,
  createShipment: notImplemented,
  cancelShipment: notImplemented,
  getLabel: notImplemented,
  track: notImplemented,
};
