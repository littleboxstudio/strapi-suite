import { useEffect, useState, type ReactNode } from 'react';
import { useIntl } from 'react-intl';
import { useNotification } from '@strapi/strapi/admin';
import {
  Box,
  Button,
  Checkbox,
  Field,
  Flex,
  Loader,
  Modal,
  Radio,
  Table,
  Tbody,
  Td,
  Textarea,
  Th,
  Thead,
  Tr,
  Typography,
  VisuallyHidden,
} from '@strapi/design-system';
import { getTranslation } from '../../../core/utils/getTranslation';
import FetchCreditNotePreview from '../../usecases/orders/fetchCreditNotePreview';
import IssueCreditNote from '../../usecases/orders/issueCreditNote';
import { formatCents } from '../../utils/money';
import {
  apiErrorDetail,
  apiErrorMessageId,
  shouldRenewIdempotencyKey,
} from '../../utils/orderDetail';
import InvoiceErrorModal from './InvoiceErrorModal';
import EmptyNote from './EmptyNote';
import QuantityInput from './QuantityInput';
import { FIT_CELL, PRODUCT_CELL } from './lineCells';
import ColumnLabel from '../ColumnLabel';
import { extractFieldErrors } from '../../utils/productForm';
import { mintUuid } from '../../utils/variantDraft';
import {
  MAX_CREDIT_NOTE_REASON,
  buildCreditNoteInput,
  creditNoteTotal,
  emptyCreditNoteForm,
  hasReturnable,
  invoiceFailureMessageId,
  isFailedReplay,
  isUncertainResult,
  issuedWarnings,
  returnValue,
  validateCreditNoteForm,
  type CreditNoteForm,
} from '../../utils/invoiceForm';
import type { FormErrors } from '../../utils/shipmentForm';
import type { CreditNoteOptions, CreditType, InvoiceLine, InvoiceView } from '../../orderTypes';

type Props = {
  invoice: InvoiceView;
  onClose: () => void;
  /** After a credit note was recorded (issued or uncertain): the order is fetched again. */
  onIssued: () => void;
};

const CREDIT_TYPES: CreditType[] = ['RETURN', 'CORRECTION'];
const RETURN_COLUMNS = ['name', 'returnable', 'quantity', 'value'] as const;
const CORRECTION_COLUMNS = ['name', 'quantity', 'amount'] as const;

const toggle = (indexes: number[], index: number, on: boolean) =>
  on
    ? indexes.includes(index)
      ? indexes
      : [...indexes, index]
    : indexes.filter((x) => x !== index);

/**
 * Credits an issued invoice for a reason: Return (chosen returned units and whole shipping lines)
 * or Correction (everything still creditable, so the invoice can be issued again correctly).
 * Mount it only while open: each opening mints one idempotency key.
 */
const CreditNoteModal = ({ invoice, onClose, onIssued }: Props) => {
  const { formatMessage, locale: uiLocale } = useIntl();
  const { toggleNotification } = useNotification();
  const t = (id: string, values?: Record<string, any>) =>
    formatMessage({ id: getTranslation(id) }, values);
  const p = 'ecommerce.orders.invoices.creditNote';
  const codeText = (code: string) =>
    formatMessage({
      id: getTranslation(`ecommerce.orders.errors.${code}`),
      defaultMessage: t('ecommerce.orders.errors.invalid'),
    });
  const money = (cents: number) => formatCents(cents, uiLocale);
  const lineName = (line: InvoiceLine | undefined) =>
    !line
      ? '—'
      : line.kind === 'SHIPPING'
        ? t('ecommerce.orders.invoices.lines.shipping', { name: line.name })
        : line.name;

  // One key per opening: after an attempt the modal can only be closed, or fixed and sent again
  // after a refusal (4xx), which renews it.
  const [idempotencyKey, setIdempotencyKey] = useState(() => mintUuid());
  const [options, setOptions] = useState<CreditNoteOptions | null>(null);
  const [form, setForm] = useState<CreditNoteForm | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  /** The billing provider refused it (or the request failed): shown in the error modal. */
  const [failure, setFailure] = useState<{
    message: string;
    detail: string | null;
    refused: boolean;
  } | null>(null);

  useEffect(() => {
    let alive = true;
    new FetchCreditNotePreview()
      .execute(invoice.id)
      .then((o) => {
        if (!alive) return;
        setOptions(o);
        setForm(emptyCreditNoteForm(o));
      })
      .catch((err) => alive && setLoadError(t(apiErrorMessageId(err, `${p}.previewError`))));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoice.id]);

  const locked = saving || uncertain;

  const clear = (keys: string[]) => {
    setFormError(null);
    setErrors((map) => {
      if (!keys.some((k) => map[k])) return map;
      const next = { ...map };
      keys.forEach((k) => delete next[k]);
      return next;
    });
  };

  const update = (patch: Partial<CreditNoteForm>, keys: string[]) => {
    setForm((f) => f && { ...f, ...patch });
    clear(keys);
  };

  /**
   * Server field errors mapped back to the form: `lines.<j>.quantity` (by request position) to
   * its line's quantity, `shippingIndexes.<j>` to the shipping list.
   */
  const showServerErrors = (err: unknown, sent: { index: number }[]) => {
    const map: FormErrors = {};
    let other: string | null = null;
    for (const e of extractFieldErrors(err) ?? []) {
      const line = /^lines\.(\d+)\./.exec(e.path);
      const sentLine = line ? sent[Number(line[1])] : undefined;
      if (sentLine) map[`quantities.${sentLine.index}`] = e.code;
      else if (e.path.startsWith('shippingIndexes')) map.shipping = e.code;
      else if (e.path === 'reason' || e.path === 'lines') map[e.path] = e.code;
      else other = other ?? e.code;
    }
    setErrors(map);
    if (!Object.keys(map).length) setFormError(t(apiErrorMessageId(err, `${p}.error`)));
    else if (other) setFormError(codeText(other));
  };

  const submit = async () => {
    if (saving || uncertain || !form || !options) return;
    const local = validateCreditNoteForm(form, options);
    if (Object.keys(local).length) {
      setErrors(local);
      return;
    }
    const input = buildCreditNoteInput(form, idempotencyKey);
    setSaving(true);
    setFormError(null);
    try {
      const note = await new IssueCreditNote().execute(invoice.id, input);
      if (isFailedReplay(note)) {
        const id = note.error ? invoiceFailureMessageId(note.error) : null;
        setFailure({ message: t(id ?? `${p}.error`), detail: note.errorDetail, refused: true });
        return;
      }
      if (isUncertainResult(note)) {
        setUncertain(true);
        return;
      }
      const warnings = issuedWarnings(note);
      toggleNotification(
        warnings.length
          ? {
              type: 'warning',
              message: t('ecommerce.orders.invoices.issue.warnings', {
                warnings: warnings
                  .map((w) => t(`ecommerce.orders.invoices.warnings.${w}`))
                  .join(' '),
              }),
            }
          : { type: 'success', message: t(`${p}.success`) }
      );
      onIssued();
    } catch (err) {
      // Only a 4xx allows a new key: on a 5xx or without an answer a retry must replay this
      // request (nothing else stops a second credit note).
      if (shouldRenewIdempotencyKey(err)) setIdempotencyKey(mintUuid());
      if (extractFieldErrors(err)?.length) {
        // The form's own problems stay here, to be fixed and sent again.
        showServerErrors(err, input.lines ?? []);
      } else {
        // Anything else (the provider refused it, or no answer) is shown in the error modal.
        setFailure({
          message: t(apiErrorMessageId(err, `${p}.error`)),
          detail: apiErrorDetail(err),
          refused: shouldRenewIdempotencyKey(err),
        });
      }
    } finally {
      setSaving(false);
    }
  };

  const close = () => {
    if (saving) return;
    // After an attempt the order is fetched again.
    if (uncertain || failure) onIssued();
    else onClose();
  };

  if (failure) {
    return <InvoiceErrorModal {...failure} titleId={`${p}.errorTitle`} onClose={close} />;
  }

  const fieldError = (key: string) => (errors[key] ? codeText(errors[key]) : undefined);

  const heading = (columns: readonly string[], label: (c: string) => string) => (
    <Thead>
      <Tr>
        {columns.map((c) => (
          <Th key={c}>
            <ColumnLabel column={c}>{label(c)}</ColumnLabel>
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

  const returnBody = (o: CreditNoteOptions, values: CreditNoteForm) => {
    const rows = o.returnable.filter((r) => r.units > 0);
    return (
      <>
        {block(
          t('ecommerce.orders.invoices.issue.products'),
          rows.length === 0 ? (
            <EmptyNote>{t(`${p}.nothingReturnable`)}</EmptyNote>
          ) : (
            <Table colCount={RETURN_COLUMNS.length} rowCount={rows.length + 1}>
              {heading(RETURN_COLUMNS, (c) =>
                c === 'name' ? t('ecommerce.orders.invoices.lines.name') : t(`${p}.columns.${c}`)
              )}
              <Tbody>
                {rows.map((r) => {
                  const quantity = values.quantities[r.index] ?? 0;
                  const code = errors[`quantities.${r.index}`];
                  const error =
                    code === 'exceeds_creditable'
                      ? t('ecommerce.orders.invoices.issue.atMost', { max: r.units })
                      : code
                        ? codeText(code)
                        : undefined;
                  return (
                    <Tr key={r.index}>
                      <Td style={PRODUCT_CELL}>
                        <Typography textColor="neutral800">{lineName(o.lines[r.index])}</Typography>
                      </Td>
                      <Td style={FIT_CELL}>
                        <Typography textColor="neutral800">{r.units}</Typography>
                      </Td>
                      <Td style={FIT_CELL}>
                        <Box style={{ width: 120 }}>
                          <Field.Root name={`quantities.${r.index}`} error={error}>
                            <VisuallyHidden>
                              <Field.Label>{t(`${p}.columns.quantity`)}</Field.Label>
                            </VisuallyHidden>
                            <QuantityInput
                              value={quantity}
                              disabled={locked}
                              onChange={(q) =>
                                update({ quantities: { ...values.quantities, [r.index]: q } }, [
                                  `quantities.${r.index}`,
                                  'lines',
                                ])
                              }
                            />
                            <Field.Error />
                          </Field.Root>
                        </Box>
                      </Td>
                      <Td style={FIT_CELL}>
                        <Typography textColor="neutral800">
                          {money(returnValue(r, quantity))}
                        </Typography>
                      </Td>
                    </Tr>
                  );
                })}
              </Tbody>
            </Table>
          )
        )}
        {o.shipping.length > 0 &&
          block(
            t(`${p}.shipping`),
            <Flex direction="column" alignItems="stretch" gap={2}>
              {o.shipping.map((s) => (
                <Flex key={s.index} justifyContent="space-between" gap={3}>
                  <Checkbox
                    disabled={locked}
                    checked={values.shipping.includes(s.index)}
                    onCheckedChange={(checked: boolean | 'indeterminate') =>
                      update({ shipping: toggle(values.shipping, s.index, checked === true) }, [
                        'shipping',
                        'lines',
                      ])
                    }
                  >
                    {o.lines[s.index]?.name ?? '—'}
                  </Checkbox>
                  <Typography textColor="neutral800">{money(s.value)}</Typography>
                </Flex>
              ))}
              {errors.shipping && (
                <Typography variant="pi" textColor="danger600">
                  {codeText(errors.shipping)}
                </Typography>
              )}
            </Flex>
          )}
        {errors.lines && (
          <Typography variant="pi" textColor="danger600">
            {t(`${p}.nothing`)}
          </Typography>
        )}
      </>
    );
  };

  /** Read-only: a Correction credits every line still creditable (never empty: the action needs one). */
  const correctionBody = (o: CreditNoteOptions) => (
    <Table colCount={CORRECTION_COLUMNS.length} rowCount={o.correction.lines.length + 1}>
      {heading(CORRECTION_COLUMNS, (c) => t(`ecommerce.orders.invoices.lines.${c}`))}
      <Tbody>
        {o.correction.lines.map((line, i) => (
          <Tr key={i}>
            <Td style={PRODUCT_CELL}>
              <Typography textColor="neutral800">{lineName(line)}</Typography>
            </Td>
            <Td style={FIT_CELL}>
              <Typography textColor="neutral800">{line.quantity}</Typography>
            </Td>
            <Td style={FIT_CELL}>
              <Typography textColor="neutral800">{money(line.total)}</Typography>
            </Td>
          </Tr>
        ))}
      </Tbody>
    </Table>
  );

  const body = (o: CreditNoteOptions, values: CreditNoteForm) => {
    const returnable = hasReturnable(o);
    const reasonLength = values.reason.trim().length;
    return (
      <>
        <Field.Root name="creditType">
          <Field.Label>{t(`${p}.creditType`)}</Field.Label>
          <Radio.Group
            value={values.creditType}
            aria-label={t(`${p}.creditType`)}
            onValueChange={(value: string) =>
              update({ creditType: value as CreditType }, ['lines', 'shipping'])
            }
          >
            {CREDIT_TYPES.map((type) => {
              const disabled = locked || (type === 'RETURN' && !returnable);
              return (
                <Radio.Item key={type} value={type} disabled={disabled}>
                  <Flex direction="column" alignItems="flex-start" gap={1}>
                    <Typography>{t(`${p}.types.${type}`)}</Typography>
                    <Typography variant="pi" textColor="neutral600">
                      {type === 'RETURN' && !returnable
                        ? t(`${p}.nothingReturnable`)
                        : t(`${p}.types.${type}.hint`)}
                    </Typography>
                  </Flex>
                </Radio.Item>
              );
            })}
          </Radio.Group>
        </Field.Root>

        {values.creditType === 'RETURN' ? returnBody(o, values) : correctionBody(o)}

        <Field.Root
          name="reason"
          required
          error={fieldError('reason')}
          hint={t(`${p}.reasonHint`, { count: reasonLength, max: MAX_CREDIT_NOTE_REASON })}
        >
          <Field.Label>{t(`${p}.reason`)}</Field.Label>
          <Textarea
            value={values.reason}
            disabled={locked}
            onChange={(e: any) => update({ reason: e.target.value }, ['reason'])}
          />
          <Field.Hint />
          <Field.Error />
        </Field.Root>

        <Flex justifyContent="flex-end" gap={2}>
          <Typography fontWeight="bold">{t(`${p}.total`)}</Typography>
          <Typography fontWeight="bold">{money(creditNoteTotal(values, o))}</Typography>
        </Flex>
      </>
    );
  };

  return (
    <Modal.Root open onOpenChange={(next: boolean) => !next && close()}>
      <Modal.Content style={{ maxWidth: 900, width: '100%' }}>
        <Modal.Header>
          <Modal.Title>
            {t(`${p}.title`, { number: invoice.number ?? `#${invoice.id}` })}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Flex direction="column" alignItems="stretch" gap={5}>
            {loadError && <Typography textColor="danger600">{loadError}</Typography>}
            {!loadError && !form && (
              <Flex justifyContent="center" padding={6}>
                <Loader small />
              </Flex>
            )}
            {options && form && body(options, form)}
            {uncertain && (
              <Box padding={3} background="warning100" hasRadius>
                <Typography variant="omega" textColor="warning700">
                  {t(`${p}.uncertain`)}
                </Typography>
              </Box>
            )}
            {formError && (
              <Typography variant="omega" textColor="danger600">
                {formError}
              </Typography>
            )}
          </Flex>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="tertiary" onClick={close} disabled={saving}>
            {t(uncertain ? 'ecommerce.orders.invoices.close' : 'ecommerce.orders.invoices.back')}
          </Button>
          {!uncertain && (
            <Button onClick={submit} loading={saving} disabled={!form || saving}>
              {t(`${p}.confirm`)}
            </Button>
          )}
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
};

export default CreditNoteModal;
