import { useState } from 'react';
import { useIntl } from 'react-intl';
import { useNotification } from '@strapi/strapi/admin';
import { Button, Flex, Modal, Typography } from '@strapi/design-system';
import { getTranslation } from '../../../core/utils/getTranslation';
import EmptyNote from './EmptyNote';
import RemoveManualDiscount from '../../usecases/orders/removeManualDiscount';
import { formatCents } from '../../utils/money';
import {
  apiErrorMessageId,
  codeStatusBadgeVariant,
  promotionRows,
  unappliedPromotionCodes,
  type OrderActionPermissions,
  type PromotionLocales,
  type ToolbarAction,
} from '../../utils/orderDetail';
import {
  canAddManualDiscount,
  canEdit,
  hasRowActions,
  manualDiscountPercent,
  manualDiscountRows,
  manualLineDiscountRows,
  manualLineDiscountTotal,
  orderDiscountTotal,
} from '../../utils/orderEditing';
import { mintUuid } from '../../utils/variantDraft';
import type { EditResult, ManualDiscount, Order, OrderPromotion, OrderPromotionCode } from '../../orderTypes';
import ManualDiscountModal from './ManualDiscountModal';
import RecalculateDiscountsModal from './RecalculateDiscountsModal';
import OrderSection from './OrderSection';
import DiscountsTable from './DiscountsTable';
import { ToneBadge } from './StatusBadges';

/** Long texts (a product name in a benefit) wrap inside their cell instead of running over the next. */
const WRAP = { whiteSpace: 'normal', overflowWrap: 'anywhere' } as const;

type Props = {
  id?: string;
  title: string;
  promotions: OrderPromotion[];
  /** Codes entered at checkout with their status; the ones that did not apply are listed. */
  promotionCodes?: OrderPromotionCode[];
  locales: PromotionLocales;
  /** The order: its manual discounts, and which discount edits it offers. */
  order: Order;
  permissions: OrderActionPermissions;
  /** After a discount edit: the order it returned. */
  onEdited: (result: EditResult) => void;
  /** A balance button of an edit's result step (add payment, refund, …). */
  onAction: (action: ToolbarAction) => void;
};

/** The open discounts modal; it unmounts on close, so each opening mints its own operationId. */
type DiscountModal = { kind: 'RECALCULATE' } | { kind: 'ADD' } | { kind: 'REMOVE'; discount: ManualDiscount };

/**
 * The promotions the order recorded (promotions requirements 3.2, 3.7 and 3.8): one row per benefit,
 * read from the stored snapshot only; a cancelled order shows its redemptions as released. The
 * manual discounts follow as "Manual" rows (spec 7.2); Recalculate discounts and Add discount sit
 * top right while the order can be edited.
 */
const PromotionsSection = ({
  id,
  title,
  promotions,
  promotionCodes,
  locales,
  order,
  permissions,
  onEdited,
  onAction,
}: Props) => {
  const { formatMessage, locale: uiLocale } = useIntl();
  const t = (id: string, values?: Record<string, any>) =>
    formatMessage({ id: getTranslation(id) }, values);
  const money = (cents: number) => formatCents(cents, uiLocale);
  const rows = promotionRows(promotions, locales);
  const unapplied = unappliedPromotionCodes(promotionCodes);
  const { canManage } = permissions;
  const manualRows = manualDiscountRows(order, canManage);
  // Spec 4.1: each line with a manual percent is listed too, so the total matches the order.
  const lineRows = manualLineDiscountRows(order.lines ?? [], uiLocale);
  const showActions = hasRowActions(manualRows);

  const [modal, setModal] = useState<DiscountModal | null>(null);
  const closeModal = () => setModal(null);
  const balanceAction = (action: ToolbarAction) => {
    setModal(null);
    onAction(action);
  };
  const manualReason = (m: ManualDiscount) =>
    m.kind === 'LEGACY' ? t('ecommerce.orders.discounts.legacyReason') : m.reason;

  const enteredCodes = unapplied.length > 0 && (
    <Flex direction="column" alignItems="stretch" gap={2}>
      <Typography variant="sigma" textColor="neutral600">
        {t('ecommerce.orders.promotions.enteredCodes')}
      </Typography>
      {unapplied.map((c) => (
        <Flex key={c.code} gap={2} alignItems="center" wrap="wrap">
          <Typography textColor="neutral800" fontWeight="semiBold">
            {c.code}
          </Typography>
          <ToneBadge variant={codeStatusBadgeVariant(c.status)}>
            {formatMessage({
              id: getTranslation(`ecommerce.orders.promotions.codeStatus.${c.status}`),
              defaultMessage: c.status,
            })}
          </ToneBadge>
        </Flex>
      ))}
    </Flex>
  );

  const header = canManage && (canEdit(order, 'RECALCULATE_DISCOUNTS') || canAddManualDiscount(order)) && (
    <Flex gap={2} alignItems="center">
      {canEdit(order, 'RECALCULATE_DISCOUNTS') && (
        <Button size="S" variant="secondary" onClick={() => setModal({ kind: 'RECALCULATE' })}>
          {t('ecommerce.orders.discounts.recalculate')}
        </Button>
      )}
      {canAddManualDiscount(order) && (
        <Button size="S" variant="secondary" onClick={() => setModal({ kind: 'ADD' })}>
          {t('ecommerce.orders.discounts.add')}
        </Button>
      )}
    </Flex>
  );

  const hasRows = rows.length > 0 || manualRows.length > 0 || lineRows.length > 0;

  return (
    <OrderSection id={id} title={title} actions={header || undefined}>
      {!hasRows && !enteredCodes ? (
        <EmptyNote>{t('ecommerce.orders.promotions.empty')}</EmptyNote>
      ) : (
        <Flex direction="column" alignItems="stretch" gap={4}>
          {hasRows && (
            <DiscountsTable
              rows={rows}
              manualRows={manualRows.map(({ discount: m, actions }) => {
                const percent = manualDiscountPercent(m, uiLocale);
                return {
                  key: `m-${m.id}`,
                  reason: manualReason(m),
                  detail: percent ? `${percent} (${money(m.amount)})` : null,
                  amount: m.amount,
                  action: actions.includes('REMOVE') ? (
                    <Button size="S" variant="danger-light" onClick={() => setModal({ kind: 'REMOVE', discount: m })}>
                      {t('ecommerce.orders.discounts.remove')}
                    </Button>
                  ) : undefined,
                };
              })}
              lineRows={lineRows}
              total={orderDiscountTotal(promotions, order.manualDiscounts ?? []) + manualLineDiscountTotal(lineRows)}
              showActions={showActions}
            />
          )}
          {enteredCodes}
        </Flex>
      )}

      {canManage && modal?.kind === 'RECALCULATE' && (
        <RecalculateDiscountsModal
          order={order}
          locales={locales}
          permissions={permissions}
          onClose={closeModal}
          onSaved={onEdited}
          onAction={balanceAction}
        />
      )}
      {canManage && modal?.kind === 'ADD' && (
        <ManualDiscountModal
          order={order}
          permissions={permissions}
          onClose={closeModal}
          onSaved={onEdited}
          onAction={balanceAction}
        />
      )}
      {canManage && modal?.kind === 'REMOVE' && (
        <RemoveDiscountModal
          order={order}
          discount={modal.discount}
          reason={manualReason(modal.discount)}
          onClose={closeModal}
          onSaved={onEdited}
        />
      )}
    </OrderSection>
  );
};

/**
 * Confirm removing a manual discount; once removed it closes (what is owed shows in the order's
 * notice). Mounted only while open: each opening mints one operationId.
 */
const RemoveDiscountModal = ({
  order,
  discount,
  reason,
  onClose,
  onSaved,
}: {
  order: Order;
  discount: ManualDiscount;
  reason: string;
  onClose: () => void;
  onSaved: (result: EditResult) => void;
}) => {
  const { formatMessage, locale } = useIntl();
  const { toggleNotification } = useNotification();
  const t = (id: string, values?: Record<string, any>) => formatMessage({ id: getTranslation(id) }, values);
  const [operationId] = useState(() => mintUuid());
  const [busy, setBusy] = useState(false);

  /** Removes the discount and closes: what is then owed shows in the order's notice. */
  const remove = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await new RemoveManualDiscount().execute(order.id, discount.id, { operationId });
      onSaved(result);
      toggleNotification({ type: 'success', message: t('ecommerce.orders.discounts.saved') });
      onClose();
    } catch (err) {
      toggleNotification({
        type: 'danger',
        message: t(apiErrorMessageId(err, 'ecommerce.orders.discounts.saveError')),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal.Root open onOpenChange={(next: boolean) => !next && !busy && onClose()}>
      <Modal.Content>
        <Modal.Header>
          <Modal.Title>{t('ecommerce.orders.discounts.removeTitle')}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Typography style={WRAP}>
            {t('ecommerce.orders.discounts.removeConfirm', {
              reason,
              amount: formatCents(discount.amount, locale),
            })}
          </Typography>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="tertiary" onClick={onClose} disabled={busy}>
            {t('ecommerce.orders.discounts.close')}
          </Button>
          <Button variant="danger-light" onClick={remove} loading={busy}>
            {t('ecommerce.orders.discounts.remove')}
          </Button>
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
};

export default PromotionsSection;
