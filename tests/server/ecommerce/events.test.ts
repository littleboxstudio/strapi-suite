import { describe, it, expect, vi, beforeEach } from 'vitest';
import EcommerceEventBus, {
  __resetEventHandlersForTests,
} from '../../../server/src/services/modules/ecommerce/events';

const error = vi.fn();
const bus = () => EcommerceEventBus({ strapi: { log: { error } } as any });

beforeEach(() => {
  __resetEventHandlersForTests();
  error.mockClear();
});

describe('EcommerceEventBus', () => {
  it('does not call handlers before flush', async () => {
    const b = bus();
    const h = vi.fn(async () => {});
    b.subscribe('ORDER_CREATED', h);
    const c = b.collector();
    c.emit({ type: 'ORDER_CREATED', orderId: 1, payload: {} });
    expect(h).not.toHaveBeenCalled();
    await c.flush();
    expect(h).toHaveBeenCalledTimes(1);
    expect(h.mock.calls[0][0]).toMatchObject({ type: 'ORDER_CREATED', orderId: 1 });
    expect(h.mock.calls[0][0].id).toMatch(/[0-9a-f-]{36}/);
    await c.flush();
    expect(h).toHaveBeenCalledTimes(1);
  });

  it('a throwing handler does not stop the others and is logged without payload', async () => {
    const b = bus();
    const order: string[] = [];
    b.subscribe('*', async () => {
      order.push('a');
      throw new Error('boom');
    });
    b.subscribe('ORDER_CANCELLED', async () => void order.push('b'));
    b.subscribe('ORDER_CREATED', async () => void order.push('x'));
    const c = b.collector();
    c.emit({ type: 'ORDER_CANCELLED', payload: { email: 'a@b.pt' } });
    await expect(c.flush()).resolves.toBeUndefined();
    expect(order).toEqual(['b', 'a']);
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0][0])).not.toContain('a@b.pt');
  });
});
