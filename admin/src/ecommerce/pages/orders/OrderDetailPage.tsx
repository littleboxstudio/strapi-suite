import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { useIntl } from 'react-intl';
import { useNavigate, useParams } from 'react-router-dom';
import { useNotification } from '@strapi/strapi/admin';
import { Box, Flex, Grid, IconButton, Loader, Typography } from '@strapi/design-system';
import { ArrowLeft } from '@strapi/icons';
import config from '../../../core/config';
import ConfirmModal from '../../../components/ConfirmModal';
import { getTranslation } from '../../../core/utils/getTranslation';
import FetchOrder from '../../usecases/orders/fetchOrder';
import FetchOrderLocales from '../../usecases/orders/fetchOrderLocales';
import CancelOrder from '../../usecases/orders/cancelOrder';
import ArchiveOrder from '../../usecases/orders/archiveOrder';
import { useOrderPermissions } from '../../hooks/useOrderPermissions';
import { usePaymentPermissions } from '../../hooks/usePaymentPermissions';
import { useInvoicingPermissions } from '../../hooks/useInvoicingPermissions';
import { hasUninvoicedPayments } from '../../utils/invoiceForm';
import { apiErrorMessageId, promotionDisplayName, type ToolbarAction } from '../../utils/orderDetail';
import { initialOrderModalState, orderModalReducer } from '../../utils/orderModals';
import type { InvoiceScopeInput, ModificationApplied, Order } from '../../orderTypes';
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
import PromotionsSection from '../../components/orders/PromotionsSection';
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
import InvoicesSection from '../../components/orders/InvoicesSection';
import IssueInvoiceModal from '../../components/orders/IssueInvoiceModal';

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
  const { canInvoice } = useInvoicingPermissions();
  const permissions = { canManage, canPay, canRefund };

  const [order, setOrder] = useState<Order | null>(null);
  const [loadError, setLoadError] = useState(false);
  // The open action modal; `modalKey` remounts it on each opening (new idempotency key, and the
  // confirm dialogs can close themselves on Escape). Closes are scoped to the modal asking.
  const [modals, dispatchModal] = useReducer(orderModalReducer, initialOrderModalState);
  const { modal, key: modalKey, refundInitial } = modals;
  const [busy, setBusy] = useState(false);
  // Bumped on every order (re)load: refunds and notifications refetch with it.
  const [version, setVersion] = useState(0);
  // Opened after a modification leaves an amount due (requirement 16.7).
  const [supplementary, setSupplementary] = useState(false);
  // The invoice being issued (one payment or the whole order); null when the modal is closed.
  const [invoiceScope, setInvoiceScope] = useState<InvoiceScopeInput | null>(null);
  const hasOrderRef = useRef(false);
  // Only the latest request may update the page (navigation, quick successive refetches).
  const requestRef = useRef(0);

  // The store's default locale: the promotion name when the order's locale has none.
  const [defaultLocale, setDefaultLocale] = useState<string | null>(null);
  const needsDefaultLocale =
    !!order &&
    defaultLocale === null &&
    (order.promotions ?? []).some((p) => !promotionDisplayName(p, order.locale));
  useEffect(() => {
    if (!needsDefaultLocale) return undefined;
    let cancelled = false;
    new FetchOrderLocales()
      .execute()
      .then((data) => {
        if (!cancelled) setDefaultLocale(data.defaultLocale);
      })
      .catch(() => {
        // Without it the neutral "Promotion" label is shown.
        if (!cancelled) setDefaultLocale('');
      });
    return () => {
      cancelled = true;
    };
  }, [needsDefaultLocale]);

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
    dispatchModal({ type: 'RESET' });
    setSupplementary(false);
    setInvoiceScope(null);
    if (!Number.isInteger(orderId) || orderId < 1) {
      setLoadError(true);
      return undefined;
    }
    load();
    return () => {
      requestRef.current += 1;
    };
  }, [orderId, load]);

  /** Closes `from` if it is still the open modal and not mid-request. */
  const closeModal = (from: ToolbarAction) => () => dispatchModal({ type: 'CLOSE', from });

  /** After `from`'s action succeeded: close it and refetch the order. */
  const afterChange = (from: ToolbarAction) => async () => {
    dispatchModal({ type: 'DONE', from });
    await load();
  };

  /**
   * After a modification: show the order the apply returned (refetch only if it is missing),
   * then ask for the amount due or flag the refundable excess.
   */
  const afterModification = async (result: ModificationApplied) => {
    dispatchModal({ type: 'DONE', from: 'MODIFY' });
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
    dispatchModal({ type: 'DONE', from: action });
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
        onAction={(action) => dispatchModal({ type: 'OPEN', action })}
      />

      <OrderSection title={t('ecommerce.orders.detail.lines.title')}>
        <OrderLinesTable
          lines={order.lines}
          promotions={order.promotions}
          locales={{ locale: order.locale, defaultLocale }}
        />
      </OrderSection>

      <Grid.Root gap={6}>
        <Grid.Item col={8} s={12} direction="column" alignItems="stretch">
          <Flex direction="column" alignItems="stretch" gap={6}>
            <OrderSection title={t('ecommerce.orders.detail.payments.title')}>
              <PaymentsTable
                payments={order.payments}
                canInvoice={canInvoice}
                billingActive={order.billing.active}
                onInvoice={(paymentId) => setInvoiceScope({ scope: 'PAYMENT', paymentId })}
              />
            </OrderSection>
            <InvoicesSection
              title={t('ecommerce.orders.detail.sections.invoices')}
              order={order}
              canInvoice={canInvoice}
              onIssue={setInvoiceScope}
              onChanged={load}
            />
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
            <PromotionsSection
              title={t('ecommerce.orders.detail.sections.promotions')}
              promotions={order.promotions ?? []}
              promotionCodes={order.promotionCodes}
              locales={{ locale: order.locale, defaultLocale }}
            />
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
        <ModifyOrderModal order={order} onClose={closeModal('MODIFY')} onApplied={afterModification} />
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
          onClose={closeModal('SEND_PAYMENT_INSTRUCTIONS')}
          onSent={afterChange('SEND_PAYMENT_INSTRUCTIONS')}
        />
      )}
      {/* Stays mounted while its request is in flight, even if a permission re-check flickers. */}
      {(canRefund || modals.submitting) && modal === 'REFUND' && (
        <RefundModal
          key={`refund-${modalKey}`}
          orderId={order.id}
          reference={order.reference}
          initial={refundInitial}
          onClose={closeModal('REFUND')}
          onSubmitting={(submitting) => dispatchModal({ type: 'SUBMITTING', from: 'REFUND', submitting })}
          onRefunded={afterChange('REFUND')}
        />
      )}
      {canManage && modal === 'SHIP' && (
        <ShipOrderModal order={order} onClose={closeModal('SHIP')} onShipped={afterChange('SHIP')} />
      )}
      {canManage && modal === 'REGISTER_RETURN' && (
        <RegisterReturnModal
          key={`return-${modalKey}`}
          order={order}
          canRefund={canRefund}
          onClose={(changed) => (changed ? afterChange('REGISTER_RETURN')() : closeModal('REGISTER_RETURN')())}
          onRefundNow={(initial) => {
            // Hand-off: the refund modal replaces the return modal (whose late closes are now
            // ignored) and reads its amounts from a fresh preview; the order reloads behind it.
            dispatchModal({ type: 'HAND_OFF_REFUND', initial });
            load();
          }}
        />
      )}
      {canInvoice && invoiceScope && (
        <IssueInvoiceModal
          orderId={order.id}
          scope={invoiceScope}
          onClose={() => setInvoiceScope(null)}
          onIssued={() => {
            setInvoiceScope(null);
            load();
          }}
        />
      )}
      {canManage && modal === 'ADD_PAYMENT' && (
        <AddPaymentModal
          orderId={order.id}
          due={order.summary.due}
          onClose={closeModal('ADD_PAYMENT')}
          onAdded={afterChange('ADD_PAYMENT')}
        />
      )}
      <CancelOrderModal
        key={`cancel-${modalKey}`}
        open={canManage && modal === 'CANCEL'}
        reference={order.reference}
        onConfirm={() => runTransition('CANCEL')}
        onClose={closeModal('CANCEL')}
      />
      <ConfirmModal
        key={`archive-${modalKey}`}
        open={canManage && modal === 'ARCHIVE'}
        title={t('ecommerce.orders.detail.archive.title')}
        text={
          <Flex direction="column" gap={3}>
            <Typography>{t('ecommerce.orders.detail.archive.text', { reference: order.reference })}</Typography>
            {hasUninvoicedPayments(order.payments) && (
              <Box padding={3} background="warning100" hasRadius>
                <Typography variant="omega" textColor="warning700">
                  {t('ecommerce.orders.detail.archive.uninvoiced')}
                </Typography>
              </Box>
            )}
          </Flex>
        }
        confirm={{ button: t('ecommerce.orders.detail.archive.confirm'), action: () => runTransition('ARCHIVE') }}
        cancel={{ button: t('ecommerce.orders.detail.archive.back'), action: closeModal('ARCHIVE') }}
      />
    </Flex>
  );
};

export { OrderDetailPage };
