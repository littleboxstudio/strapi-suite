import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import { useNotification } from '@strapi/strapi/admin';
import {
  Box,
  Button,
  Field,
  Flex,
  Loader,
  Modal,
  Table,
  Tbody,
  Td,
  Textarea,
  TextInput,
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
import { apiErrorMessageId } from '../../utils/orderDetail';
import { extractFieldErrors } from '../../utils/productForm';
import { mintUuid } from '../../utils/variantDraft';
import {
  MAX_CREDIT_NOTE_REASON,
  buildCreditNoteInput,
  creditNoteTotal,
  emptyCreditNoteForm,
  invoiceFailureMessageId,
  validateCreditNoteForm,
  type CreditNoteForm,
} from '../../utils/invoiceForm';
import type { FormErrors } from '../../utils/shipmentForm';
import type { CreditNotePreview, InvoiceView } from '../../orderTypes';

type Props = {
  invoice: InvoiceView;
  onClose: () => void;
  /** After a credit note was recorded (issued or uncertain): the order is fetched again. */
  onIssued: () => void;
};

const COLUMNS = ['name', 'quantity', 'total', 'creditable', 'amount'] as const;

/**
 * Credits lines of an issued invoice, prefilled with the server suggestion (returns first, then
 * what the order no longer owes). Mount it only while open: each opening mints a new key.
 */
const CreditNoteModal = ({ invoice, onClose, onIssued }: Props) => {
  const { formatMessage, locale: uiLocale } = useIntl();
  const { toggleNotification } = useNotification();
  const t = (id: string, values?: Record<string, any>) => formatMessage({ id: getTranslation(id) }, values);
  const codeText = (code: string) =>
    formatMessage({
      id: getTranslation(`ecommerce.orders.errors.${code}`),
      defaultMessage: t('ecommerce.orders.errors.invalid'),
    });
  const money = (cents: number) => formatCents(cents, uiLocale);

  const [idempotencyKey, setIdempotencyKey] = useState(() => mintUuid());
  const [preview, setPreview] = useState<CreditNotePreview | null>(null);
  const [form, setForm] = useState<CreditNoteForm | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uncertain, setUncertain] = useState(false);

  useEffect(() => {
    let alive = true;
    new FetchCreditNotePreview()
      .execute(invoice.id)
      .then((p) => {
        if (!alive) return;
        setPreview(p);
        setForm(emptyCreditNoteForm(p, uiLocale));
      })
      .catch((err) => alive && setLoadError(t(apiErrorMessageId(err, 'ecommerce.orders.invoices.creditNote.previewError'))));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoice.id]);

  const clear = (keys: string[]) => {
    setFormError(null);
    setErrors((map) => {
      if (!keys.some((k) => map[k])) return map;
      const next = { ...map };
      keys.forEach((k) => delete next[k]);
      return next;
    });
  };

  const setAmount = (index: number, amount: string) => {
    setForm((f) => f && { ...f, lines: f.lines.map((l) => (l.index === index ? { ...l, amount } : l)) });
    clear([`lines.${index}`, 'lines']);
  };

  const setReason = (reason: string) => {
    setForm((f) => f && { ...f, reason });
    clear(['reason']);
  };

  /** Server field errors (`lines.<j>.value`, by request position) mapped back to the lines. */
  const showServerErrors = (err: unknown, sent: { index: number }[]) => {
    const map: FormErrors = {};
    let other: string | null = null;
    for (const e of extractFieldErrors(err) ?? []) {
      const m = /^lines\.(\d+)\./.exec(e.path);
      const line = m ? sent[Number(m[1])] : undefined;
      if (line) map[`lines.${line.index}`] = e.code;
      else if (e.path === 'reason' || e.path === 'lines') map[e.path] = e.code;
      else other = other ?? e.code;
    }
    setErrors(map);
    if (!Object.keys(map).length) setFormError(t(apiErrorMessageId(err, 'ecommerce.orders.invoices.creditNote.error')));
    else if (other) setFormError(codeText(other));
  };

  const submit = async () => {
    if (saving || !form || !preview) return;
    const local = validateCreditNoteForm(form, preview.creditable);
    if (Object.keys(local).length) {
      setErrors(local);
      return;
    }
    const input = buildCreditNoteInput(form, idempotencyKey);
    setSaving(true);
    setFormError(null);
    try {
      const note = await new IssueCreditNote().execute(invoice.id, input);
      if (note.status === 'FAILED') {
        setIdempotencyKey(mintUuid());
        const id = note.error ? invoiceFailureMessageId(note.error) : null;
        setFormError(t(id ?? 'ecommerce.orders.invoices.creditNote.error'));
        return;
      }
      if (note.status === 'UNCERTAIN' || note.status === 'PENDING') {
        setUncertain(true);
        return;
      }
      toggleNotification({ type: 'success', message: t('ecommerce.orders.invoices.creditNote.success') });
      onIssued();
    } catch (err) {
      // Only a server answer allows a new key: without one, a retry must replay this request
      // (nothing else stops a second credit note).
      if ((err as any)?.response) setIdempotencyKey(mintUuid());
      showServerErrors(err, input.lines);
    } finally {
      setSaving(false);
    }
  };

  const close = () => {
    if (saving) return;
    if (uncertain) onIssued();
    else onClose();
  };

  const fieldError = (key: string) => (errors[key] ? codeText(errors[key]) : undefined);
  const reasonLength = form?.reason.trim().length ?? 0;

  return (
    <Modal.Root open onOpenChange={(next: boolean) => !next && close()}>
      <Modal.Content style={{ maxWidth: 900, width: '100%' }}>
        <Modal.Header>
          <Modal.Title>
            {t('ecommerce.orders.invoices.creditNote.title', { number: invoice.number ?? `#${invoice.id}` })}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Flex direction="column" alignItems="stretch" gap={4}>
            {loadError && <Typography textColor="danger600">{loadError}</Typography>}
            {!loadError && !form && (
              <Flex justifyContent="center" padding={6}>
                <Loader small />
              </Flex>
            )}
            {preview && form && (
              <>
                <Table colCount={COLUMNS.length} rowCount={preview.lines.length + 1}>
                  <Thead>
                    <Tr>
                      {COLUMNS.map((c) => (
                        <Th key={c}>
                          <Typography variant="sigma">{t(`ecommerce.orders.invoices.lines.${c}`)}</Typography>
                        </Th>
                      ))}
                    </Tr>
                  </Thead>
                  <Tbody>
                    {form.lines.map((draft) => {
                      const line = preview.lines[draft.index];
                      const creditable = preview.creditable[draft.index] ?? 0;
                      const error = fieldError(`lines.${draft.index}`);
                      return (
                        <Tr key={draft.index}>
                          <Td style={{ maxWidth: 280 }}>
                            <Typography textColor="neutral800" ellipsis>
                              {line.kind === 'SHIPPING'
                                ? t('ecommerce.orders.invoices.lines.shipping', { name: line.name })
                                : line.name}
                            </Typography>
                          </Td>
                          <Td>
                            <Typography textColor="neutral800">{line.quantity}</Typography>
                          </Td>
                          <Td>
                            <Typography textColor="neutral800">{money(line.total)}</Typography>
                          </Td>
                          <Td>
                            <Typography textColor="neutral800">{money(creditable)}</Typography>
                          </Td>
                          <Td style={{ minWidth: 140 }}>
                            <Field.Root name={`amount-${draft.index}`} error={error}>
                              <Field.Label>
                                <VisuallyHidden>{t('ecommerce.orders.invoices.lines.amount')}</VisuallyHidden>
                              </Field.Label>
                              <TextInput
                                value={draft.amount}
                                inputMode="decimal"
                                endAction={<span>€</span>}
                                disabled={saving || uncertain || creditable <= 0}
                                onChange={(e: any) => setAmount(draft.index, e.target.value)}
                              />
                              <Field.Error />
                            </Field.Root>
                          </Td>
                        </Tr>
                      );
                    })}
                  </Tbody>
                </Table>
                {errors.lines && (
                  <Typography variant="pi" textColor="danger600">
                    {t('ecommerce.orders.invoices.creditNote.nothing')}
                  </Typography>
                )}
                <Flex justifyContent="flex-end" gap={2}>
                  <Typography fontWeight="bold">{t('ecommerce.orders.invoices.creditNote.total')}</Typography>
                  <Typography fontWeight="bold">{money(creditNoteTotal(form))}</Typography>
                </Flex>
                <Field.Root
                  name="reason"
                  required
                  error={fieldError('reason')}
                  hint={t('ecommerce.orders.invoices.creditNote.reasonHint', {
                    count: reasonLength,
                    max: MAX_CREDIT_NOTE_REASON,
                  })}
                >
                  <Field.Label>{t('ecommerce.orders.invoices.creditNote.reason')}</Field.Label>
                  <Textarea
                    value={form.reason}
                    disabled={saving || uncertain}
                    onChange={(e: any) => setReason(e.target.value)}
                  />
                  <Field.Hint />
                  <Field.Error />
                </Field.Root>
              </>
            )}
            {uncertain && (
              <Box padding={3} background="warning100" hasRadius>
                <Typography variant="omega" textColor="warning700">
                  {t('ecommerce.orders.invoices.creditNote.uncertain')}
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
              {t('ecommerce.orders.invoices.creditNote.confirm')}
            </Button>
          )}
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
};

export default CreditNoteModal;
