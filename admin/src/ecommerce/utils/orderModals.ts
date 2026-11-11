import type { ToolbarAction } from './orderDetail';
import type { RefundInitial } from './refundForm';

/**
 * Which action modal the order page shows. One modal at a time; `key` changes on every opening so
 * the modal remounts (new idempotency key). `submitting`: the open modal's request is in flight —
 * nothing but that modal's own outcome may close it.
 */
export type OrderModalState = {
  modal: ToolbarAction | null;
  key: number;
  refundInitial?: RefundInitial;
  submitting: boolean;
};

export type OrderModalEvent =
  /** A toolbar button. Ignored while a request is in flight. */
  | { type: 'OPEN'; action: ToolbarAction }
  /** "Refund now" after a return: the return modal hands over to the refund modal with a prefill. */
  | { type: 'HAND_OFF_REFUND'; initial: RefundInitial }
  /** A modal asks to close (Cancel, Escape, overlay, Done). Only the open modal, and not mid-request. */
  | { type: 'CLOSE'; from: ToolbarAction }
  /** The open modal started (true) or finished (false) its request. */
  | { type: 'SUBMITTING'; from: ToolbarAction; submitting: boolean }
  /** The open modal's request succeeded: it closes. */
  | { type: 'DONE'; from: ToolbarAction }
  /** Another order: everything closes. */
  | { type: 'RESET' };

export const initialOrderModalState: OrderModalState = { modal: null, key: 0, submitting: false };

/**
 * Close requests are scoped to the modal that sends them, so a late callback of a modal that is
 * already gone (e.g. the return modal after "Refund now") cannot close the modal that replaced it.
 */
export function orderModalReducer(state: OrderModalState, event: OrderModalEvent): OrderModalState {
  switch (event.type) {
    case 'OPEN':
      if (state.submitting) return state;
      return { modal: event.action, key: state.key + 1, submitting: false };
    case 'HAND_OFF_REFUND':
      if (state.modal !== 'REGISTER_RETURN' || state.submitting) return state;
      return { modal: 'REFUND', key: state.key + 1, refundInitial: event.initial, submitting: false };
    case 'CLOSE':
      if (state.modal !== event.from || state.submitting) return state;
      return { modal: null, key: state.key, submitting: false };
    case 'SUBMITTING':
      if (state.modal !== event.from || state.submitting === event.submitting) return state;
      return { ...state, submitting: event.submitting };
    case 'DONE':
      if (state.modal !== event.from) return state;
      return { modal: null, key: state.key, submitting: false };
    case 'RESET':
      return { modal: null, key: state.key + 1, submitting: false };
    default:
      return state;
  }
}
