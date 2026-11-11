import type { Core } from '@strapi/strapi';
import { randomUUID } from 'crypto';

export type DomainEventType =
  | 'ORDER_CREATED'
  | 'PAYMENT_COMPLETED'
  | 'ORDER_MODIFIED'
  | 'ORDER_CANCELLED'
  | 'ORDER_ARCHIVED'
  | 'PAYMENT_INSTRUCTIONS_SENT'
  | 'REFUND_STARTED'
  | 'REFUND_COMPLETED'
  | 'REFUND_FAILED'
  | 'STORE_CREDIT_ISSUED'
  | 'SHIPMENT_CREATED'
  | 'SHIPMENT_DELIVERED'
  | 'RETURN_REGISTERED'
  | 'INVOICE_ISSUED';

export type DomainEvent = {
  id: string;
  type: DomainEventType;
  orderId?: number;
  occurredAt: string;
  payload: Record<string, unknown>;
};

export type DomainEventHandler = (event: DomainEvent) => Promise<void>;

export type EmitInput = Omit<DomainEvent, 'id' | 'occurredAt'> & { id?: string; occurredAt?: string };

const handlers = new Map<DomainEventType | '*', DomainEventHandler[]>();

/** Test helper: clears every subscription. */
export function __resetEventHandlersForTests(): void {
  handlers.clear();
}

export function createEventBus(getStrapi: () => Core.Strapi | undefined) {
  const dispatch = async (event: DomainEvent): Promise<void> => {
    const list = [...(handlers.get(event.type) ?? []), ...(handlers.get('*') ?? [])];
    for (const handler of list) {
      try {
        await handler(event);
      } catch (error) {
        // Never log the payload or the error message (either may carry personal data):
        // only the event type, its id and the error class.
        const name = error instanceof Error ? error.name : typeof error;
        getStrapi()?.log?.error(
          `[ecommerce] event handler failed for ${event.type} (event ${event.id}): ${name}`
        );
      }
    }
  };

  return {
    subscribe(type: DomainEventType | '*', handler: DomainEventHandler): void {
      const list = handlers.get(type) ?? [];
      list.push(handler);
      handlers.set(type, list);
    },
    /** Emit inside the transaction; call flush() only after the commit. */
    collector() {
      let pending: DomainEvent[] = [];
      return {
        emit(event: EmitInput): void {
          pending.push({
            ...event,
            id: event.id ?? randomUUID(),
            occurredAt: event.occurredAt ?? new Date().toISOString(),
            payload: event.payload ?? {},
          });
        },
        async flush(): Promise<void> {
          const batch = pending;
          pending = [];
          for (const event of batch) await dispatch(event);
        },
      };
    },
  };
}

/** Single module-level instance. */
let currentStrapi: Core.Strapi | undefined;
export const eventBus = createEventBus(() => currentStrapi);

const EcommerceEventBus = ({ strapi }: { strapi: Core.Strapi }) => {
  currentStrapi = strapi;
  return {
    subscribe: eventBus.subscribe,
    collector: eventBus.collector,
  };
};

export default EcommerceEventBus;
