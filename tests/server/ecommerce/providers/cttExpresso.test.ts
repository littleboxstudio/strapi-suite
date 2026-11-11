import { describe, it, expect } from 'vitest';
import { cttExpressoAdapter } from '../../../../server/src/services/modules/ecommerce/providers/carriers/cttExpresso';
import { EcommerceCarrierError } from '../../../../server/src/services/modules/ecommerce/errors';

const rt = { config: {}, secrets: {} };

describe('cttExpressoAdapter', () => {
  it('every method throws NOT_IMPLEMENTED', async () => {
    const a: any = cttExpressoAdapter;
    for (const call of [
      () => a.quote({}, rt),
      () => a.createShipment({}, rt),
      () => a.cancelShipment('1', rt),
      () => a.getLabel('1', rt),
      () => a.track({ externalId: '1', trackingCode: null }, rt),
    ]) {
      const err = await call().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(EcommerceCarrierError);
      expect(err).toMatchObject({ code: 'NOT_IMPLEMENTED', message: 'CTT Expresso integration is not implemented yet.' });
    }
  });
});
