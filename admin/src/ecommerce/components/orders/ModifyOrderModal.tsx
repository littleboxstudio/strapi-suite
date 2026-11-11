import type { Order } from '../../orderTypes';

export type ModifyOrderModalProps = {
  order: Order;
  onClose: () => void;
  /** Called after a modification is applied; the page refetches the order. */
  onApplied: () => void;
};

/** Placeholder: the order modification flow lands with the next task. Mount it only while open. */
const ModifyOrderModal = (_props: ModifyOrderModalProps) => null;

export default ModifyOrderModal;
