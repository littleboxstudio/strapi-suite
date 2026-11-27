import type { Core } from '@strapi/strapi';
import { PLUGIN_ID } from '../../config';
import { DuplicateError } from '../../services/modules/duplicate/errors';

/** The admin routes of Duplicate content (all gated by the duplicate.run permission). */
const DuplicateController = ({ strapi }: { strapi: Core.Strapi }) => {
  const service = (name: string): any => strapi.plugin(PLUGIN_ID).service(name);
  const body = (ctx: any) => ctx.request?.body ?? {};

  /** The name recorded on the run: first + last name, else the username, else the e-mail. */
  const userOf = (ctx: any) => {
    const user = ctx.state?.user ?? {};
    const name = [user.firstname, user.lastname].filter((p) => typeof p === 'string' && p.trim()).join(' ');
    return { id: user.id ?? null, name: name || user.username || user.email || null };
  };

  /**
   * Refusals use Strapi's error shape with the code in `details` (the admin fetch client keeps a
   * body only when it carries `error`): 409 for a run in progress, 400 for invalid input.
   */
  const respond = async (ctx: any, fn: () => Promise<any>, status = 200) => {
    try {
      const result = await fn();
      ctx.status = status;
      ctx.body = result;
    } catch (err) {
      if (!(err instanceof DuplicateError)) throw err;
      const status = err.code === 'RUN_IN_PROGRESS' ? 409 : 400;
      ctx.status = status;
      ctx.body = {
        data: null,
        error: {
          status,
          name: status === 409 ? 'ConflictError' : 'ValidationError',
          message: err.message || err.code,
          details: { code: err.code },
        },
      };
    }
  };

  return {
    getLocales: (ctx: any) =>
      respond(ctx, async () => {
        const locales = strapi.plugin('i18n').service('locales');
        const all: any[] = (await locales.find()) ?? [];
        return {
          defaultLocale: await locales.getDefaultLocale(),
          locales: all.map((l) => ({ code: l.code, name: l.name ?? l.code })),
        };
      }),

    summary: (ctx: any) =>
      respond(ctx, () => service('DuplicateService').summary(body(ctx).targetLocale, body(ctx).ecommerce === true)),

    start: (ctx: any) => respond(ctx, () => service('DuplicateService').start(body(ctx), userOf(ctx)), 202),

    listRuns: (ctx: any) => respond(ctx, () => service('DuplicateRunService').list()),

    currentRun: (ctx: any) => respond(ctx, async () => ({ run: await service('DuplicateRunService').running() })),
  };
};

export default DuplicateController;
