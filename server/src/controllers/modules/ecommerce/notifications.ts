import type { Core } from '@strapi/strapi';
import { PLUGIN_ID } from '../../../config';
import { handleDomainError as handleSharedDomainError } from './errors';

/**
 * Notification endpoints. Responses never carry the `payload` (it holds voucher codes and
 * payment links): every row goes through `view`, an allow-list.
 */
const EcommerceNotificationController = ({ strapi }: { strapi: Core.Strapi }) => {
  const notifications = (): any => strapi.plugin(PLUGIN_ID).service('EcommerceNotificationService');
  const actorOf = (ctx: any): string => `user:${ctx.state?.user?.id}`;

  const view = (n: any) => ({
    id: n.id,
    orderId: n.orderId ?? null,
    type: n.type,
    eventId: n.eventId ?? null,
    recipient: n.recipient ?? null,
    locale: n.locale ?? null,
    status: n.status ?? null,
    providerMessageId: n.providerMessageId ?? null,
    error: n.error ?? null,
    attempts: n.attempts ?? 0,
    sentAt: n.sentAt ?? null,
    createdAt: n.createdAt ?? null,
  });

  const run = async (ctx: any, fn: (id: number) => Promise<unknown>) => {
    const id = Number(ctx.params?.id);
    if (!Number.isInteger(id) || id < 1) return ctx.badRequest('Invalid id');
    try {
      ctx.body = await fn(id);
    } catch (err) {
      return handleSharedDomainError(ctx, err, {
        invalid: 'Invalid notification',
        notFound: 'Notification not found',
      });
    }
  };

  return {
    listForOrder: (ctx: any) =>
      run(ctx, async (id) => ((await notifications().listForOrder(id)) as any[]).map(view)),

    async resend(ctx: any) {
      const id = Number(ctx.params?.id);
      if (!Number.isInteger(id) || id < 1) return ctx.badRequest('Invalid id');
      try {
        const result = view(await notifications().resend(id, actorOf(ctx)));
        if (result.status === 'SKIPPED' && result.error === 'EMAIL_NOT_CONFIGURED') {
          return ctx.badRequest('E-mail is not configured', { code: 'EMAIL_NOT_CONFIGURED' });
        }
        ctx.body = result;
      } catch (err) {
        return handleSharedDomainError(ctx, err, {
          invalid: 'Invalid notification',
          notFound: 'Notification not found',
        });
      }
    },
  };
};

export default EcommerceNotificationController;
