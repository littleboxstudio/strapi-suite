import { Fragment, useState } from 'react';
import { useIntl } from 'react-intl';
import { useNotification } from '@strapi/strapi/admin';
import {
  Badge,
  Box,
  Button,
  Field,
  Flex,
  Link,
  Modal,
  Table,
  Tbody,
  Td,
  Textarea,
  Th,
  Thead,
  Tr,
  Typography,
} from '@strapi/design-system';
import { getTranslation } from '../../../core/utils/getTranslation';
import EmptyShipping from '../../illustrations/EmptyShipping';
import CancelShipment from '../../usecases/orders/cancelShipment';
import FetchShipmentLabel from '../../usecases/orders/fetchShipmentLabel';
import RefreshShipmentTracking from '../../usecases/orders/refreshShipmentTracking';
import RetryShipment from '../../usecases/orders/retryShipment';
import { formatCents } from '../../utils/money';
import { apiErrorMessageId } from '../../utils/orderDetail';
import {
  MAX_CANCEL_REASON,
  isHttpUrl,
  isUncertainShipment,
  shipmentActions,
  type ShipmentAction,
} from '../../utils/shipmentForm';
import type { OrderDeliveryStatus, OrderStatus, ShipmentView } from '../../orderTypes';
import DeliveryModal from './DeliveryModal';
import TrackingModal from './TrackingModal';
import OrderSection from './OrderSection';

type Props = {
  title: string;
  orderStatus: OrderStatus;
  deliveryStatus: OrderDeliveryStatus;
  shipments: ShipmentView[];
  /** `orders.manage`: deliver, tracking, refresh, retry, cancel. */
  canManage: boolean;
  /** After any change: the order is fetched again. */
  onChanged: () => void;
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

const COLUMNS = ['date', 'carrier', 'items', 'tracking', 'cost', 'status', 'delivery', 'actions'] as const;

/** Shipments and deliveries of the order (requirement 9.5). */
const ShipmentsSection = ({ title, orderStatus, deliveryStatus, shipments, canManage, onChanged }: Props) => {
  const { formatMessage, formatDate, locale: uiLocale } = useIntl();
  const { toggleNotification } = useNotification();
  const t = (id: string, values?: Record<string, any>, defaultMessage?: string) =>
    formatMessage({ id: getTranslation(id), defaultMessage }, values);
  const money = (cents: number) => formatCents(cents, uiLocale);
  const date = (iso: string | null) => (iso ? formatDate(iso, { dateStyle: 'medium', timeStyle: 'short' }) : '—');

  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [delivering, setDelivering] = useState<ShipmentView | null>(null);
  const [tracking, setTracking] = useState<ShipmentView | null>(null);
  const [cancelling, setCancelling] = useState<ShipmentView | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<number | null>(null);

  const toggle = (id: number) =>
    setExpanded((set) => {
      const next = new Set(set);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const errorMessage = (err: unknown, fallback: string) => t(apiErrorMessageId(err, fallback));

  const run = async (s: ShipmentView, work: () => Promise<ShipmentView | void>, success: string, fallback: string) => {
    if (busy !== null) return;
    setBusy(s.id);
    try {
      const result = await work();
      // A retry can still end without an answer from the carrier.
      const stillUncertain = !!result && isUncertainShipment(result);
      toggleNotification({
        type: stillUncertain ? 'warning' : 'success',
        message: t(stillUncertain ? 'ecommerce.orders.ship.uncertain' : success),
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
      case 'CANCEL':
        setReason('');
        setCancelling(s);
        break;
    }
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
    if (isUncertainShipment(s)) return { tone: 'warning600', text: t('ecommerce.orders.shipments.uncertainHint') };
    if (s.status === 'PENDING') return { tone: 'neutral600', text: t('ecommerce.orders.shipments.pendingHint') };
    if (s.status === 'FAILED' && s.error) {
      return {
        tone: 'danger600',
        text: t(`ecommerce.orders.errors.${s.error}`, undefined, t('ecommerce.orders.shipments.failedHint')),
      };
    }
    return null;
  };

  const header = (
    <Flex gap={2} alignItems="center">
      <Typography variant="pi" textColor="neutral600">
        {t('ecommerce.orders.shipments.deliveryStatus')}
      </Typography>
      <Badge variant={ORDER_DELIVERY_VARIANT[deliveryStatus] ?? 'neutral'} size="S">
        {t(`ecommerce.orders.shipments.orderDelivery.${deliveryStatus}`, undefined, deliveryStatus)}
      </Badge>
    </Flex>
  );

  return (
    <OrderSection title={title} actions={header}>
      {shipments.length === 0 ? (
        <Flex direction="column" alignItems="center" gap={2} paddingTop={2} paddingBottom={2}>
          <EmptyShipping size={96} />
          <Typography variant="pi" textColor="neutral600">
            {t('ecommerce.orders.shipments.empty')}
          </Typography>
        </Flex>
      ) : (
        <Box style={{ overflowX: 'auto' }}>
          <Table colCount={COLUMNS.length} rowCount={shipments.length + 1}>
            <Thead>
              <Tr>
                {COLUMNS.map((c) => (
                  <Th key={c}>
                    <Typography variant="sigma">{t(`ecommerce.orders.shipments.columns.${c}`)}</Typography>
                  </Th>
                ))}
              </Tr>
            </Thead>
            <Tbody>
              {shipments.map((s) => {
                const actions = shipmentActions(s, { orderStatus, canManage });
                const note = statusNote(s);
                const open = expanded.has(s.id);
                return (
                  <Fragment key={s.id}>
                    <Tr>
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
                      <Td style={{ maxWidth: 240 }}>
                        <Flex direction="column" alignItems="flex-start">
                          {s.items.map((i) => (
                            <Typography key={i.orderLineId} variant="pi" textColor="neutral800" ellipsis>
                              {i.quantity} × {i.name}
                              {i.option ? ` (${i.option})` : ''} · {i.sku}
                            </Typography>
                          ))}
                        </Flex>
                      </Td>
                      <Td style={{ maxWidth: 200 }}>
                        <Flex direction="column" alignItems="flex-start">
                          <Typography textColor="neutral800" ellipsis>
                            {s.trackingCode || '—'}
                          </Typography>
                          {s.trackingUrl && isHttpUrl(s.trackingUrl) && (
                            <Link href={s.trackingUrl} isExternal>
                              {t('ecommerce.orders.shipments.track')}
                            </Link>
                          )}
                        </Flex>
                      </Td>
                      <Td>
                        <Typography textColor="neutral800">{money(s.shippingCost)}</Typography>
                      </Td>
                      <Td>
                        <Flex direction="column" alignItems="flex-start" gap={1}>
                          <Badge variant={STATUS_VARIANT[s.status] ?? 'neutral'} size="S">
                            {t(`ecommerce.orders.shipments.statuses.${s.status}`, undefined, s.status)}
                          </Badge>
                          {note && (
                            <Typography variant="pi" textColor={note.tone} style={{ maxWidth: 220 }}>
                              {note.text}
                            </Typography>
                          )}
                        </Flex>
                      </Td>
                      <Td>
                        {s.status === 'ACTIVE' && s.deliveryStatus ? (
                          <Flex direction="column" alignItems="flex-start" gap={1}>
                            <Badge variant={DELIVERY_VARIANT[s.deliveryStatus] ?? 'neutral'} size="S">
                              {t(`ecommerce.orders.shipments.delivery.${s.deliveryStatus}`, undefined, s.deliveryStatus)}
                            </Badge>
                            {s.deliveredAt && (
                              <Typography variant="pi" textColor="neutral600">
                                {date(s.deliveredAt)}
                              </Typography>
                            )}
                          </Flex>
                        ) : (
                          <Typography textColor="neutral600">—</Typography>
                        )}
                      </Td>
                      <Td>
                        <Flex gap={1} justifyContent="flex-end" wrap="wrap">
                          {actions.map((a) => (
                            <Button
                              key={a}
                              size="S"
                              variant={a === 'CANCEL' ? 'danger-light' : a === 'DELIVER' || a === 'RETRY' ? 'secondary' : 'tertiary'}
                              disabled={busy !== null}
                              loading={busy === s.id && (a === 'REFRESH' || a === 'RETRY' || a === 'LABEL')}
                              onClick={() => act(s, a)}
                            >
                              {t(`ecommerce.orders.shipments.actions.${a}`)}
                            </Button>
                          ))}
                          {s.events.length > 0 && (
                            <Button size="S" variant="ghost" onClick={() => toggle(s.id)} aria-expanded={open}>
                              {t(open ? 'ecommerce.orders.shipments.hideEvents' : 'ecommerce.orders.shipments.showEvents', {
                                count: s.events.length,
                              })}
                            </Button>
                          )}
                        </Flex>
                      </Td>
                    </Tr>
                    {open && (
                      <Tr>
                        <Td colSpan={COLUMNS.length}>
                          <Flex direction="column" alignItems="stretch" gap={1} paddingTop={2} paddingBottom={2}>
                            {s.events.map((e, idx) => (
                              <Flex key={idx} gap={3} alignItems="flex-start">
                                <Typography variant="pi" textColor="neutral600" style={{ minWidth: 150 }}>
                                  {date(e.occurredAt)}
                                </Typography>
                                <Typography variant="pi" textColor="neutral800" fontWeight="semiBold">
                                  {t(`ecommerce.orders.shipments.eventTypes.${e.type}`, undefined, e.type)}
                                </Typography>
                                {e.description && (
                                  <Typography variant="pi" textColor="neutral700" style={{ wordBreak: 'break-word' }}>
                                    {e.description}
                                  </Typography>
                                )}
                                {e.source && (
                                  <Typography variant="pi" textColor="neutral500">
                                    {t(`ecommerce.orders.shipments.eventSources.${e.source}`, undefined, e.source)}
                                  </Typography>
                                )}
                              </Flex>
                            ))}
                          </Flex>
                        </Td>
                      </Tr>
                    )}
                  </Fragment>
                );
              })}
            </Tbody>
          </Table>
        </Box>
      )}

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
                    {t(
                      cancelling.providerId !== 'manual'
                        ? 'ecommerce.orders.shipments.cancel.carrierWarning'
                        : 'ecommerce.orders.shipments.cancel.warning'
                    )}
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
    </OrderSection>
  );
};

export default ShipmentsSection;
