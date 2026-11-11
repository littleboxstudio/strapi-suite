import { useState } from 'react';
import { useIntl } from 'react-intl';
import { Link as RouterLink } from 'react-router-dom';
import { useNotification } from '@strapi/strapi/admin';
import {
  Badge,
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
  type InvoiceAction,
} from '../../utils/invoiceForm';
import type { InvoiceScopeInput, InvoiceView, Order } from '../../orderTypes';
import CreditNoteModal from './CreditNoteModal';
import OrderSection from './OrderSection';

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
                const note = statusNote(invoice);
                const isCredit = invoice.kind === 'CREDIT_NOTE';
                const credited = invoices.find((i) => i.id === invoice.creditedInvoiceId);
                return (
                  <Tr key={invoice.id}>
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
                    <Td style={{ maxWidth: 280 }}>
                      <Flex direction="column" alignItems="flex-start" gap={1}>
                        <Badge variant={invoiceStatusTone(invoice.status)} size="S">
                          {t(`ecommerce.orders.invoices.statuses.${invoice.status}`, undefined, invoice.status)}
                        </Badge>
                        {note && (
                          <Typography variant="pi" textColor={note.tone}>
                            {note.text}
                            {note.code && (
                              <Typography variant="pi" textColor="neutral500">
                                {' '}
                                ({note.code})
                              </Typography>
                            )}
                          </Typography>
                        )}
                        {invoice.warnings
                          .filter((w) => w !== 'DUPLICATE_INVOICE')
                          .map((w) => (
                            <Typography key={w} variant="pi" textColor="warning600">
                              {t(`ecommerce.orders.invoices.warnings.${w}`, undefined, w)}
                            </Typography>
                          ))}
                        {invoice.warnings.includes('DUPLICATE_INVOICE') && (
                          <Typography variant="pi" fontWeight="bold" textColor="danger600">
                            {t('ecommerce.orders.invoices.warnings.DUPLICATE_INVOICE')}
                          </Typography>
                        )}
                      </Flex>
                    </Td>
                    <Td>
                      <Flex gap={1} justifyContent="flex-end" wrap="wrap">
                        {actions.map((a) => (
                          <Button
                            key={a}
                            size="S"
                            variant={a === 'MARK_FAILED' ? 'danger-light' : a === 'RECONCILE' ? 'secondary' : 'tertiary'}
                            disabled={busy !== null}
                            loading={busy === invoice.id && (a === 'PDF' || a === 'RECONCILE')}
                            onClick={() => act(invoice, a)}
                          >
                            {t(`ecommerce.orders.invoices.actions.${a}`)}
                          </Button>
                        ))}
                      </Flex>
                    </Td>
                  </Tr>
                );
              })}
            </Tbody>
          </Table>
        </Box>
      )}

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
