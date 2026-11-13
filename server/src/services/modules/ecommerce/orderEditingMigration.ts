import type { Core } from '@strapi/strapi';
import { PLUGIN_ID, type LtbConfigs } from '../../../config';
import { legacyEditingData } from './domain/orderEditingData';

/**
 * Backfills the order-editing columns of orders created before they existed (null shippingLines).
 * Writes only those three columns; idempotent, since a migrated order no longer matches.
 */
export async function migrateOrderEditingData(
  strapi: Core.Strapi,
  batchSize = 100
): Promise<{ migrated: number }> {
  const config: LtbConfigs = strapi.config.get(`plugin::${PLUGIN_ID}`);
  const orders = strapi.db.query(config.uuid.modules.ecommerce.order);
  let migrated = 0;
  let lastId = 0;
  for (;;) {
    const batch = await orders.findMany({
      where: { shippingLines: { $null: true }, id: { $gt: lastId } },
      orderBy: { id: 'asc' },
      limit: batchSize,
    });
    if (batch.length === 0) break;
    for (const order of batch) {
      await orders.update({ where: { id: order.id }, data: legacyEditingData(order) });
      migrated++;
      lastId = order.id;
    }
  }
  return { migrated };
}
