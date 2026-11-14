import { useState } from 'react';
import { useIntl } from 'react-intl';
import { useNotification } from '@strapi/strapi/admin';
import { Badge, Button, Flex, Modal, Table, Tbody, Td, Th, Thead, Tr, Typography } from '@strapi/design-system';
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
  canEdit,
  hasRowActions,
  manualDiscountPercent,
  manualDiscountRows,
  manualLineDiscountRows,
  manualLineDiscountTotal,
  orderDiscountTotal,
} from '../../utils/orderEditing';
import { mintUuid } from '../../utils/variantDraft';
import { describeBenefit } from '../../utils/promotionForm';
import type { EditResult, ManualDiscount, Order, OrderPromotion, OrderPromotionCode } from '../../orderTypes';
import BalanceOutcome from './BalanceOutcome';
import ManualDiscountModal from './ManualDiscountModal';
import RecalculateDiscountsModal from './RecalculateDiscountsModal';
import OrderSection from './OrderSection';
import ColumnLabel from '../ColumnLabel';

const COLUMNS = ['promotion', 'method', 'type', 'benefit', 'amount', 'actions'] as const;

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
  const discount = (cents: number) => money(cents ? -cents : 0);
  const rows = promotionRows(promotions, locales);
  const unapplied = unappliedPromotionCodes(promotionCodes);
  const { canManage } = permissions;
  const manualRows = manualDiscountRows(order, canManage);
  // Spec 4.1: each line with a manual percent is listed too, so the total matches the order.
  const lineRows = manualLineDiscountRows(order.lines ?? [], uiLocale);
  const showActions = hasRowActions(manualRows);
  const columns = showActions ? COLUMNS : COLUMNS.filter((c) => c !== 'actions');

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
          <Badge size="S" variant={codeStatusBadgeVariant(c.status)}>
            {formatMessage({
              id: getTranslation(`ecommerce.orders.promotions.codeStatus.${c.status}`),
              defaultMessage: c.status,
            })}
          </Badge>
        </Flex>
      ))}
    </Flex>
  );

  const header = canManage && (canEdit(order, 'RECALCULATE_DISCOUNTS') || canEdit(order, 'ADD_DISCOUNT')) && (
    <Flex gap={2} alignItems="center">
      {canEdit(order, 'RECALCULATE_DISCOUNTS') && (
        <Button size="S" variant="secondary" onClick={() => setModal({ kind: 'RECALCULATE' })}>
          {t('ecommerce.orders.discounts.recalculate')}
        </Button>
      )}
      {canEdit(order, 'ADD_DISCOUNT') && (
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
            <Table colCount={columns.length} rowCount={rows.length + manualRows.length + lineRows.length + 2}>
              <Thead>
                <Tr>
                  {columns.map((c) => (
                    <Th key={c}>
                      <ColumnLabel column={c}>{t(`ecommerce.orders.promotions.columns.${c}`)}</ColumnLabel>
                    </Th>
                  ))}
                </Tr>
              </Thead>
              <Tbody>
                {rows.map((row) => (
                  <Tr key={row.key}>
                    <Td style={{ maxWidth: 260 }}>
                      <Flex direction="column" alignItems="flex-start" gap={1}>
                        <Typography textColor="neutral800" fontWeight="semiBold" ellipsis>
                          {row.displayName ?? t('ecommerce.orders.promotions.fallbackName')}
                        </Typography>
                        <Typography variant="pi" textColor="neutral500" ellipsis>
                          {t('ecommerce.orders.promotions.internalName', { name: row.name })}
                        </Typography>
                        {row.released && (
                          <Badge size="S" title={t('ecommerce.orders.promotions.releasedHint')}>
                            {t('ecommerce.orders.promotions.released')}
                          </Badge>
                        )}
                      </Flex>
                    </Td>
                    <Td>
                      <Flex direction="column" alignItems="flex-start">
                        <Typography textColor="neutral800">
                          {t(`ecommerce.promotions.methods.${row.method}`)}
                        </Typography>
                        {row.code && (
                          <Typography variant="pi" textColor="neutral600" fontWeight="semiBold">
                            {row.code}
                          </Typography>
                        )}
                      </Flex>
                    </Td>
                    <Td>
                      <Typography textColor="neutral800">
                        {t(`ecommerce.orders.promotions.classes.${row.discountClass}`)}
                      </Typography>
                    </Td>
                    <Td style={{ maxWidth: 320 }}>
                      <Typography textColor="neutral800">{describeBenefit(row.benefit, money, t)}</Typography>
                    </Td>
                    <Td>
                      <Typography textColor="neutral800" style={{ whiteSpace: 'nowrap' }}>
                        {discount(row.amount)}
                      </Typography>
                    </Td>
                    {showActions && <Td />}
                  </Tr>
                ))}
                {manualRows.map(({ discount: m, actions }) => {
                  const percent = manualDiscountPercent(m, uiLocale);
                  return (
                    <Tr key={`m-${m.id}`}>
                      <Td style={{ maxWidth: 260 }}>
                        <Typography textColor="neutral800" fontWeight="semiBold">
                          {t('ecommerce.orders.discounts.manualName')}
                        </Typography>
                      </Td>
                      <Td>
                        <Typography textColor="neutral800">{t('ecommerce.orders.discounts.manual')}</Typography>
                      </Td>
                      <Td>
                        <Typography textColor="neutral800">
                          {t('ecommerce.orders.promotions.classes.ORDER_DISCOUNT')}
                        </Typography>
                      </Td>
                      <Td style={{ maxWidth: 320 }}>
                        <Flex direction="column" alignItems="flex-start" gap={1}>
                          <Typography textColor="neutral800" style={{ overflowWrap: 'anywhere' }}>
                            {manualReason(m)}
                          </Typography>
                          {percent && (
                            <Typography variant="pi" textColor="neutral600">
                              {`${percent} (${money(m.amount)})`}
                            </Typography>
                          )}
                        </Flex>
                      </Td>
                      <Td>
                        <Typography textColor="neutral800" style={{ whiteSpace: 'nowrap' }}>
                          {discount(m.amount)}
                        </Typography>
                      </Td>
                      {showActions && (
                        <Td>
                          <Flex justifyContent="flex-end">
                            {actions.includes('REMOVE') && (
                              <Button size="S" variant="danger-light" onClick={() => setModal({ kind: 'REMOVE', discount: m })}>
                                {t('ecommerce.orders.discounts.remove')}
                              </Button>
                            )}
                          </Flex>
                        </Td>
                      )}
                    </Tr>
                  );
                })}
                {lineRows.map((r) => (
                  <Tr key={r.key}>
                    <Td style={{ maxWidth: 260 }}>
                      <Typography textColor="neutral800" fontWeight="semiBold">
                        {t('ecommerce.orders.discounts.manualLineName')}
                      </Typography>
                    </Td>
                    <Td>
                      <Typography textColor="neutral800">{t('ecommerce.orders.discounts.manual')}</Typography>
                    </Td>
                    <Td>
                      <Typography textColor="neutral800">
                        {t('ecommerce.orders.promotions.classes.PRODUCT_DISCOUNT')}
                      </Typography>
                    </Td>
                    <Td style={{ maxWidth: 320 }}>
                      <Typography textColor="neutral800" style={{ overflowWrap: 'anywhere' }}>
                        {r.label}
                      </Typography>
                    </Td>
                    <Td>
                      <Typography textColor="neutral800" style={{ whiteSpace: 'nowrap' }}>
                        {discount(r.amount)}
                      </Typography>
                    </Td>
                    {showActions && <Td />}
                  </Tr>
                ))}
                {/* The total: one cell across the first columns, the amount under Amount. */}
                <Tr>
                  <Td colSpan={4} style={{ textAlign: 'right', paddingRight: 15 }}>
                    <Typography fontWeight="bold" textColor="neutral800">
                      {t('ecommerce.orders.promotions.total')}
                    </Typography>
                  </Td>
                  <Td>
                    <Typography fontWeight="bold" textColor="neutral800" style={{ whiteSpace: 'nowrap' }}>
                      {discount(
                        orderDiscountTotal(promotions, order.manualDiscounts ?? []) +
                          manualLineDiscountTotal(lineRows)
                      )}
                    </Typography>
                  </Td>
                  {showActions && <Td />}
                </Tr>
              </Tbody>
            </Table>
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
          permissions={permissions}
          onClose={closeModal}
          onSaved={onEdited}
          onAction={balanceAction}
        />
      )}
    </OrderSection>
  );
};

/**
 * Confirm removing a manual discount, then the balance when money is due or refundable. Mounted
 * only while open: each opening mints one operationId.
 */
const RemoveDiscountModal = ({
  order,
  discount,
  reason,
  permissions,
  onClose,
  onSaved,
  onAction,
}: {
  order: Order;
  discount: ManualDiscount;
  reason: string;
  permissions: OrderActionPermissions;
  onClose: () => void;
  onSaved: (result: EditResult) => void;
  onAction: (action: ToolbarAction) => void;
}) => {
  const { formatMessage, locale } = useIntl();
  const { toggleNotification } = useNotification();
  const t = (id: string, values?: Record<string, any>) => formatMessage({ id: getTranslation(id) }, values);
  const [operationId] = useState(() => mintUuid());
  const [saved, setSaved] = useState<EditResult | null>(null);
  const [busy, setBusy] = useState(false);

  const remove = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await new RemoveManualDiscount().execute(order.id, discount.id, { operationId });
      onSaved(result);
      if (result.outcome === 'NONE') {
        toggleNotification({ type: 'success', message: t('ecommerce.orders.discounts.saved') });
        onClose();
      } else {
        setSaved(result);
      }
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
          {saved ? (
            <BalanceOutcome
              order={saved.order}
              outcome={saved.outcome as 'DUE' | 'REFUNDABLE'}
              permissions={permissions}
              onAction={onAction}
            />
          ) : (
            <Typography style={{ overflowWrap: 'anywhere' }}>
              {t('ecommerce.orders.discounts.removeConfirm', {
                reason,
                amount: formatCents(discount.amount, locale),
              })}
            </Typography>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="tertiary" onClick={onClose} disabled={busy}>
            {t('ecommerce.orders.discounts.close')}
          </Button>
          {!saved && (
            <Button variant="danger" onClick={remove} loading={busy}>
              {t('ecommerce.orders.discounts.remove')}
            </Button>
          )}
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
};

export default PromotionsSection;
