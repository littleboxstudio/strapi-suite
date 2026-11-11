import type { Core } from '@strapi/strapi';
import { PLUGIN_ID, LtbConfigs } from '../../../config';

export type AuditEntry = {
  area: string;
  action: string;
  targetId?: string;
  userId?: string;
  /** Never put secret values here: field names only. */
  details?: Record<string, unknown>;
};

const EcommerceAuditService = ({ strapi }: { strapi: Core.Strapi }) => ({
  async log(entry: AuditEntry): Promise<void> {
    const config: LtbConfigs = strapi.config.get(`plugin::${PLUGIN_ID}`);
    await strapi.db.query(config.uuid.modules.ecommerce.auditLog).create({
      data: {
        area: entry.area,
        action: entry.action,
        targetId: entry.targetId ?? null,
        userId: entry.userId ?? null,
        details: entry.details ?? null,
      },
    });
  },
});

export default EcommerceAuditService;
