import type { Core } from '@strapi/strapi';
import { PLUGIN_ID } from '../../../config';
import { handleDomainError as handleSharedDomainError } from './errors';
import { MAX_KEY, asObject, lineQuantities, optionalString, requiredString } from './validation';

const MSG = 'Invalid return';

const EcommerceReturnController = ({ strapi }: { strapi: Core.Strapi }) => {
  const returns = (): any => strapi.plugin(PLUGIN_ID).service('EcommerceReturnService');

  return {
    register: async (ctx: any) => {
      const id = Number(ctx.params?.id);
      if (!Number.isInteger(id) || id < 1) return ctx.badRequest('Invalid id');
      try {
        const b = asObject(ctx.request?.body);
        const input = {
          lines: lineQuantities(MSG, b.lines, true),
          reason: requiredString(MSG, 'reason', b.reason, 200),
          notes: optionalString(MSG, 'notes', b.notes, 2000),
          idempotencyKey: requiredString(MSG, 'idempotencyKey', b.idempotencyKey, MAX_KEY),
        };
        const result = await returns().register(id, input, `user:${ctx.state?.user?.id}`);
        ctx.status = 201;
        ctx.body = result;
      } catch (err) {
        return handleSharedDomainError(ctx, err, {
          invalid: MSG,
          notFound: 'Order not found',
          withCode: true,
        });
      }
    },
  };
};

export default EcommerceReturnController;
