import type { Core } from '@strapi/strapi';
import { PLUGIN_ID } from '../../../config';
import { registerDuplicatePermissions } from './permissions';

/**
 * Boot of the duplication feature: registers its admin permission, then marks the runs a stopped
 * process left RUNNING as INTERRUPTED (a run lives in one process; none has started yet).
 */
export async function bootDuplicate(strapi: Core.Strapi): Promise<void> {
  await registerDuplicatePermissions(strapi);
  try {
    const count = await strapi.plugin(PLUGIN_ID).service('DuplicateRunService').interruptAll();
    if (count > 0) strapi.log?.warn?.(`[duplicate] ${count} interrupted run(s) marked INTERRUPTED`);
  } catch (e) {
    strapi.log?.warn?.('[duplicate] interrupted runs sweep failed: ' + (e instanceof Error ? e.name : typeof e));
  }
}
