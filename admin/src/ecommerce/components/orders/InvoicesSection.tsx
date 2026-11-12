import { useState, type MouseEvent } from 'react';
import styled from 'styled-components';
import { useIntl } from 'react-intl';
import { Link as RouterLink } from 'react-router-dom';
import { useNotification } from '@strapi/strapi/admin';
import {
  Box,
  Button,
  Checkbox,
  Flex,
  Modal,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  Typography,
} from '@strapi/design-system';
import config from '../../../core/config';
import { getTranslation } from '../../../core/utils/getTranslation';
import EmptySection from '../../illustrations/EmptySection';
import FetchInvoicePdf from '../../usecases/orders/fetchInvoicePdf';
import ReconcileInvoice from '../../usecases/orders/reconcileInvoice';
import { formatCents } from '../../utils/money';
import { apiErrorMessageId } from '../../utils/orderDetail';
import {
  hasUninvoicedPayments,
  invoiceActions,
  canMarkFailed,
  invoiceFailureMessageId,
  invoiceStatusTone,
  invoiceHasDetails,
  isDetailAction,
  type InvoiceAction,
} from '../../utils/invoiceForm';
import type { InvoiceScopeInput, InvoiceView, Order } from '../../orderTypes';
import CreditNoteModal from './CreditNoteModal';
import OrderSection from './OrderSection';
import { ToneBadge } from './StatusBadges';

type Props = {
  title: string;
  order: Pick<Order, 'availableActions' | 'billing' | 'invoices' | 'payments'>;
  /** `invoicing.manage`: issue, reconcile, credit notes. Without it those buttons are hidden. */
  canInvoice: boolean;
  /** Opens the invoice modal (owned by the page, shared with the payments table). */
  onIssue: (scope: InvoiceScopeInput) => void;
  /** After any change: the order is fetched again. */
  onChanged: () => void;
};

const COLUMNS = ['number', 'kind', 'date', 'total', 'status', 'actions'] as const;

/** A row with details opens them on click. */
const Row = styled(Tr)<{ $clickable: boolean }>`
  cursor: ${({ $clickable }) => ($clickable ? 'pointer' : 'default')};
`;

/** The provider's own message, as it came (field names and codes). */
const Detail = styled.pre`
  margin: 0;
  padding: 8px 12px;
  border: 1px solid ${({ theme }) => theme.colors.neutral200};
  border-radius: ${({ theme }) => theme.borderRadius};
  background: ${({ theme }) => theme.colors.neutral100};
  color: ${({ theme }) => theme.colors.neutral800};
  font-size: ${({ theme }) => theme.fontSizes[1]};
  white-space: pre-wrap;
  word-break: break-word;
`;

/** Tone of a status note → its box background and text colour. */
const NOTE_BOX: Record<string, { background: string; text: string }> = {
  warning600: { background: 'warning100', text: 'warning700' },
  danger600: { background: 'danger100', text: 'danger700' },
  neutral600: { background: 'neutral100', text: 'neutral700' },
};

/** The invoices and credit notes of the order (design 4.4). */
const InvoicesSection = ({ title, order, canInvoice, onIssue, onChanged }: Props) => {
  const { formatMessage, formatDate, locale: uiLocale } = useIntl();
  const { toggleNotification } = useNotification();
  const t = (id: string, values?: Record<string, any>, defaultMessage?: string) =>
    formatMessage({ id: getTranslation(id), defaultMessage }, values);
  const money = (cents: number) => formatCents(cents, uiLocale);
  const date = (iso: string | null) => (iso ? formatDate(iso, { dateStyle: 'medium', timeStyle: 'short' }) : '—');
  const providerName = (id: string) => t(`ecommerce.settings.providers.${id}.name`, undefined, id || '—');

  const [busy, setBusy] = useState<number | null>(null);
  const [crediting, setCrediting] = useState<InvoiceView | null>(null);
  const [markingFailed, setMarkingFailed] = useState<InvoiceView | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  /** The document whose explanation and Reconcile / Mark as failed are shown in a modal. */
  const [detailsId, setDetailsId] = useState<number | null>(null);

  const invoices = order.invoices;
  const billingActive = order.billing.active;
  const canTotal = canInvoice && order.availableActions.includes('INVOICE_TOTAL');
  // Something to invoice and no provider to do it: say where to configure one.
  const showBillingHint = canInvoice && !billingActive && (canTotal || hasUninvoicedPayments(order.payments));
  const duplicates = invoices.filter((i) => i.warnings.includes('DUPLICATE_INVOICE'));

  const openPdf = async (invoice: InvoiceView) => {
    if (busy !== null) return;
    // Opened before the request so the browser does not treat it as an unsolicited popup.
    const win = window.open('', '_blank');
    if (win) win.opener = null;
    setBusy(invoice.id);
    try {
      const blob = await new FetchInvoicePdf().execute(invoice.id);
      const url = URL.createObjectURL(blob);
      if (win) {
        win.location.href = url;
      } else {
        const a = document.createElement('a');
        a.href = url;
        a.download = `${(invoice.number || `invoice-${invoice.id}`).replace(/[^A-Za-z0-9._-]/g, '_')}.pdf`;
        a.click();
      }
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      win?.close();
      toggleNotification({
        type: 'danger',
        message: t(apiErrorMessageId(err, 'ecommerce.orders.invoices.pdf.error')),
      });
    } finally {
      setBusy(null);
    }
  };

  const reconcile = async (invoice: InvoiceView, markFailed: boolean) => {
    if (busy !== null) return;
    setBusy(invoice.id);
    try {
      const result = await new ReconcileInvoice().execute(invoice.id, markFailed);
      const key =
        result.status === 'ISSUED'
          ? 'found'
          : result.status === 'FAILED'
            ? markFailed
              ? 'markedFailed'
              : 'notFound'
            : 'unchanged';
      toggleNotification({
        type: result.status === 'ISSUED' ? 'success' : result.status === 'FAILED' ? 'info' : 'warning',
        message: t(`ecommerce.orders.invoices.reconcile.${key}`),
      });
    } catch (err) {
      toggleNotification({
        type: 'danger',
        message: t(apiErrorMessageId(err, 'ecommerce.orders.invoices.reconcile.error')),
      });
    } finally {
      setBusy(null);
      onChanged();
    }
  };

  const act = (invoice: InvoiceView, action: InvoiceAction) => {
    switch (action) {
      case 'PDF':
        openPdf(invoice);
        break;
      case 'RECONCILE':
        reconcile(invoice, false);
        break;
      case 'MARK_FAILED':
        setDetailsId(null);
        setConfirmed(false);
        setMarkingFailed(invoice);
        break;
      case 'CREDIT_NOTE':
        setCrediting(invoice);
        break;
    }
  };

  const statusNote = (invoice: InvoiceView): { tone: string; text: string; code?: string } | null => {
    if (invoice.status === 'UNCERTAIN') {
      return { tone: 'warning600', text: t('ecommerce.orders.invoices.uncertainHint') };
    }
    if (invoice.status === 'PENDING') {
      return {
        tone: invoice.reconcilable ? 'warning600' : 'neutral600',
        text: t(invoice.reconcilable ? 'ecommerce.orders.invoices.stuckHint' : 'ecommerce.orders.invoices.pendingHint'),
      };
    }
    if (invoice.status === 'FAILED' && invoice.error) {
      const id = invoiceFailureMessageId(invoice.error);
      // Unknown codes get a translated sentence, with the raw code shown muted next to it.
      return id
        ? { tone: 'danger600', text: t(id) }
        : { tone: 'danger600', text: t('ecommerce.orders.invoices.failure.unknown'), code: invoice.error };
    }
    return null;
  };

  const detailsModal = () => {
    const invoice = invoices.find((i) => i.id === detailsId);
    if (!invoice) return null;
    const note = statusNote(invoice);
    const box = note ? (NOTE_BOX[note.tone] ?? NOTE_BOX.neutral600) : null;
    const actions = invoiceActions(invoice, canInvoice).filter(isDetailAction);
    const warnings = invoice.warnings.filter((w) => w !== 'DUPLICATE_INVOICE');
    const close = () => setDetailsId(null);
    return (
      <Modal.Root open onOpenChange={(next: boolean) => !next && close()}>
        <Modal.Content>
          <Modal.Header>
            <Modal.Title>
              {t('ecommerce.orders.invoices.details.title', { number: invoice.number ?? `#${invoice.id}` })}
            </Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <Flex direction="column" alignItems="stretch" gap={4}>
              <Flex gap={2} alignItems="center" wrap="wrap">
                <ToneBadge variant={invoiceStatusTone(invoice.status)}>
                  {t(`ecommerce.orders.invoices.statuses.${invoice.status}`, undefined, invoice.status)}
                </ToneBadge>
                <Typography variant="pi" textColor="neutral600">
                  {providerName(invoice.provider)}
                  {invoice.documentType ? ` · ${invoice.documentType}` : ''}
                </Typography>
              </Flex>
              {note && box && (
                <Box padding={3} background={box.background} hasRadius>
                  <Typography variant="omega" textColor={box.text}>
                    {note.text}
                    {note.code && (
                      <Typography variant="omega" textColor="neutral600">
                        {' '}
                        ({note.code})
                      </Typography>
                    )}
                  </Typography>
                </Box>
              )}
              {invoice.errorDetail && (
                <Flex direction="column" alignItems="stretch" gap={1}>
                  <Typography variant="sigma" textColor="neutral600">
                    {t('ecommerce.orders.invoices.details.providerMessage', {
                      provider: providerName(invoice.provider),
                    })}
                  </Typography>
                  <Detail>{invoice.errorDetail}</Detail>
                </Flex>
              )}
              {warnings.map((w) => (
                <Box key={w} padding={3} background="warning100" hasRadius>
                  <Typography variant="omega" textColor="warning700">
                    {t(`ecommerce.orders.invoices.warnings.${w}`, undefined, w)}
                  </Typography>
                </Box>
              ))}
              {invoice.warnings.includes('DUPLICATE_INVOICE') && (
                <Box padding={3} background="danger100" hasRadius>
                  <Typography variant="omega" fontWeight="bold" textColor="danger700">
                    {t('ecommerce.orders.invoices.warnings.DUPLICATE_INVOICE')}
                  </Typography>
                </Box>
              )}
            </Flex>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="tertiary" onClick={close}>
              {t('ecommerce.orders.invoices.details.close')}
            </Button>
            {actions.length > 0 && (
              <Flex gap={2}>
                {actions.includes('MARK_FAILED') && (
                  <Button variant="danger-light" disabled={busy !== null} onClick={() => act(invoice, 'MARK_FAILED')}>
                    {t('ecommerce.orders.invoices.actions.MARK_FAILED')}
                  </Button>
                )}
                {actions.includes('RECONCILE') && (
                  <Button
                    disabled={busy !== null && busy !== invoice.id}
                    loading={busy === invoice.id}
                    onClick={async () => {
                      await reconcile(invoice, false);
                      close();
                    }}
                  >
                    {t('ecommerce.orders.invoices.actions.RECONCILE')}
                  </Button>
                )}
              </Flex>
            )}
          </Modal.Footer>
        </Modal.Content>
      </Modal.Root>
    );
  };

  const totalButton = canTotal ? (
    <Button size="S" disabled={!billingActive} onClick={() => onIssue({ scope: 'TOTAL' })}>
      {t('ecommerce.orders.invoices.generateTotal')}
    </Button>
  ) : undefined;

  return (
    <OrderSection title={title} actions={totalButton}>
      {showBillingHint && (
        <Box padding={3} background="neutral100" hasRadius>
          <Typography variant="omega" textColor="neutral700">
            {t('ecommerce.orders.invoices.billingInactive')}{' '}
            <RouterLink to={`/plugins/${config.pluginId}/ecommerce/settings/billing`}>
              {t('ecommerce.orders.invoices.billingLink', {
                section: t('ecommerce.settings.sections.billing'),
              })}
            </RouterLink>
          </Typography>
        </Box>
      )}

      {duplicates.map((invoice) => (
        <Box key={`dup-${invoice.id}`} padding={3} background="danger100" hasRadius>
          <Typography variant="omega" fontWeight="bold" textColor="danger700">
            {t('ecommerce.orders.invoices.duplicate', {
              number: invoice.number ?? `#${invoice.id}`,
              provider: providerName(invoice.provider),
            })}
          </Typography>
        </Box>
      ))}

      {invoices.length === 0 ? (
        <Flex direction="column" alignItems="center" gap={2} paddingTop={2} paddingBottom={2}>
          <EmptySection />
          <Typography variant="pi" textColor="neutral600">
            {t('ecommerce.orders.invoices.empty')}
          </Typography>
        </Flex>
      ) : (
        <Box style={{ overflowX: 'auto' }}>
          <Table colCount={COLUMNS.length} rowCount={invoices.length + 1}>
            <Thead>
              <Tr>
                {COLUMNS.map((c) => (
                  <Th key={c}>
                    <Typography variant="sigma">{t(`ecommerce.orders.invoices.columns.${c}`)}</Typography>
                  </Th>
                ))}
              </Tr>
            </Thead>
            <Tbody>
              {invoices.map((invoice) => {
                const actions = invoiceActions(invoice, canInvoice);
                const rowActions = actions.filter((a) => !isDetailAction(a));
                const hasDetails = invoiceHasDetails(invoice, actions);
                // The action buttons do their own thing, not the row's.
                const stop = (e: MouseEvent) => e.stopPropagation();
                const isCredit = invoice.kind === 'CREDIT_NOTE';
                const credited = invoices.find((i) => i.id === invoice.creditedInvoiceId);
                return (
                  <Row
                    key={invoice.id}
                    $clickable={hasDetails}
                    onClick={hasDetails ? () => setDetailsId(invoice.id) : undefined}
                  >
                    <Td>
                      <Flex direction="column" alignItems="flex-start">
                        <Typography textColor="neutral800" fontWeight="semiBold">
                          {invoice.number ?? `#${invoice.id}`}
                        </Typography>
                        <Typography variant="pi" textColor="neutral600">
                          {providerName(invoice.provider)}
                          {invoice.documentType ? ` · ${invoice.documentType}` : ''}
                        </Typography>
                      </Flex>
                    </Td>
                    <Td>
                      <Flex direction="column" alignItems="flex-start">
                        <Typography textColor="neutral800">
                          {t(`ecommerce.orders.invoices.kinds.${invoice.kind}`, undefined, invoice.kind)}
                        </Typography>
                        {isCredit && credited && (
                          <Typography variant="pi" textColor="neutral600">
                            {t('ecommerce.orders.invoices.creditOf', { number: credited.number ?? `#${credited.id}` })}
                          </Typography>
                        )}
                      </Flex>
                    </Td>
                    <Td>
                      <Typography textColor="neutral800">{date(invoice.issuedAt ?? invoice.createdAt)}</Typography>
                    </Td>
                    <Td>
                      <Flex direction="column" alignItems="flex-start">
                        <Typography textColor="neutral800">{money(isCredit ? -invoice.total : invoice.total)}</Typography>
                        {!isCredit && invoice.credited > 0 && (
                          <Typography variant="pi" textColor="neutral600">
                            {t('ecommerce.orders.invoices.credited', { amount: money(invoice.credited) })}
                          </Typography>
                        )}
                      </Flex>
                    </Td>
                    <Td>
                      <ToneBadge variant={invoiceStatusTone(invoice.status)}>
                        {t(`ecommerce.orders.invoices.statuses.${invoice.status}`, undefined, invoice.status)}
                      </ToneBadge>
                    </Td>
                    <Td>
                      <Flex gap={1} justifyContent="flex-end" wrap="wrap">
                        {hasDetails && (
                          <Button
                            size="S"
                            variant="tertiary"
                            loading={busy === invoice.id && !rowActions.includes('PDF')}
                            onClick={(e: MouseEvent) => {
                              stop(e);
                              setDetailsId(invoice.id);
                            }}
                          >
                            {t('ecommerce.orders.invoices.actions.DETAILS')}
                          </Button>
                        )}
                        {rowActions.map((a) => (
                          <Button
                            key={a}
                            size="S"
                            variant="tertiary"
                            disabled={busy !== null}
                            loading={busy === invoice.id && a === 'PDF'}
                            onClick={(e: MouseEvent) => {
                              stop(e);
                              act(invoice, a);
                            }}
                          >
                            {t(`ecommerce.orders.invoices.actions.${a}`)}
                          </Button>
                        ))}
                      </Flex>
                    </Td>
                  </Row>
                );
              })}
            </Tbody>
          </Table>
        </Box>
      )}

      {detailsModal()}
      {canInvoice && crediting && (
        <CreditNoteModal
          invoice={crediting}
          onClose={() => setCrediting(null)}
          onIssued={() => {
            setCrediting(null);
            onChanged();
          }}
        />
      )}
      {canInvoice && markingFailed && (
        <Modal.Root open onOpenChange={(next: boolean) => !next && setMarkingFailed(null)}>
          <Modal.Content>
            <Modal.Header>
              <Modal.Title>
                {t('ecommerce.orders.invoices.markFailed.title', {
                  number: markingFailed.number ?? `#${markingFailed.id}`,
                })}
              </Modal.Title>
            </Modal.Header>
            <Modal.Body>
              <Flex direction="column" alignItems="stretch" gap={4}>
                <Box padding={3} background="danger100" hasRadius>
                  <Typography variant="omega" textColor="danger700">
                    {t('ecommerce.orders.invoices.markFailed.warning', {
                      provider: providerName(markingFailed.provider),
                    })}
                  </Typography>
                </Box>
                <Checkbox
                  checked={confirmed}
                  onCheckedChange={(checked: boolean | 'indeterminate') => setConfirmed(checked === true)}
                >
                  {t('ecommerce.orders.invoices.markFailed.confirmCheck', {
                    provider: providerName(markingFailed.provider),
                  })}
                </Checkbox>
              </Flex>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="tertiary" onClick={() => setMarkingFailed(null)}>
                {t('ecommerce.orders.invoices.back')}
              </Button>
              <Button
                variant="danger"
                disabled={!canMarkFailed(markingFailed, confirmed)}
                onClick={() => {
                  const target = markingFailed;
                  if (!canMarkFailed(target, confirmed)) return;
                  setMarkingFailed(null);
                  reconcile(target, true);
                }}
              >
                {t('ecommerce.orders.invoices.markFailed.confirm')}
              </Button>
            </Modal.Footer>
          </Modal.Content>
        </Modal.Root>
      )}
    </OrderSection>
  );
};

export default InvoicesSection;
