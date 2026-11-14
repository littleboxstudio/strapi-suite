import { useEffect, useState, type ReactNode } from 'react';
import { useIntl } from 'react-intl';
import { useNotification } from '@strapi/strapi/admin';
import {
  Badge,
  Box,
  Button,
  Checkbox,
  Field,
  Flex,
  Loader,
  Modal,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  Typography,
  VisuallyHidden,
} from '@strapi/design-system';
import { getTranslation } from '../../../core/utils/getTranslation';
import FetchInvoiceSelection from '../../usecases/orders/fetchInvoiceSelection';
import IssueInvoice from '../../usecases/orders/issueInvoice';
import { formatCents } from '../../utils/money';
import { apiErrorDetail, apiErrorMessageId, shouldRenewIdempotencyKey } from '../../utils/orderDetail';
import { invoiceFailureMessageId, isFailedReplay, isUncertainResult, issuedWarnings } from '../../utils/invoiceForm';
import {
  buildIssueInvoiceInput,
  defaultInvoiceSelectionForm,
  invoiceSelectionTotals,
  selectedValue,
  selectionPayments,
  strandedValue,
  unitValue,
  validateInvoiceSelection,
  type InvoiceSelectionForm,
} from '../../utils/invoiceSelection';
import InvoiceErrorModal from './InvoiceErrorModal';
import EmptyNote from './EmptyNote';
import QuantityInput from './QuantityInput';
import { FIT_CELL, PRODUCT_CELL } from './lineCells';
import ColumnLabel from '../ColumnLabel';
import { mintUuid } from '../../utils/variantDraft';
import type { InvoiceSelectionView, OrderPayment } from '../../orderTypes';

type Props = {
  orderId: number;
  /** The order's payments: the method and date of each selectable payment. */
  payments: OrderPayment[];
  /** `payments.refund`: the excess box offers Refund. */
  canRefund: boolean;
  onClose: () => void;
  /** After a document was recorded (issued or uncertain): the order is fetched again. */
  onIssued: () => void;
  /** Refund the excess first: the page swaps this modal for the refund one. */
  onRefund: () => void;
};

const PRODUCT_COLUMNS = ['product', 'unitValue', 'remaining', 'quantity', 'value'] as const;
const SHIPPING_COLUMNS = ['select', 'name', 'date', 'value'] as const;
const PAYMENT_COLUMNS = ['select', 'method', 'date', 'paid', 'refunded', 'net'] as const;

const toggle = (ids: number[], id: number, on: boolean) =>
  on ? (ids.includes(id) ? ids : [...ids, id]) : ids.filter((x) => x !== id);

/**
 * Issues an invoice from a selection of products, shipping lines and payments: it can be issued
 * when the selected total equals the ticked payments' net. Mount it only while open: each opening
 * mints a new idempotency key.
 */
const IssueInvoiceModal = ({ orderId, payments, canRefund, onClose, onIssued, onRefund }: Props) => {
  const { formatMessage, formatDate, locale: uiLocale } = useIntl();
  const { toggleNotification } = useNotification();
  const t = (id: string, values?: Record<string, any>, defaultMessage?: string) =>
    formatMessage({ id: getTranslation(id), defaultMessage }, values);
  const p = 'ecommerce.orders.invoices.issue';
  const money = (cents: number) => formatCents(cents, uiLocale);
  const date = (iso: string | null) => (iso ? formatDate(iso, { dateStyle: 'medium', timeStyle: 'short' }) : '—');

  // One key per opening: after an attempt the modal can only be closed, so there is no second one.
  const [idempotencyKey] = useState(() => mintUuid());
  const [selection, setSelection] = useState<InvoiceSelectionView | null>(null);
  const [form, setForm] = useState<InvoiceSelectionForm | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The billing provider's message of a refusal (what it rejected and why). */
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  /** The server answered with a refusal (4xx): nothing was issued. Otherwise the outcome is unknown. */
  const [refused, setRefused] = useState(false);
  const [saving, setSaving] = useState(false);
  // The provider did not answer: the outcome is unknown until the invoice is reconciled.
  const [uncertain, setUncertain] = useState(false);

  useEffect(() => {
    let alive = true;
    new FetchInvoiceSelection()
      .execute(orderId)
      .then((view) => {
        if (!alive) return;
        setSelection(view);
        setForm(defaultInvoiceSelectionForm(view));
      })
      .catch((err) => alive && setLoadError(t(apiErrorMessageId(err, `${p}.previewError`))));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  const failureText = (code: string | null) => {
    const id = code ? invoiceFailureMessageId(code) : null;
    return t(id ?? `${p}.error`);
  };

  const totals = selection && form ? invoiceSelectionTotals(selection, form) : null;
  const errors = selection && form ? validateInvoiceSelection(selection, form) : {};
  /** An attempt was made and did not end in an issued invoice: only Close remains. */
  const attempted = uncertain || error !== null;
  const locked = saving || attempted;

  const submit = async () => {
    if (saving || attempted || !selection || !form || !totals?.canIssue) return;
    setSaving(true);
    setError(null);
    try {
      const invoice = await new IssueInvoice().execute(
        orderId,
        buildIssueInvoiceInput(selection, form, idempotencyKey)
      );
      if (isFailedReplay(invoice)) {
        // The provider refused it: say why; the attempt is in the invoices list.
        setError(failureText(invoice.error));
        setErrorDetail(invoice.errorDetail);
        setRefused(true);
        return;
      }
      if (isUncertainResult(invoice)) {
        setUncertain(true);
        return;
      }
      const warnings = issuedWarnings(invoice);
      toggleNotification(
        warnings.length
          ? {
              type: 'warning',
              message: t(`${p}.warnings`, {
                warnings: warnings.map((w) => t(`ecommerce.orders.invoices.warnings.${w}`)).join(' '),
              }),
            }
          : { type: 'success', message: t(`${p}.success`) }
      );
      onIssued();
    } catch (err) {
      // A refusal records nothing: the error modal shows the provider's message, with only Close,
      // so the cause is fixed before another attempt.
      setError(t(apiErrorMessageId(err, `${p}.error`)));
      setErrorDetail(apiErrorDetail(err));
      setRefused(shouldRenewIdempotencyKey(err));
    } finally {
      setSaving(false);
    }
  };

  const close = () => {
    if (saving) return;
    // After an attempt the order is fetched again, so the list shows the recorded row.
    if (attempted) onIssued();
    else onClose();
  };

  // A failed attempt replaces this modal with the error one; closing it refreshes the order.
  if (error) {
    return <InvoiceErrorModal message={error} detail={errorDetail} refused={refused} onClose={close} />;
  }

  const heading = (columns: readonly string[]) => (
    <Thead>
      <Tr>
        {columns.map((c) => (
          <Th key={c}>
            <ColumnLabel column={c}>{t(`${p}.columns.${c}`)}</ColumnLabel>
          </Th>
        ))}
      </Tr>
    </Thead>
  );

  const block = (title: string, content: ReactNode) => (
    <Flex direction="column" alignItems="stretch" gap={2}>
      <Typography variant="sigma" textColor="neutral600">
        {title}
      </Typography>
      {content}
    </Flex>
  );

  const body = (view: InvoiceSelectionView, values: InvoiceSelectionForm) => {
    const paymentRows = selectionPayments(view, payments);
    const stranded = strandedValue(view);
    return (
      <>
        {view.excess > 0 && (
          <Flex padding={3} background="warning100" hasRadius gap={3} justifyContent="space-between" alignItems="center">
            <Typography variant="omega" textColor="warning700">
              {t(`${p}.excess`, { amount: money(view.excess) })}
            </Typography>
            {canRefund && (
              <Button size="S" variant="secondary" disabled={locked} onClick={onRefund}>
                {t(`${p}.refund`)}
              </Button>
            )}
          </Flex>
        )}
        {stranded > 0 && (
          <Box padding={3} background="warning100" hasRadius>
            <Typography variant="omega" textColor="warning700">
              {t(`${p}.stranded`, { amount: money(stranded) })}
            </Typography>
          </Box>
        )}

        {block(
          t(`${p}.products`),
          view.lines.length === 0 ? (
            <EmptyNote>{t(`${p}.noProducts`)}</EmptyNote>
          ) : (
            <Table colCount={PRODUCT_COLUMNS.length} rowCount={view.lines.length + 1}>
              {heading(PRODUCT_COLUMNS)}
              <Tbody>
                {view.lines.map((line) => {
                  const quantity = values.quantities[line.orderLineId] ?? 0;
                  const fieldError = errors[`quantities.${line.orderLineId}`]
                    ? t(`${p}.atMost`, { max: line.remainingQuantity })
                    : undefined;
                  const value = fieldError ? 0 : selectedValue(line.remainingValue, line.remainingQuantity, quantity);
                  return (
                    <Tr key={line.orderLineId}>
                      <Td style={PRODUCT_CELL}>
                        <Flex direction="column" alignItems="flex-start" gap={1}>
                          <Typography textColor="neutral800" fontWeight="semiBold">
                            {line.option ? `${line.name} — ${line.option}` : line.name}
                          </Typography>
                          <Typography variant="pi" textColor="neutral600">
                            {line.sku}
                          </Typography>
                          {line.isGift && <Badge size="S">{t(`${p}.gift`)}</Badge>}
                        </Flex>
                      </Td>
                      <Td style={FIT_CELL}>
                        <Typography textColor="neutral800">{money(unitValue(line))}</Typography>
                      </Td>
                      <Td style={FIT_CELL}>
                        <Typography textColor="neutral800">{line.remainingQuantity}</Typography>
                      </Td>
                      <Td style={FIT_CELL}>
                        <Box style={{ width: 120 }}>
                          <Field.Root name={`quantities.${line.orderLineId}`} error={fieldError}>
                            <VisuallyHidden>
                              <Field.Label>{t(`${p}.columns.quantity`)}</Field.Label>
                            </VisuallyHidden>
                            <QuantityInput
                              value={quantity}
                              disabled={locked}
                              onChange={(q) =>
                                setForm((f) => f && { ...f, quantities: { ...f.quantities, [line.orderLineId]: q } })
                              }
                            />
                            <Field.Error />
                          </Field.Root>
                        </Box>
                      </Td>
                      <Td style={FIT_CELL}>
                        <Typography textColor="neutral800">{money(value)}</Typography>
                      </Td>
                    </Tr>
                  );
                })}
              </Tbody>
            </Table>
          )
        )}

        {block(
          t(`${p}.shipping`),
          view.shipping.length === 0 ? (
            <EmptyNote>{t(`${p}.noShipping`)}</EmptyNote>
          ) : (
            <Table colCount={SHIPPING_COLUMNS.length} rowCount={view.shipping.length + 1}>
              {heading(SHIPPING_COLUMNS)}
              <Tbody>
                {view.shipping.map((line) => (
                  <Tr key={line.shippingLineId}>
                    <Td style={FIT_CELL}>
                      <Checkbox
                        aria-label={line.name}
                        disabled={locked}
                        checked={values.shipping.includes(line.shippingLineId)}
                        onCheckedChange={(checked: boolean | 'indeterminate') =>
                          setForm((f) => f && { ...f, shipping: toggle(f.shipping, line.shippingLineId, checked === true) })
                        }
                      />
                    </Td>
                    <Td style={PRODUCT_CELL}>
                      <Typography textColor="neutral800">{line.name}</Typography>
                    </Td>
                    <Td style={FIT_CELL}>
                      <Typography textColor="neutral800">{date(line.createdAt)}</Typography>
                    </Td>
                    <Td style={FIT_CELL}>
                      <Typography textColor="neutral800">{money(line.value)}</Typography>
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          )
        )}

        {block(
          t(`${p}.payments`),
          paymentRows.length === 0 ? (
            <EmptyNote>{t(`${p}.noPayments`)}</EmptyNote>
          ) : (
            <Table colCount={PAYMENT_COLUMNS.length} rowCount={paymentRows.length + 1}>
              {heading(PAYMENT_COLUMNS)}
              <Tbody>
                {paymentRows.map((row) => {
                  const method =
                    row.methodLabel ||
                    (row.method
                      ? t(`ecommerce.orders.detail.payments.methods.${row.method}`, undefined, row.method)
                      : `#${row.paymentId}`);
                  return (
                    <Tr key={row.paymentId}>
                      <Td style={FIT_CELL}>
                        <Checkbox
                          aria-label={method}
                          disabled={locked}
                          checked={values.payments.includes(row.paymentId)}
                          onCheckedChange={(checked: boolean | 'indeterminate') =>
                            setForm((f) => f && { ...f, payments: toggle(f.payments, row.paymentId, checked === true) })
                          }
                        />
                      </Td>
                      <Td style={PRODUCT_CELL}>
                        <Typography textColor="neutral800">{method}</Typography>
                      </Td>
                      <Td style={FIT_CELL}>
                        <Typography textColor="neutral800">{date(row.date)}</Typography>
                      </Td>
                      <Td style={FIT_CELL}>
                        <Typography textColor="neutral800">{money(row.amount)}</Typography>
                      </Td>
                      <Td style={FIT_CELL}>
                        <Typography textColor="neutral800">{money(row.refunded)}</Typography>
                      </Td>
                      <Td style={FIT_CELL}>
                        <Typography textColor="neutral800" fontWeight="semiBold">
                          {money(row.net)}
                        </Typography>
                      </Td>
                    </Tr>
                  );
                })}
              </Tbody>
            </Table>
          )
        )}

        {totals && (
          <Flex direction="column" alignItems="flex-end" gap={1}>
            <Flex gap={2}>
              <Typography>{t(`${p}.selectedTotal`)}</Typography>
              <Typography fontWeight="bold">{money(totals.selected)}</Typography>
            </Flex>
            <Flex gap={2}>
              <Typography>{t(`${p}.paymentsTotal`)}</Typography>
              <Typography fontWeight="bold">{money(totals.payments)}</Typography>
            </Flex>
            {totals.difference !== 0 && (
              <Typography textColor="danger600">{t(`${p}.difference`, { amount: money(totals.difference) })}</Typography>
            )}
          </Flex>
        )}
      </>
    );
  };

  return (
    <Modal.Root open onOpenChange={(next: boolean) => !next && close()}>
      <Modal.Content style={{ maxWidth: 920, width: '100%' }}>
        <Modal.Header>
          <Modal.Title>{t(`${p}.title`)}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Flex direction="column" alignItems="stretch" gap={5}>
            {loadError && <Typography textColor="danger600">{loadError}</Typography>}
            {!loadError && !selection && (
              <Flex justifyContent="center" padding={6}>
                <Loader small />
              </Flex>
            )}
            {selection && form && body(selection, form)}
            {uncertain && (
              <Box padding={3} background="warning100" hasRadius>
                <Typography variant="omega" textColor="warning700">
                  {t(`${p}.uncertain`)}
                </Typography>
              </Box>
            )}
          </Flex>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="tertiary" onClick={close} disabled={saving}>
            {t(attempted ? 'ecommerce.orders.invoices.close' : 'ecommerce.orders.invoices.back')}
          </Button>
          {!attempted && (
            <Button onClick={submit} loading={saving} disabled={saving || !totals?.canIssue}>
              {t(`${p}.confirm`)}
            </Button>
          )}
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
};

export default IssueInvoiceModal;
