import type { Core } from '@strapi/strapi';
import { PLUGIN_ID } from '../../../config';
import { handleDomainError as handleSharedDomainError } from './errors';

const EcommerceSettingsController = ({ strapi }: { strapi: Core.Strapi }) => {
  const service = (name: string): any => strapi.plugin(PLUGIN_ID).service(name);
  const settings = () => service('EcommerceSettingsService');
  const templates = () => service('EcommerceEmailTemplateService');

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
    getStore: (ctx: any) => respond(ctx, () => settings().getStoreSettings()),
    updateStore: (ctx: any) =>
      respond(ctx, () => settings().updateStoreSettings(body(ctx), userId(ctx))),

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
