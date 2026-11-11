import { describe, it, expect } from 'vitest';
import {
  initialOrderModalState,
  orderModalReducer,
  type OrderModalEvent,
  type OrderModalState,
} from '../../../admin/src/ecommerce/utils/orderModals';

const run = (events: OrderModalEvent[], from: OrderModalState = initialOrderModalState) =>
  events.reduce(orderModalReducer, from);

describe('orderModalReducer', () => {
  it('opens a toolbar modal with a new key and no refund prefill', () => {
    const s = run([{ type: 'OPEN', action: 'REFUND' }]);
    expect(s).toMatchObject({ modal: 'REFUND', key: 1, submitting: false });
    expect(s.refundInitial).toBeUndefined();
  });

  it('"Refund now" hands the return modal over to the refund modal with the prefill', () => {
    const s = run([
      { type: 'OPEN', action: 'REGISTER_RETURN' },
      { type: 'HAND_OFF_REFUND', initial: { reason: 'RETURN', amount: 2990 } },
    ]);
    expect(s).toMatchObject({ modal: 'REFUND', key: 2, refundInitial: { reason: 'RETURN', amount: 2990 } });
  });

  it('ignores a hand-off when the return modal is not the open one', () => {
    const open = run([{ type: 'OPEN', action: 'SHIP' }]);
    expect(orderModalReducer(open, { type: 'HAND_OFF_REFUND', initial: { reason: 'RETURN' } })).toBe(open);
  });

  it('a late close or "done" from the replaced return modal leaves the refund modal open', () => {
    const handedOff = run([
      { type: 'OPEN', action: 'REGISTER_RETURN' },
      { type: 'HAND_OFF_REFUND', initial: { reason: 'RETURN', amount: 2990 } },
    ]);
    expect(orderModalReducer(handedOff, { type: 'CLOSE', from: 'REGISTER_RETURN' })).toBe(handedOff);
    expect(orderModalReducer(handedOff, { type: 'DONE', from: 'REGISTER_RETURN' })).toBe(handedOff);
  });

  it('keeps the handed-off refund modal mounted until its own submit resolves', () => {
    let s = run([
      { type: 'OPEN', action: 'REGISTER_RETURN' },
      { type: 'HAND_OFF_REFUND', initial: { reason: 'RETURN', amount: 2990 } },
      { type: 'SUBMITTING', from: 'REFUND', submitting: true },
    ]);
    // Nothing else closes or replaces it while the request is in flight.
    for (const event of [
      { type: 'CLOSE', from: 'REFUND' },
      { type: 'CLOSE', from: 'REGISTER_RETURN' },
      { type: 'DONE', from: 'REGISTER_RETURN' },
      { type: 'OPEN', action: 'CANCEL' },
      { type: 'HAND_OFF_REFUND', initial: { reason: 'OTHER' } },
    ] as OrderModalEvent[]) {
      s = orderModalReducer(s, event);
      expect(s).toMatchObject({ modal: 'REFUND', key: 2, submitting: true });
    }
    // Its own success closes it.
    s = orderModalReducer(s, { type: 'DONE', from: 'REFUND' });
    expect(s).toMatchObject({ modal: null, submitting: false });
    // The submit's `finally` arrives after: no effect.
    expect(orderModalReducer(s, { type: 'SUBMITTING', from: 'REFUND', submitting: false })).toBe(s);
  });

  it('a failed refund unlocks the modal and leaves it open for another try', () => {
    const s = run([
      { type: 'OPEN', action: 'REFUND' },
      { type: 'SUBMITTING', from: 'REFUND', submitting: true },
      { type: 'SUBMITTING', from: 'REFUND', submitting: false },
    ]);
    expect(s).toMatchObject({ modal: 'REFUND', submitting: false });
    expect(orderModalReducer(s, { type: 'CLOSE', from: 'REFUND' }).modal).toBeNull();
  });

  it('the header Refund and the hand-off follow the same states', () => {
    const header = run([
      { type: 'OPEN', action: 'REFUND' },
      { type: 'SUBMITTING', from: 'REFUND', submitting: true },
      { type: 'DONE', from: 'REFUND' },
    ]);
    const handOff = run([
      { type: 'OPEN', action: 'REGISTER_RETURN' },
      { type: 'HAND_OFF_REFUND', initial: { reason: 'RETURN' } },
      { type: 'SUBMITTING', from: 'REFUND', submitting: true },
      { type: 'DONE', from: 'REFUND' },
    ]);
    expect(header.modal).toBeNull();
    expect(handOff.modal).toBeNull();
  });

  it('a toolbar opening clears a previous hand-off prefill', () => {
    const s = run([
      { type: 'OPEN', action: 'REGISTER_RETURN' },
      { type: 'HAND_OFF_REFUND', initial: { reason: 'RETURN', amount: 100 } },
      { type: 'CLOSE', from: 'REFUND' },
      { type: 'OPEN', action: 'REFUND' },
    ]);
    expect(s.refundInitial).toBeUndefined();
  });

  it('RESET closes everything, even mid-request (another order)', () => {
    const s = run([
      { type: 'OPEN', action: 'REFUND' },
      { type: 'SUBMITTING', from: 'REFUND', submitting: true },
      { type: 'RESET' },
    ]);
    expect(s).toMatchObject({ modal: null, submitting: false });
  });
});
