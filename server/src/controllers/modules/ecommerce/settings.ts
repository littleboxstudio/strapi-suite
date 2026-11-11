import fs from 'fs';
import type { Core } from '@strapi/strapi';
import { PLUGIN_ID } from '../../../config';
import { STRIPE_WEBHOOK_EVENTS } from '../../../services/modules/ecommerce/stripeWebhooks';
import { STRIPE_WEBHOOK_SUBPATH } from '../../../middlewares/ecommerceRawBody';
import { handleDomainError as handleSharedDomainError } from './errors';
import { MAX_LOGO_BYTES } from '../../../services/modules/ecommerce/domain/imageProcessing';

const EcommerceSettingsController = ({ strapi }: { strapi: Core.Strapi }) => {
  const service = (name: string): any => strapi.plugin(PLUGIN_ID).service(name);
  const settings = () => service('EcommerceSettingsService');
  const templates = () => service('EcommerceEmailTemplateService');
  const zones = () => service('EcommerceShippingZoneService');

  const userId = (ctx: any): string | undefined => {
    const id = ctx.state?.user?.id;
    return id === undefined || id === null ? undefined : String(id);
  };
  const body = (ctx: any) => ctx.request?.body ?? {};

  const handleDomainError = (ctx: any, err: unknown) =>
    handleSharedDomainError(ctx, err, { invalid: 'Invalid settings', notFound: 'Not found' });

  /** Runs `fn`, sends its result as the body (when defined) and maps domain errors. */
  const respond = async (ctx: any, fn: () => Promise<unknown>, noContent = false) => {
    try {
      const result = await fn();
      if (noContent) ctx.status = 204;
      else ctx.body = result;
    } catch (err) {
      return handleDomainError(ctx, err);
    }
  };

  return {
    /** Reuses the products locales endpoint so both serve the same payload. */
    getLocales: (ctx: any) => {
      const products: any = strapi.plugin(PLUGIN_ID).controller('EcommerceProductController');
      return products.getLocales(ctx);
    },

    /** What the admin shows to set up the Stripe webhook (no secrets). */
    getStripeWebhook: (ctx: any) => {
      // Same prefix as the raw-body middleware, so the URL copied into Stripe is the one served.
      const prefix = String(strapi.config.get('api.rest.prefix', '/api')).replace(/\/+$/, '');
      ctx.body = {
        path: `${prefix}/${PLUGIN_ID}${STRIPE_WEBHOOK_SUBPATH}`,
        events: [...STRIPE_WEBHOOK_EVENTS],
      };
    },

    getStorefrontToken: (ctx: any) => respond(ctx, () => settings().getStorefrontToken()),
    /** The response carries the plain token once: never cached. */
    generateStorefrontToken: (ctx: any) => {
      ctx.set?.('Cache-Control', 'no-store');
      return respond(ctx, () => settings().generateStorefrontToken(userId(ctx)));
    },
    regenerateStorefrontToken: (ctx: any) => {
      ctx.set?.('Cache-Control', 'no-store');
      return respond(ctx, () => settings().regenerateStorefrontToken(userId(ctx)));
    },

    getStore: (ctx: any) => respond(ctx, () => settings().getStoreSettings()),
    updateStore: (ctx: any) =>
      respond(ctx, () => settings().updateStoreSettings(body(ctx), userId(ctx))),

    uploadStoreLogo: async (ctx: any) => {
      const file = ctx.request?.files?.file;
      if (!file || Array.isArray(file)) return ctx.badRequest('A file is required');
      if (file.size > MAX_LOGO_BYTES) return ctx.badRequest('The logo exceeds 400 KB');
      try {
        const buffer = await fs.promises.readFile(file.filepath);
        ctx.body = await settings().uploadStoreLogo(
          { buffer, originalName: file.originalFilename || 'logo' },
          userId(ctx)
        );
      } catch (err: any) {
        if (err?.message === 'INVALID_IMAGE') {
          return ctx.badRequest('Invalid image', { code: 'INVALID_IMAGE' });
        }
        if (err?.message === 'UPLOAD_FAILED') {
          return ctx.badRequest('Upload failed', { code: 'UPLOAD_FAILED' });
        }
        return handleDomainError(ctx, err);
      }
    },
    removeStoreLogo: (ctx: any) => respond(ctx, () => settings().removeStoreLogo(userId(ctx))),

    listIntegrations: (ctx: any) => respond(ctx, () => settings().listIntegrations()),
    updateIntegration: (ctx: any) =>
      respond(ctx, () =>
        settings().updateIntegration(
          ctx.params.id,
          { config: body(ctx).config, secrets: body(ctx).secrets },
          userId(ctx)
        )
      ),
    setIntegrationActive: (ctx: any) => {
      const { active } = body(ctx);
      if (typeof active !== 'boolean') return ctx.badRequest('active must be a boolean');
      return respond(ctx, () => settings().setActive(ctx.params.id, active, userId(ctx)));
    },
    testIntegration: (ctx: any) => respond(ctx, () => settings().testConnection(ctx.params.id)),
    integrationLookups: (ctx: any) =>
      respond(ctx, () => settings().integrationLookups(ctx.params.id, ctx.query?.companyId)),

    listShippingMethods: (ctx: any) => respond(ctx, () => settings().listManualMethods()),
    createShippingMethod: async (ctx: any) => {
      await respond(ctx, async () => {
        const created = await settings().createManualMethod(body(ctx), userId(ctx));
        ctx.status = 201;
        return created;
      });
    },
    updateShippingMethod: (ctx: any) =>
      respond(ctx, () => settings().updateManualMethod(Number(ctx.params.id), body(ctx), userId(ctx))),
    deleteShippingMethod: (ctx: any) =>
      respond(ctx, () => settings().deleteManualMethod(Number(ctx.params.id), userId(ctx)), true),

    listShippingZones: (ctx: any) => respond(ctx, () => zones().list()),
    createShippingZone: async (ctx: any) => {
      await respond(ctx, async () => {
        const created = await zones().create(body(ctx), userId(ctx));
        ctx.status = 201;
        return created;
      });
    },
    updateShippingZone: (ctx: any) =>
      respond(ctx, () => zones().update(Number(ctx.params.id), body(ctx), userId(ctx))),
    deleteShippingZone: (ctx: any) =>
      respond(ctx, () => zones().remove(Number(ctx.params.id), userId(ctx)), true),

    listEmailTemplates: (ctx: any) => respond(ctx, () => templates().list()),
    getEmailTemplate: (ctx: any) =>
      respond(ctx, () => templates().get(ctx.params.type, ctx.params.locale)),
    saveEmailTemplate: (ctx: any) =>
      respond(ctx, () =>
        templates().save(
          ctx.params.type,
          ctx.params.locale,
          { subject: body(ctx).subject, html: body(ctx).html },
          userId(ctx)
        )
      ),
    previewEmailTemplate: (ctx: any) =>
      respond(ctx, () =>
        templates().preview(ctx.params.type, { subject: body(ctx).subject, html: body(ctx).html })
      ),
    sendTestEmail: (ctx: any) =>
      respond(ctx, () =>
        templates().sendTest(ctx.params.type, ctx.params.locale, body(ctx).to, userId(ctx))
      ),
    restoreDefaultEmailTemplate: (ctx: any) =>
      respond(ctx, () =>
        templates().restoreDefault(ctx.params.type, ctx.params.locale, userId(ctx))
      ),
    listEmailTemplateVersions: (ctx: any) =>
      respond(ctx, () => templates().listVersions(ctx.params.type, ctx.params.locale)),
    restoreEmailTemplateVersion: (ctx: any) =>
      respond(ctx, () =>
        templates().restoreVersion(
          ctx.params.type,
          ctx.params.locale,
          Number(ctx.params.versionId),
          userId(ctx)
        )
      ),
  };
};

export default EcommerceSettingsController;
