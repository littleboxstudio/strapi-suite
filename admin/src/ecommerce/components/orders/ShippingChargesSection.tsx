import { useState } from 'react';
import { useIntl } from 'react-intl';
import { Button, Flex } from '@strapi/design-system';
import { getTranslation } from '../../../core/utils/getTranslation';
import { type OrderActionPermissions, type ToolbarAction } from '../../utils/orderDetail';
import { canEdit, shippingLineRows } from '../../utils/orderEditing';
import type { EditResult, Order, ShippingLineView } from '../../orderTypes';
import ShippingChargesTable from './ShippingChargesTable';
import ShippingLineModal from './ShippingLineModal';
import RecalculateShippingModal from './RecalculateShippingModal';
import OrderSection from './OrderSection';

type Props = {
  id?: string;
  title: string;
  /** The order: its shipping charges and which edits it offers. */
  order: Order;
  permissions: OrderActionPermissions;
  /** `orders.manage`: the shipping charge edits. */
  canManage: boolean;
  /** After a shipping edit: the order it returned. */
  onEdited: (result: EditResult) => void;
  /** A balance button of an edit's result step (add payment, refund, …). */
  onAction: (action: ToolbarAction) => void;
};

/** The open shipping modal; it unmounts on close, so each opening mints its own operationId. */
type ShippingModal = { kind: 'RECALCULATE' } | { kind: 'LINE'; mode: 'EDIT' | 'ADD'; line?: ShippingLineView };

/** The order's shipping charges: recalculate, add and edit them. */
const ShippingChargesSection = ({ id, title, order, permissions, canManage, onEdited, onAction }: Props) => {
  const { formatMessage } = useIntl();
  const t = (key: string) => formatMessage({ id: getTranslation(key) });
  const [shippingModal, setShippingModal] = useState<ShippingModal | null>(null);
  const chargeRows = shippingLineRows(order.shippingLines, order.editing, canManage);

  const actions = (
    <Flex gap={4} alignItems="center">
      {canManage && canEdit(order, 'RECALCULATE_SHIPPING') && (
        <Button size="S" variant="secondary" onClick={() => setShippingModal({ kind: 'RECALCULATE' })}>
          {t('ecommerce.orders.shippingCharges.recalculate')}
        </Button>
      )}
      {canManage && canEdit(order, 'ADD_SHIPPING_LINE') && (
        <Button size="S" variant="secondary" onClick={() => setShippingModal({ kind: 'LINE', mode: 'ADD' })}>
          {t('ecommerce.orders.shippingCharges.add')}
        </Button>
      )}
    </Flex>
  );

  return (
    <OrderSection id={id} title={title} actions={actions}>
      <ShippingChargesTable rows={chargeRows} onEdit={(line) => setShippingModal({ kind: 'LINE', mode: 'EDIT', line })} />
      {canManage && shippingModal?.kind === 'RECALCULATE' && (
        <RecalculateShippingModal order={order} onClose={() => setShippingModal(null)} onSaved={onEdited} />
      )}
      {canManage && shippingModal?.kind === 'LINE' && (
        <ShippingLineModal
          order={order}
          mode={shippingModal.mode}
          line={shippingModal.line}
          permissions={permissions}
          onClose={() => setShippingModal(null)}
          onSaved={onEdited}
          onAction={(action) => {
            setShippingModal(null);
            onAction(action);
          }}
        />
      )}
    </OrderSection>
  );
};

export default ShippingChargesSection;
