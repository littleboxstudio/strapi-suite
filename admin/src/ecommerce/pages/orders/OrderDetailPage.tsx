import { useCallback, useEffect, useRef, useState } from 'react';
import { useIntl } from 'react-intl';
import { useNavigate, useParams } from 'react-router-dom';
import { useNotification } from '@strapi/strapi/admin';
import { Flex, Grid, IconButton, Loader, Typography } from '@strapi/design-system';
import { ArrowLeft } from '@strapi/icons';
import config from '../../../core/config';
import ConfirmModal from '../../../components/ConfirmModal';
import { getTranslation } from '../../../core/utils/getTranslation';
import FetchOrder from '../../usecases/orders/fetchOrder';
import CancelOrder from '../../usecases/orders/cancelOrder';
import ArchiveOrder from '../../usecases/orders/archiveOrder';
import { useOrderPermissions } from '../../hooks/useOrderPermissions';
import { usePaymentPermissions } from '../../hooks/usePaymentPermissions';
import { apiErrorMessageId, type ToolbarAction } from '../../utils/orderDetail';
import type { RefundInitial } from '../../utils/refundForm';
import type { ModificationApplied, Order } from '../../orderTypes';
import OrderHeader from '../../components/orders/OrderHeader';
import OrderSection from '../../components/orders/OrderSection';
import OrderLinesTable from '../../components/orders/OrderLinesTable';
import FinancialSummary from '../../components/orders/FinancialSummary';
import CustomerCard from '../../components/orders/CustomerCard';
import AddressCard from '../../components/orders/AddressCard';
import PaymentsTable from '../../components/orders/PaymentsTable';
import AddPaymentModal from '../../components/orders/AddPaymentModal';
import CancelOrderModal from '../../components/orders/CancelOrderModal';
import HistoryTimeline from '../../components/orders/HistoryTimeline';
import SectionPlaceholder from '../../components/orders/SectionPlaceholder';
import ModifyOrderModal from '../../components/orders/ModifyOrderModal';
import SupplementaryPaymentModal from '../../components/orders/SupplementaryPaymentModal';
import PaymentInstructionsModal from '../../components/orders/PaymentInstructionsModal';
import RefundModal from '../../components/orders/RefundModal';
import RefundsTable from '../../components/orders/RefundsTable';
import NotificationsSection from '../../components/orders/NotificationsSection';
import ShipmentsSection from '../../components/orders/ShipmentsSection';
import ReturnsSection from '../../components/orders/ReturnsSection';
import ShipOrderModal from '../../components/orders/ShipOrderModal';
import RegisterReturnModal from '../../components/orders/RegisterReturnModal';

/** Order management screen (requirements 3–8). The fetched order is the single source of truth. */
const OrderDetailPage = () => {
  const { formatMessage } = useIntl();
  const navigate = useNavigate();
  const { toggleNotification } = useNotification();
  const params = useParams<{ id: string }>();
  const orderId = Number(params.id);
  const basePath = `/plugins/${config.pluginId}/ecommerce/orders`;
  const t = (id: string, values?: Record<string, any>) =>
    formatMessage({ id: getTranslation(id) }, values);

  const { canManage } = useOrderPermissions();
  const { canPay, canRefund } = usePaymentPermissions();
  const permissions = { canManage, canPay, canRefund };

  const [order, setOrder] = useState<Order | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [modal, setModal] = useState<ToolbarAction | null>(null);
  // Remounts the confirm dialogs on each opening (they can close themselves on Escape).
  const [modalKey, setModalKey] = useState(0);
  const [busy, setBusy] = useState(false);
  // Bumped on every order (re)load: refunds and notifications refetch with it.
  const [version, setVersion] = useState(0);
  // Opened after a modification leaves an amount due (requirement 16.7).
  const [supplementary, setSupplementary] = useState(false);
  // Prefill of the refund modal when it opens from "Refund now" after a return.
  const [refundInitial, setRefundInitial] = useState<RefundInitial | undefined>(undefined);
  const hasOrderRef = useRef(false);
  // Only the latest request may update the page (navigation, quick successive refetches).
  const requestRef = useRef(0);

  const load = useCallback(async (): Promise<void> => {
    const request = ++requestRef.current;
    try {
      const fetched = await new FetchOrder().execute(orderId);
      if (request === requestRef.current) {
        hasOrderRef.current = true;
        setOrder(fetched);
        setVersion((v) => v + 1);
        setLoadError(false);
      }
    } catch {
      if (request !== requestRef.current) return;
      // A failed refetch keeps the order on screen; only a first load shows the error.
      if (hasOrderRef.current) {
        toggleNotification({ type: 'danger', message: t('ecommerce.orders.detail.refreshError') });
      } else {
        setLoadError(true);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  useEffect(() => {
    hasOrderRef.current = false;
    setOrder(null);
    setLoadError(false);
    setModal(null);
    setSupplementary(false);
    if (!Number.isInteger(orderId) || orderId < 1) {
      setLoadError(true);
      return undefined;
    }
    load();
    return () => {
      requestRef.current += 1;
    };
  }, [orderId, load]);

  const closeModal = () => setModal(null);

  /** After an action: close the modal and refetch the order. */
  const afterChange = async () => {
    setModal(null);
    await load();
  };

  /**
   * After a modification: show the order the apply returned (refetch only if it is missing),
   * then ask for the amount due or flag the refundable excess.
   */
  const afterModification = async (result: ModificationApplied) => {
    setModal(null);
    if (result.order) {
      // Supersedes any refetch still in flight.
      requestRef.current += 1;
      hasOrderRef.current = true;
      setOrder(result.order);
      setVersion((v) => v + 1);
      setLoadError(false);
    } else {
      await load();
    }
    if (result.outcome === 'DUE') {
      // Sending instructions needs payments.manage; without it the amount due stays on the order.
      if (canPay) setSupplementary(true);
      else toggleNotification({ type: 'info', message: t('ecommerce.orders.modify.due') });
    }
    else if (result.outcome === 'REFUNDABLE') {
      toggleNotification({ type: 'info', message: t('ecommerce.orders.modify.refundable') });
    }
  };

  const runTransition = async (action: 'CANCEL' | 'ARCHIVE') => {
    if (busy || !order) return;
    const key = action === 'CANCEL' ? 'cancel' : 'archive';
    setBusy(true);
    setModal(null);
    try {
      if (action === 'CANCEL') await new CancelOrder().execute(order.id);
      else await new ArchiveOrder().execute(order.id);
      toggleNotification({ type: 'success', message: t(`ecommerce.orders.detail.${key}.success`) });
    } catch (err) {
      // ACTION_NOT_AVAILABLE, SHIPMENT_PENDING (a cancel waits for the carrier), …
      toggleNotification({
        type: 'danger',
        message: t(apiErrorMessageId(err, `ecommerce.orders.detail.${key}.error`)),
      });
    } finally {
      await load();
      setBusy(false);
    }
  };

  const backButton = (
    <IconButton label={t('ecommerce.orders.back')} onClick={() => navigate(basePath)}>
      <ArrowLeft />
    </IconButton>
  );

  if (loadError) {
    return (
      <Flex gap={3} alignItems="center">
        {backButton}
        <Typography textColor="danger600">{t('ecommerce.orders.detail.loadError')}</Typography>
      </Flex>
    );
  }

  if (!order) {
    return (
      <Flex justifyContent="center" padding={8}>
        <Loader />
      </Flex>
    );
  }

  return (
    <Flex direction="column" alignItems="stretch" gap={6}>
      <OrderHeader
        order={order}
        back={backButton}
        permissions={permissions}
        busy={busy}
        onAction={(action) => {
          setModalKey((k) => k + 1);
          setRefundInitial(undefined);
          setModal(action);
        }}
      />

      <OrderSection title={t('ecommerce.orders.detail.lines.title')}>
        <OrderLinesTable lines={order.lines} />
      </OrderSection>

      <Grid.Root gap={6}>
        <Grid.Item col={8} s={12} direction="column" alignItems="stretch">
          <Flex direction="column" alignItems="stretch" gap={6}>
            <OrderSection title={t('ecommerce.orders.detail.payments.title')}>
              <PaymentsTable payments={order.payments} />
            </OrderSection>
            <SectionPlaceholder title={t('ecommerce.orders.detail.sections.invoices')} />
            <ShipmentsSection
              title={t('ecommerce.orders.detail.sections.shipments')}
              orderStatus={order.orderStatus}
              deliveryStatus={order.shipping.deliveryStatus}
              shipments={order.shipments}
              canManage={canManage}
              onChanged={load}
            />
            <ReturnsSection title={t('ecommerce.orders.detail.sections.returns')} returns={order.returns} />
            <OrderSection title={t('ecommerce.orders.detail.sections.refunds')}>
              <RefundsTable
                orderId={order.id}
                summaries={order.refunds}
                refreshKey={version}
                canRefund={canRefund}
                onChanged={load}
              />
            </OrderSection>
            <SectionPlaceholder title={t('ecommerce.orders.detail.sections.promotions')} />
          </Flex>
        </Grid.Item>
        <Grid.Item col={4} s={12} direction="column" alignItems="stretch">
          <Flex direction="column" alignItems="stretch" gap={6}>
            <OrderSection title={t('ecommerce.orders.detail.summary.title')}>
              <FinancialSummary totals={order.totals} summary={order.summary} />
            </OrderSection>
            <CustomerCard customer={order.customer} />
            <AddressCard title={t('ecommerce.orders.detail.address.shipping')} address={order.shippingAddress} />
            <AddressCard title={t('ecommerce.orders.detail.address.billing')} address={order.billingAddress} />
          </Flex>
        </Grid.Item>
      </Grid.Root>

      <NotificationsSection orderId={order.id} refreshKey={version} canResend={canManage} />

      <OrderSection title={t('ecommerce.orders.detail.history.title')}>
        <HistoryTimeline history={order.history} />
      </OrderSection>

      {canManage && modal === 'MODIFY' && (
        <ModifyOrderModal order={order} onClose={closeModal} onApplied={afterModification} />
      )}
      {canPay && supplementary && (
        <SupplementaryPaymentModal
          orderId={order.id}
          reference={order.reference}
          locale={order.locale}
          total={order.totals.total}
          paid={order.summary.paid}
          due={order.summary.due}
          onClose={() => setSupplementary(false)}
          onSent={() => {
            setSupplementary(false);
            load();
          }}
        />
      )}
      {canPay && modal === 'SEND_PAYMENT_INSTRUCTIONS' && (
        <PaymentInstructionsModal
          orderId={order.id}
          reference={order.reference}
          locale={order.locale}
          due={order.summary.due}
          onClose={closeModal}
          onSent={afterChange}
        />
      )}
      {canRefund && modal === 'REFUND' && (
        <RefundModal
          orderId={order.id}
          reference={order.reference}
          initial={refundInitial}
          onClose={closeModal}
          onRefunded={afterChange}
        />
      )}
      {canManage && modal === 'SHIP' && (
        <ShipOrderModal order={order} onClose={closeModal} onShipped={afterChange} />
      )}
      {canManage && modal === 'REGISTER_RETURN' && (
        <RegisterReturnModal
          order={order}
          canRefund={canRefund}
          onClose={(changed) => (changed ? afterChange() : closeModal())}
          onRefundNow={(initial) => {
            // The refund modal reads its amounts from a fresh preview; the order reloads behind it.
            setRefundInitial(initial);
            setModal('REFUND');
            load();
          }}
        />
      )}
      {canManage && modal === 'ADD_PAYMENT' && (
        <AddPaymentModal orderId={order.id} due={order.summary.due} onClose={closeModal} onAdded={afterChange} />
      )}
      <CancelOrderModal
        key={`cancel-${modalKey}`}
        open={canManage && modal === 'CANCEL'}
        reference={order.reference}
        onConfirm={() => runTransition('CANCEL')}
        onClose={closeModal}
      />
      <ConfirmModal
        key={`archive-${modalKey}`}
        open={canManage && modal === 'ARCHIVE'}
        title={t('ecommerce.orders.detail.archive.title')}
        text={t('ecommerce.orders.detail.archive.text', { reference: order.reference })}
        confirm={{ button: t('ecommerce.orders.detail.archive.confirm'), action: () => runTransition('ARCHIVE') }}
        cancel={{ button: t('ecommerce.orders.detail.archive.back'), action: closeModal }}
      />
    </Flex>
  );
};

export { OrderDetailPage };
