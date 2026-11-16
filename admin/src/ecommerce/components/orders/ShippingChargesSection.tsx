import { useState } from 'react';
import { useIntl } from 'react-intl';
import { useNotification } from '@strapi/strapi/admin';
import { Button, Dialog, Flex, Typography } from '@strapi/design-system';
import { getTranslation } from '../../../core/utils/getTranslation';
import RemoveShippingLine from '../../usecases/orders/removeShippingLine';
import { formatCents } from '../../utils/money';
import { apiErrorMessageId } from '../../utils/orderDetail';
import { canEdit, shippingLineRows } from '../../utils/orderEditing';
import { mintUuid } from '../../utils/variantDraft';
import type { EditResult, Order, ShippingLineView, ShipUnits } from '../../orderTypes';
import { shippableOf } from '../../utils/shipmentForm';
import ShippingChargesTable from './ShippingChargesTable';
import ShippingLineModal from './ShippingLineModal';
import RecalculateShippingModal, { type RecalculationState } from './RecalculateShippingModal';
import OrderSection from './OrderSection';

type Props = {
  id?: string;
  title: string;
  /** The order: its shipping charges and which edits it offers. */
  order: Order;
  /** `orders.manage`: the shipping charge edits. */
  canManage: boolean;
  /** After a shipping edit: the order it returned. */
  onEdited: (result: EditResult) => void;
};

/** The open shipping modal; it unmounts on close, so each opening mints its own operationId. */
type ShippingModal =
  | { kind: 'RECALCULATE'; resume?: RecalculationState }
  | {
      kind: 'LINE';
      mode: 'EDIT' | 'ADD';
      line?: ShippingLineView;
      /** From Recalculate shipping: a new charge for these units, and the steps to go back to. */
      recalculation?: { units: ShipUnits; state: RecalculationState };
    }
  | { kind: 'REMOVE'; line: ShippingLineView; operationId: string };

/** The order's shipping charges: recalculate, add, edit and remove them. */
const ShippingChargesSection = ({ id, title, order, canManage, onEdited }: Props) => {
  const { formatMessage, locale } = useIntl();
  const { toggleNotification } = useNotification();
  const t = (key: string, values?: Record<string, any>) => formatMessage({ id: getTranslation(key) }, values);
  const [shippingModal, setShippingModal] = useState<ShippingModal | null>(null);
  const [removing, setRemoving] = useState(false);

  /**
   * The shipping charge modal's recalculation: the review, Back to the steps and, for option 2 (the
   * products still to ship), the checkbox that adds the units not paid yet.
   */
  const recalculationProps = (m: Extract<ShippingModal, { kind: 'LINE' }>) => {
    const r = m.recalculation;
    if (!r) return undefined;
    const unitsFor = (unpaid: boolean): ShipUnits =>
      order.lines
        .map((l) => ({ orderLineId: l.id, quantity: unpaid ? l.pending : shippableOf(l) }))
        .filter((u) => u.quantity > 0);
    const remaining = r.state.choice === 'REMAINING';
    const paid = unitsFor(false);
    const all = unitsFor(true);
    return {
      // Option 2 quotes the units still to ship (the paid ones unless the checkbox adds the others).
      units: remaining ? (r.state.withUnpaid ? all : paid) : r.units,
      review: r.state.review,
      onBack: () => setShippingModal({ kind: 'RECALCULATE', resume: r.state }),
      // The checkbox only when some unit still to ship is not paid.
      ...(remaining && JSON.stringify(paid) !== JSON.stringify(all)
        ? {
            unpaid: {
              paid,
              all,
              withUnpaid: r.state.withUnpaid,
              onChange: (withUnpaid: boolean) =>
                setShippingModal({ ...m, recalculation: { ...r, state: { ...r.state, withUnpaid } } }),
            },
          }
        : {}),
    };
  };

  /** Removes the line the confirmation names (one operationId per opening). */
  const remove = async () => {
    if (removing || shippingModal?.kind !== 'REMOVE') return;
    setRemoving(true);
    try {
      const result = await new RemoveShippingLine().execute(order.id, shippingModal.line.id, {
        operationId: shippingModal.operationId,
      });
      onEdited(result);
      toggleNotification({ type: 'success', message: t('ecommerce.orders.shippingCharges.removed') });
      setShippingModal(null);
    } catch (err) {
      toggleNotification({
        type: 'danger',
        message: t(apiErrorMessageId(err, 'ecommerce.orders.shippingCharges.removeError')),
      });
    } finally {
      setRemoving(false);
    }
  };
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
      <ShippingChargesTable
        rows={chargeRows}
        onEdit={(line) => setShippingModal({ kind: 'LINE', mode: 'EDIT', line })}
        onRemove={(line) => setShippingModal({ kind: 'REMOVE', line, operationId: mintUuid() })}
      />
      {canManage && shippingModal?.kind === 'REMOVE' && (
        <Dialog.Root open onOpenChange={(next: boolean) => !next && !removing && setShippingModal(null)}>
          <Dialog.Content>
            <Dialog.Header>{t('ecommerce.orders.shippingCharges.removeTitle')}</Dialog.Header>
            <Dialog.Body>
              <Typography variant="omega" style={{ textAlign: 'center' }}>
                {t('ecommerce.orders.shippingCharges.removeBody', {
                  name: shippingModal.line.name,
                  amount: formatCents(shippingModal.line.effectiveAmount ?? shippingModal.line.amount, locale),
                })}
              </Typography>
            </Dialog.Body>
            <Dialog.Footer>
              <Flex style={{ width: '100%' }} gap={2}>
                <Button fullWidth variant="tertiary" disabled={removing} onClick={() => setShippingModal(null)}>
                  {t('ecommerce.orders.shippingCharges.close')}
                </Button>
                <Button fullWidth variant="danger-light" loading={removing} onClick={remove}>
                  {t('ecommerce.orders.shippingCharges.remove')}
                </Button>
              </Flex>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Root>
      )}
      {canManage && shippingModal?.kind === 'RECALCULATE' && (
        <RecalculateShippingModal
          order={order}
          resume={shippingModal.resume}
          onClose={() => setShippingModal(null)}
          onAddCharge={(units, state) => setShippingModal({ kind: 'LINE', mode: 'ADD', recalculation: { units, state } })}
        />
      )}
      {canManage && shippingModal?.kind === 'LINE' && (
        <ShippingLineModal
          order={order}
          mode={shippingModal.mode}
          line={shippingModal.line}
          recalculation={recalculationProps(shippingModal)}
          onClose={() => setShippingModal(null)}
          onSaved={onEdited}
        />
      )}
    </OrderSection>
  );
};

export default ShippingChargesSection;
