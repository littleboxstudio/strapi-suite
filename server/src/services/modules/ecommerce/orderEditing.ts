/**
 * Order editing by section (plan 10): each edit runs through the idempotent edit runner
 * (`orderEditRunner.ts`). The edits themselves arrive in the following tasks.
 */
import type { Core } from '@strapi/strapi';
import { PLUGIN_ID } from '../../../config';
import { createEditRunner, type OrderHistoryServiceLike, type OrderServiceLike } from './orderEditRunner';
import type { OrderView } from './orders';

export type EditKind =
  | 'lines'
  | 'address'
  | 'shipping-recalculate'
  | 'shipping-line-edit'
  | 'shipping-line-add'
  | 'discounts'
  | 'manual-discount-add'
  | 'manual-discount-remove'
  | 'review-dismiss';

export type EditOutcome = { outcome: 'DUE' | 'REFUNDABLE' | 'NONE'; difference: number };

export type EditResult = { order: OrderView } & EditOutcome;

const EcommerceOrderEditingService = ({ strapi }: { strapi: Core.Strapi }) => {
  const service = (name: string): any => strapi.plugin(PLUGIN_ID).service(name);
  const events = (): { collector(): { emit(e: any): void; flush(): Promise<void> } } =>
    service('EcommerceEventBus');

  // Every edit method (added with each section) runs through this runner.
  const runner = createEditRunner(strapi, {
    orders: (): OrderServiceLike => service('EcommerceOrderService'),
    history: (): OrderHistoryServiceLike => service('EcommerceOrderHistoryService'),
    emit: async (type, event) => {
      const collector = events().collector();
      collector.emit({ type, ...event });
      await collector.flush();
    },
  });

  void runner;
  return {};
};

export default EcommerceOrderEditingService;
