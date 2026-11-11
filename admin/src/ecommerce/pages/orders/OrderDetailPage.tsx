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
import { isActionUnavailable, type ToolbarAction } from '../../utils/orderDetail';
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

  const [order, setOrder] = useState<Order | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [modal, setModal] = useState<ToolbarAction | null>(null);
  // Remounts the confirm dialogs on each opening (they can close themselves on Escape).
  const [modalKey, setModalKey] = useState(0);
  const [busy, setBusy] = useState(false);
  // Opened after a modification leaves an amount due (requirement 16.7).
  const [supplementary, setSupplementary] = useState(false);
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
      setLoadError(false);
    } else {
      await load();
    }
    if (result.outcome === 'DUE') setSupplementary(true);
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
      const unavailable = isActionUnavailable(err);
      toggleNotification({
        type: 'danger',
        message: t(unavailable ? 'ecommerce.orders.detail.actions.unavailable' : `ecommerce.orders.detail.${key}.error`),
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
        canManage={canManage}
        busy={busy}
        onAction={(action) => {
          setModalKey((k) => k + 1);
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
            <SectionPlaceholder title={t('ecommerce.orders.detail.sections.shipments')} />
            <SectionPlaceholder title={t('ecommerce.orders.detail.sections.refunds')} />
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

      <OrderSection title={t('ecommerce.orders.detail.history.title')}>
        <HistoryTimeline history={order.history} />
      </OrderSection>

      {canManage && modal === 'MODIFY' && (
        <ModifyOrderModal order={order} onClose={closeModal} onApplied={afterModification} />
      )}
      {supplementary && (
        <SupplementaryPaymentModal
          reference={order.reference}
          total={order.totals.total}
          paid={order.summary.paid}
          due={order.summary.due}
          onClose={() => setSupplementary(false)}
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
