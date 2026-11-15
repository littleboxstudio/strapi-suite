import { useState } from 'react';
import { useIntl } from 'react-intl';
import { useNotification } from '@strapi/strapi/admin';
import {
  Badge,
  Box,
  Button,
  Field,
  Flex,
  IconButton,
  Link,
  Loader,
  MenuItem,
  Modal,
  SimpleMenu,
  Table,
  Tbody,
  Td,
  Textarea,
  Th,
  Thead,
  Tr,
  Typography,
} from '@strapi/design-system';
import { More } from '@strapi/icons';
import { getTranslation } from '../../../core/utils/getTranslation';
import EmptyNote from './EmptyNote';
import CancelShipment from '../../usecases/orders/cancelShipment';
import FetchShipmentLabel from '../../usecases/orders/fetchShipmentLabel';
import RefreshShipmentTracking from '../../usecases/orders/refreshShipmentTracking';
import RetryShipment from '../../usecases/orders/retryShipment';
import MarkShipmentFailed from '../../usecases/orders/markShipmentFailed';
import { apiErrorMessageId, type ToolbarAction } from '../../utils/orderDetail';
import { STORE_PICKUP_ID } from '../../utils/pickupPoints';
import {
  MAX_CANCEL_REASON,
  cancelWarningId,
  isHttpUrl,
  isRetryUnsafeShipment,
  isStuckPendingShipment,
  isUncertainShipment,
  shipmentActions,
  type ShipmentAction,
} from '../../utils/shipmentForm';
import type {
  CancelledShipmentView,
  EditResult,
  Order,
  OrderDeliveryStatus,
  OrderStatus,
  ShipmentView,
} from '../../orderTypes';
import ShippingAddressModal from './ShippingAddressModal';
import DeliveryModal from './DeliveryModal';
import TrackingModal from './TrackingModal';
import ShipmentEventsModal from './ShipmentEventsModal';
import OrderSection from './OrderSection';
import ColumnLabel from '../ColumnLabel';

type Props = {
  id?: string;
  title: string;
  orderStatus: OrderStatus;
  deliveryStatus: OrderDeliveryStatus;
  shipments: ShipmentView[];
  /** The order: its shipping address and which edits it offers. */
  order: Order;
  /** `orders.manage`: deliver, tracking, refresh, retry, cancel, and the shipping edits. */
  canManage: boolean;
  /** After any change: the order is fetched again. */
  onChanged: () => void;
  /** After a shipping edit: the order it returned. */
  onEdited: (result: EditResult) => void;
  /** A balance button of an edit's result step (add payment, refund, …). */
  onAction: (action: ToolbarAction) => void;
  /** The section's own actions (Ship), allowed for this order and user. */
  sectionActions?: ToolbarAction[];
  /** An order action is running: the section's actions wait. */
  actionBusy?: boolean;
};


type Variant = 'warning' | 'success' | 'neutral' | 'danger' | 'secondary' | 'alternative' | 'primary';

const STATUS_VARIANT: Record<string, Variant> = {
  PENDING: 'warning',
  ACTIVE: 'success',
  FAILED: 'danger',
  CANCELLED: 'neutral',
};
const DELIVERY_VARIANT: Record<string, Variant> = {
  IN_TRANSIT: 'secondary',
  DELIVERED: 'success',
  EXCEPTION: 'danger',
};
const ORDER_DELIVERY_VARIANT: Record<OrderDeliveryStatus, Variant> = {
  NONE: 'neutral',
  IN_TRANSIT: 'secondary',
  PARTIALLY_DELIVERED: 'alternative',
  DELIVERED: 'success',
};

// The cost is shown under the carrier and the actions sit in one menu, so the row fits the admin width.
const COLUMNS = ['date', 'carrier', 'items', 'tracking', 'status', 'delivery', 'actions'] as const;

/** Shipments and deliveries of the order (requirement 9.5). */
const ShipmentsSection = ({
  id,
  title,
  orderStatus,
  deliveryStatus,
  shipments,
  order,
  canManage,
  onChanged,
  onEdited,
  onAction,
  sectionActions = [],
  actionBusy = false,
}: Props) => {
  const { formatMessage, formatDate } = useIntl();
  const { toggleNotification } = useNotification();
  const t = (id: string, values?: Record<string, any>, defaultMessage?: string) =>
    formatMessage({ id: getTranslation(id), defaultMessage }, values);
  const date = (iso: string | null) => (iso ? formatDate(iso, { dateStyle: 'medium', timeStyle: 'short' }) : '—');

  const [viewingEvents, setViewingEvents] = useState<ShipmentView | null>(null);
  const [delivering, setDelivering] = useState<ShipmentView | null>(null);
  const [tracking, setTracking] = useState<ShipmentView | null>(null);
  const [cancelling, setCancelling] = useState<ShipmentView | null>(null);
  const [markingFailed, setMarkingFailed] = useState<ShipmentView | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<number | null>(null);

  const errorMessage = (err: unknown, fallback: string) => t(apiErrorMessageId(err, fallback));

  const run = async (s: ShipmentView, work: () => Promise<ShipmentView | void>, success: string, fallback: string) => {
    if (busy !== null) return;
    setBusy(s.id);
    try {
      const result = await work();
      // A retry can still end without an answer from the carrier.
      const stillUncertain = !!result && isUncertainShipment(result);
      // A carrier without a cancel API (DPD): cancelled here only.
      const cancelElsewhere = !!result && (result as CancelledShipmentView).carrierCancelled === false;
      toggleNotification({
        type: stillUncertain || cancelElsewhere ? 'warning' : 'success',
        message: stillUncertain
          ? t('ecommerce.orders.ship.uncertain')
          : cancelElsewhere
            ? `${t(success)} ${t('ecommerce.orders.shipments.cancel.manualCarrier')}`
            : t(success),
      });
    } catch (err) {
      toggleNotification({ type: 'danger', message: errorMessage(err, fallback) });
    } finally {
      setBusy(null);
      onChanged();
    }
  };

  const openLabel = async (s: ShipmentView) => {
    if (busy !== null) return;
    // Opened before the request so the browser does not treat it as an unsolicited popup.
    const win = window.open('', '_blank');
    if (win) win.opener = null;
    setBusy(s.id);
    try {
      const blob = await new FetchShipmentLabel().execute(s.id);
      const url = URL.createObjectURL(blob);
      if (win) {
        win.location.href = url;
      } else {
        const a = document.createElement('a');
        a.href = url;
        a.download = `label-${s.id}.pdf`;
        a.click();
      }
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      win?.close();
      toggleNotification({ type: 'danger', message: errorMessage(err, 'ecommerce.orders.shipments.label.error') });
    } finally {
      setBusy(null);
    }
  };

  const act = (s: ShipmentView, action: ShipmentAction) => {
    switch (action) {
      case 'DELIVER':
        setDelivering(s);
        break;
      case 'TRACKING':
        setTracking(s);
        break;
      case 'REFRESH':
        run(
          s,
          () => new RefreshShipmentTracking().execute(s.id),
          'ecommerce.orders.shipments.refresh.success',
          'ecommerce.orders.shipments.refresh.error'
        );
        break;
      case 'LABEL':
        openLabel(s);
        break;
      case 'RETRY':
        run(
          s,
          () => new RetryShipment().execute(s.id),
          'ecommerce.orders.shipments.retry.success',
          'ecommerce.orders.shipments.retry.error'
        );
        break;
      case 'MARK_FAILED':
        setMarkingFailed(s);
        break;
      case 'CANCEL':
        setReason('');
        setCancelling(s);
        break;
    }
  };

  const confirmMarkFailed = () => {
    const target = markingFailed;
    if (!target) return;
    setMarkingFailed(null);
    run(
      target,
      () => new MarkShipmentFailed().execute(target.id),
      'ecommerce.orders.shipments.markFailed.success',
      'ecommerce.orders.shipments.markFailed.error'
    );
  };

  const confirmCancel = () => {
    const target = cancelling;
    if (!target || reason.trim().length > MAX_CANCEL_REASON) return;
    setCancelling(null);
    run(
      target,
      () => new CancelShipment().execute(target.id, reason.trim() || undefined),
      'ecommerce.orders.shipments.cancel.success',
      'ecommerce.orders.shipments.cancel.error'
    );
  };

  const statusNote = (s: ShipmentView) => {
    // The carrier may create it twice (DPD): checked by hand, never retried.
    if (isRetryUnsafeShipment(s)) return { tone: 'warning600', text: t('ecommerce.orders.errors.CARRIER_RETRY_UNSAFE') };
    if (isUncertainShipment(s)) return { tone: 'warning600', text: t('ecommerce.orders.shipments.uncertainHint') };
    if (isStuckPendingShipment(s)) return { tone: 'warning600', text: t('ecommerce.orders.shipments.stuckHint') };
    if (s.status === 'PENDING') return { tone: 'neutral600', text: t('ecommerce.orders.shipments.pendingHint') };
    if (s.status === 'FAILED' && s.error) {
      return {
        tone: 'danger600',
        text: t(`ecommerce.orders.errors.${s.error}`, undefined, t('ecommerce.orders.shipments.failedHint')),
      };
    }
    return null;
  };

  /** The order's delivery status, next to the section title. */
  const deliveryBadge = (
    <Badge variant={ORDER_DELIVERY_VARIANT[deliveryStatus] ?? 'neutral'} size="S">
      {t(`ecommerce.orders.shipments.orderDelivery.${deliveryStatus}`, undefined, deliveryStatus)}
    </Badge>
  );

  const header = (
    <Flex gap={4} alignItems="center">
      <ShippingAddressModal order={order} canManage={canManage} onSaved={onEdited} />
      {sectionActions.map((action) => (
        <Button key={action} size="S" variant="secondary" disabled={actionBusy} onClick={() => onAction(action)}>
          {t(`ecommerce.orders.detail.actions.${action}`)}
        </Button>
      ))}
    </Flex>
  );

  return (
    <OrderSection id={id} title={title} titleAside={deliveryBadge} actions={header}>
      {shipments.length === 0 ? (
        <EmptyNote>{t('ecommerce.orders.shipments.empty')}</EmptyNote>
      ) : (
        <Box style={{ overflowX: 'auto' }}>
          <Table colCount={COLUMNS.length} rowCount={shipments.length + 1}>
            <Thead>
              <Tr>
                {COLUMNS.map((c) => (
                  <Th key={c}>
                    <ColumnLabel column={c}>{t(`ecommerce.orders.shipments.columns.${c}`)}</ColumnLabel>
                  </Th>
                ))}
              </Tr>
            </Thead>
            <Tbody>
              {shipments.map((s) => {
                const actions = shipmentActions(s, { orderStatus, canManage });
                const note = statusNote(s);
                return (
                  <Tr key={s.id}>
                    <Td>
                      <Flex direction="column" alignItems="flex-start">
                        <Typography textColor="neutral800" fontWeight="semiBold">
                          #{s.id}
                        </Typography>
                        <Typography variant="pi" textColor="neutral600">
                          {date(s.shippedAt ?? s.createdAt)}
                        </Typography>
                      </Flex>
                    </Td>
                    <Td>
                      <Typography textColor="neutral800">{s.carrierName}</Typography>
                    </Td>
                    <Td>
                      {/* Long product names wrap inside the column instead of running over the next ones. */}
                      <Flex direction="column" alignItems="flex-start" gap={1} style={{ minWidth: 180, maxWidth: 280 }}>
                        {s.items.map((i) => (
                          <Typography
                            key={i.orderLineId}
                            variant="pi"
                            textColor="neutral800"
                            style={{ whiteSpace: 'normal', wordBreak: 'break-word', overflowWrap: 'anywhere' }}
                          >
                            {i.quantity} × {i.name}
                            {i.option ? ` (${i.option})` : ''} · {i.sku}
                          </Typography>
                        ))}
                      </Flex>
                    </Td>
                    <Td style={{ maxWidth: 200 }}>
                      {s.providerId === STORE_PICKUP_ID ? (
                        // Store pickup has no tracking: the store it was made ready at.
                        <Flex direction="column" alignItems="flex-start">
                          <Typography textColor="neutral800" ellipsis>
                            {s.store?.name || '—'}
                          </Typography>
                          {s.store && (
                            <Typography variant="pi" textColor="neutral600" ellipsis>
                              {s.store.city}
                            </Typography>
                          )}
                        </Flex>
                      ) : (
                        <Flex direction="column" alignItems="flex-start">
                          <Typography textColor="neutral800" ellipsis>
                            {s.trackingCode || '—'}
                          </Typography>
                          {s.trackingUrl && isHttpUrl(s.trackingUrl) && (
                            <Link href={s.trackingUrl} isExternal>
                              {t('ecommerce.orders.shipments.track')}
                            </Link>
                          )}
                          {s.pickupPoint && (
                            // DPD Pickup: the point it was shipped to.
                            <Typography variant="pi" textColor="neutral600" ellipsis>
                              {[s.pickupPoint.name, s.pickupPoint.city].filter(Boolean).join(' · ')}
                            </Typography>
                          )}
                        </Flex>
                      )}
                    </Td>
                    <Td>
                      <Flex direction="column" alignItems="flex-start" gap={1}>
                        <Badge variant={STATUS_VARIANT[s.status] ?? 'neutral'} size="S">
                          {t(`ecommerce.orders.shipments.statuses.${s.status}`, undefined, s.status)}
                        </Badge>
                        {note && (
                          // The cell does not wrap by default: the note keeps to its column.
                          <Typography
                            variant="pi"
                            textColor={note.tone}
                            style={{ display: 'block', width: 220, whiteSpace: 'normal', overflowWrap: 'anywhere' }}
                          >
                            {note.text}
                          </Typography>
                        )}
                      </Flex>
                    </Td>
                    <Td>
                      {s.status === 'ACTIVE' && s.deliveryStatus ? (
                        // The delivery date is in the shipment's events.
                        <Badge variant={DELIVERY_VARIANT[s.deliveryStatus] ?? 'neutral'} size="S">
                          {t(`ecommerce.orders.shipments.delivery.${s.deliveryStatus}`, undefined, s.deliveryStatus)}
                        </Badge>
                      ) : (
                        <Typography textColor="neutral600">—</Typography>
                      )}
                    </Td>
                    <Td>
                      <Flex justifyContent="flex-end">
                        {busy === s.id ? (
                          <Loader small />
                        ) : (
                          (actions.length > 0 || s.events.length > 0) && (
                            <SimpleMenu
                              tag={IconButton}
                              icon={<More />}
                              label={t('ecommerce.orders.shipments.moreActions', { id: s.id })}
                              disabled={busy !== null}
                              popoverPlacement="bottom-end"
                            >
                              {actions.map((a) => (
                                <MenuItem
                                  key={a}
                                  variant={a === 'CANCEL' ? 'danger' : 'default'}
                                  onSelect={() => act(s, a)}
                                >
                                  {t(`ecommerce.orders.shipments.actions.${a}`)}
                                </MenuItem>
                              ))}
                              {s.events.length > 0 && (
                                <MenuItem onSelect={() => setViewingEvents(s)}>
                                  {t('ecommerce.orders.shipments.showEvents', { count: s.events.length })}
                                </MenuItem>
                              )}
                            </SimpleMenu>
                          )
                        )}
                      </Flex>
                    </Td>
                  </Tr>
                );
              })}
            </Tbody>
          </Table>
        </Box>
      )}

      {viewingEvents && <ShipmentEventsModal shipment={viewingEvents} onClose={() => setViewingEvents(null)} />}

      {canManage && delivering && (
        <DeliveryModal
          shipment={delivering}
          onClose={() => setDelivering(null)}
          onDelivered={() => {
            setDelivering(null);
            onChanged();
          }}
        />
      )}
      {canManage && tracking && (
        <TrackingModal
          shipment={tracking}
          onClose={() => setTracking(null)}
          onSaved={() => {
            setTracking(null);
            onChanged();
          }}
        />
      )}
      {canManage && cancelling && (
        <Modal.Root open onOpenChange={(next: boolean) => !next && setCancelling(null)}>
          <Modal.Content>
            <Modal.Header>
              <Modal.Title>{t('ecommerce.orders.shipments.cancel.title', { id: cancelling.id })}</Modal.Title>
            </Modal.Header>
            <Modal.Body>
              <Flex direction="column" alignItems="stretch" gap={4}>
                <Box padding={3} background="danger100" hasRadius>
                  <Typography variant="omega" textColor="danger700">
                    {t(cancelWarningId(cancelling))}
                  </Typography>
                </Box>
                <Field.Root
                  name="reason"
                  error={reason.trim().length > MAX_CANCEL_REASON ? t('ecommerce.orders.errors.too_long') : undefined}
                >
                  <Field.Label>{t('ecommerce.orders.shipments.cancel.reason')}</Field.Label>
                  <Textarea value={reason} onChange={(e: any) => setReason(e.target.value)} />
                  <Field.Error />
                </Field.Root>
              </Flex>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="tertiary" onClick={() => setCancelling(null)}>
                {t('ecommerce.orders.shipments.back')}
              </Button>
              <Button variant="danger" disabled={reason.trim().length > MAX_CANCEL_REASON} onClick={confirmCancel}>
                {t('ecommerce.orders.shipments.cancel.confirm')}
              </Button>
            </Modal.Footer>
          </Modal.Content>
        </Modal.Root>
      )}
      {canManage && markingFailed && (
        <Modal.Root open onOpenChange={(next: boolean) => !next && setMarkingFailed(null)}>
          <Modal.Content>
            <Modal.Header>
              <Modal.Title>{t('ecommerce.orders.shipments.markFailed.title', { id: markingFailed.id })}</Modal.Title>
            </Modal.Header>
            <Modal.Body>
              <Box padding={3} background="warning100" hasRadius>
                <Typography variant="omega" textColor="warning700">
                  {t('ecommerce.orders.shipments.markFailed.warning', { carrier: markingFailed.carrierName })}
                </Typography>
              </Box>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="tertiary" onClick={() => setMarkingFailed(null)}>
                {t('ecommerce.orders.shipments.back')}
              </Button>
              <Button variant="danger" onClick={confirmMarkFailed}>
                {t('ecommerce.orders.shipments.markFailed.confirm')}
              </Button>
            </Modal.Footer>
          </Modal.Content>
        </Modal.Root>
      )}
    </OrderSection>
  );
};

export default ShipmentsSection;
