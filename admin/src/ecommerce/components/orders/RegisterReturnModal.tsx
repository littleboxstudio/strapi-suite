import { useEffect, useRef, useState } from 'react';
import { useIntl } from 'react-intl';
import { useNotification } from '@strapi/strapi/admin';
import {
  Box,
  Button,
  Checkbox,
  Field,
  Flex,
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
import { FIT_CELL, PRODUCT_CELL } from './lineCells';
import NoticeBar from './NoticeBar';
import { ActionConfirmModal } from '../ActionConfirmModal';
import { getTranslation } from '../../../core/utils/getTranslation';
import { InputTd } from '../InputTd';
import RegisterReturn from '../../usecases/orders/registerReturn';
import PreviewReturn from '../../usecases/orders/previewReturn';
import { formatCents } from '../../utils/money';
import { apiErrorMessageId, lineDiscountLabel } from '../../utils/orderDetail';
import { extractFieldErrors } from '../../utils/productForm';
import { mintUuid } from '../../utils/variantDraft';
import {
  MAX_RETURN_NOTES,
  buildReturnInput,
  defaultReturnLines,
  estimatedReturnValue,
  validateReturnForm,
  type ReturnForm,
} from '../../utils/returnForm';
import { mapServerFieldErrors, type FormErrors } from '../../utils/shipmentForm';
import type { RefundInitial } from '../../utils/refundForm';
import type { ReturnPreview, Order, ReturnRegistered } from '../../orderTypes';

type Props = {
  order: Order;
  /** `refunds.manage`: offers "Refund now" after the return. */
  canRefund: boolean;
  /** Closes the modal; `changed` when a return was registered (the order must be fetched again). */
  onClose: (changed: boolean) => void;
  /** "Refund now": opens the refund modal with this prefill. */
  onRefundNow: (initial: RefundInitial) => void;
};

const COLUMNS = ['product', 'shipped', 'returned', 'returnable', 'quantity', 'restock'] as const;
/** Server paths of the return body → form paths. */
const RETURN_PATHS: Record<string, string> = { lines: 'lines', reason: 'reason', notes: 'notes' };

/**
 * Registers a return of shipped units (design 4.11), each line restocked or not. It never refunds:
 * once saved it offers "Refund now", which opens the refund modal with reason RETURN.
 * Mount it only while open: each opening mints a new idempotency key.
 */
const RegisterReturnModal = ({ order, canRefund, onClose, onRefundNow }: Props) => {
  const { formatMessage, locale: uiLocale } = useIntl();
  const { toggleNotification } = useNotification();
  const t = (id: string, values?: Record<string, any>) => formatMessage({ id: getTranslation(id) }, values);
  const money = (cents: number) => formatCents(cents, uiLocale);
  const codeText = (code: string) =>
    formatMessage({
      id: getTranslation(`ecommerce.orders.errors.${code}`),
      defaultMessage: t('ecommerce.orders.errors.invalid'),
    });

  const cancelled = order.orderStatus === 'CANCELLED';
  const [idempotencyKey] = useState(() => mintUuid());
  const [form, setForm] = useState<ReturnForm>(() => ({
    lines: defaultReturnLines(order.lines, order.orderStatus),
    reason: '',
    notes: '',
  }));
  const [errors, setErrors] = useState<FormErrors>({});
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  /** The server's value for the quantities typed (`key` = those quantities). */
  const [preview, setPreview] = useState<{ key: string; result: ReturnPreview } | null>(null);
  const previewRequest = useRef(0);
  const previewLines = buildReturnInput(form, idempotencyKey).lines;
  const previewKey = JSON.stringify(previewLines.map((l) => [l.orderLineId, l.quantity]));
  useEffect(() => {
    if (!previewLines.length) return;
    const request = ++previewRequest.current;
    const timer = setTimeout(() => {
      new PreviewReturn()
        .execute(order.id, previewLines)
        .then((result) => {
          if (request === previewRequest.current) setPreview({ key: previewKey, result });
        })
        .catch(() => {
          // An invalid quantity is said by the form on save; the estimate stays shown.
        });
    }, 300);
    return () => clearTimeout(timer);
    // Asked again only when the quantities change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewKey, order.id]);
  const [result, setResult] = useState<ReturnRegistered | null>(null);
  const lineById = new Map(order.lines.map((l) => [l.id, l]));

  /** "€27.90 per unit · discount −€3.10 (Manual discount 10 %)", or just the price per unit. */
  const chargedText = (line: Order['lines'][number]): string => {
    const charged = t('ecommerce.orders.returns.unitPrice', { price: money(line.unitPrice - line.unitDiscount) });
    if (line.unitDiscount <= 0) return charged;
    const label = lineDiscountLabel(line, order.promotions ?? [], uiLocale, (percent) =>
      t('ecommerce.orders.detail.lines.manualDiscount', { percent })
    );
    return `${charged} · ${t('ecommerce.orders.returns.unitDiscount', { amount: money(line.unitDiscount) })}${label ? ` (${label})` : ''}`;
  };

  const clear = (keys: string[]) =>
    setErrors((map) => {
      if (!keys.some((k) => map[k])) return map;
      const next = { ...map };
      keys.forEach((k) => delete next[k]);
      return next;
    });

  const setLine = (orderLineId: number, patch: { quantity?: string; restock?: boolean }) => {
    setForm((f) => ({
      ...f,
      lines: f.lines.map((l) => (l.orderLineId === orderLineId ? { ...l, ...patch } : l)),
    }));
    clear([`lines.${orderLineId}`, 'lines', 'form']);
  };

  /** Validates locally, then asks for confirmation before registering. */
  const askRegister = () => {
    if (saving) return;
    const local = validateReturnForm(form, order.lines);
    if (Object.keys(local).length) {
      setErrors(local);
      return;
    }
    setConfirming(true);
  };

  const submit = async () => {
    setConfirming(false);
    if (saving) return;
    const input = buildReturnInput(form, idempotencyKey);
    setSaving(true);
    try {
      const registered = await new RegisterReturn().execute(order.id, input);
      toggleNotification({ type: 'success', message: t('ecommerce.orders.returns.success') });
      setResult(registered);
    } catch (err) {
      const { errors: map, other } = mapServerFieldErrors(extractFieldErrors(err) ?? [], input.lines, RETURN_PATHS);
      if (other && Object.keys(map).length) map.form = other;
      setErrors(map);
      if (!Object.keys(map).length) {
        toggleNotification({ type: 'danger', message: t(apiErrorMessageId(err, 'ecommerce.orders.returns.error')) });
      }
    } finally {
      setSaving(false);
    }
  };

  const fieldError = (key: string) => (errors[key] ? codeText(errors[key]) : undefined);

  const row = (label: string, value: string, strong = false) => (
    <Flex key={label} justifyContent="space-between" gap={4}>
      <Typography textColor={strong ? 'neutral800' : 'neutral600'} fontWeight={strong ? 'bold' : undefined}>
        {label}
      </Typography>
      <Typography textColor="neutral800" fontWeight={strong ? 'bold' : undefined}>
        {value}
      </Typography>
    </Flex>
  );

  if (result) {
    const r = result.return;
    const showRefund = canRefund && result.refundable > 0;
    return (
      <Modal.Root open onOpenChange={(next: boolean) => !next && onClose(true)}>
        <Modal.Content style={{ maxWidth: 760, width: '100%' }}>
          <Modal.Header>
            <Modal.Title>{t('ecommerce.orders.returns.doneTitle', { id: r.id })}</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <Flex direction="column" alignItems="stretch" gap={5}>
              {/* The units returned, then the operation's figures, each under its title. */}
              <Flex direction="column" alignItems="stretch" gap={2}>
                <Typography variant="sigma" textColor="neutral600">
                  {t('ecommerce.orders.returns.selectedTitle')}
                </Typography>
                <Table colCount={3} rowCount={r.items.length + 1}>
                  <Thead>
                    <Tr>
                      <Th>
                        <Typography variant="sigma">{t('ecommerce.orders.returns.columns.product')}</Typography>
                      </Th>
                      <Th style={FIT_CELL}>
                        <Typography variant="sigma">{t('ecommerce.orders.returns.columns.qty')}</Typography>
                      </Th>
                      <Th style={FIT_CELL}>
                        <Typography variant="sigma">{t('ecommerce.orders.returns.columns.restock')}</Typography>
                      </Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {r.items.map((i) => (
                      <Tr key={i.orderLineId}>
                        <Td style={{ ...PRODUCT_CELL, paddingRight: 24 }}>
                          <Typography textColor="neutral800">{i.name}</Typography>
                          {i.option && (
                            <Typography variant="pi" textColor="neutral600" tag="p">
                              {i.option}
                            </Typography>
                          )}
                        </Td>
                        <Td style={FIT_CELL}>
                          <Typography textColor="neutral800">{i.quantity}</Typography>
                        </Td>
                        <Td style={FIT_CELL}>
                          <Typography textColor="neutral800">
                            {t(i.restock ? 'ecommerce.orders.returns.restocked' : 'ecommerce.orders.returns.notRestocked')}
                          </Typography>
                        </Td>
                      </Tr>
                    ))}
                  </Tbody>
                </Table>
              </Flex>
              <Flex direction="column" alignItems="stretch" gap={2}>
                <Typography variant="sigma" textColor="neutral600">
                  {t('ecommerce.orders.returns.summaryTitle')}
                </Typography>
                <Table colCount={2} rowCount={4}>
                  <Tbody>
                    {[
                      { label: t('ecommerce.orders.returns.gross'), amount: r.grossValue, strong: false },
                      ...(r.discountShare > 0
                        ? [{ label: t('ecommerce.orders.returns.discountShare'), amount: -r.discountShare, strong: false }]
                        : []),
                      { label: t('ecommerce.orders.returns.refundableValue'), amount: r.refundableValue, strong: true },
                      { label: t('ecommerce.orders.returns.refundableNow'), amount: result.refundable, strong: false },
                    ].map((line) => (
                      <Tr key={line.label}>
                        <Td>
                          <Typography textColor="neutral800" fontWeight={line.strong ? 'bold' : undefined}>
                            {line.label}
                          </Typography>
                        </Td>
                        <Td style={{ textAlign: 'right' }}>
                          <Typography textColor="neutral800" fontWeight={line.strong ? 'bold' : undefined}>
                            {money(line.amount)}
                          </Typography>
                        </Td>
                      </Tr>
                    ))}
                  </Tbody>
                </Table>
              </Flex>
              <NoticeBar
                wrap
                text={t(result.refundable > 0 ? 'ecommerce.orders.returns.refundHint' : 'ecommerce.orders.returns.nothingToRefund')}
              />
            </Flex>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="tertiary" onClick={() => onClose(true)}>
              {t('ecommerce.orders.returns.close')}
            </Button>
            {showRefund && (
              <Button variant="secondary"
                onClick={() =>
                  onRefundNow({ reason: 'RETURN', amount: Math.min(r.refundableValue, result.refundable) })
                }
              >
                {t('ecommerce.orders.returns.refundNow')}
              </Button>
            )}
          </Modal.Footer>
        </Modal.Content>
      </Modal.Root>
    );
  }

  const estimate = estimatedReturnValue(form, order.lines);
  // The exact value comes from the server (the same rule the return is registered with); the
  // local estimate shows meanwhile, or if the preview cannot be had.
  const value = preview && preview.key === previewKey ? preview.result.refundableValue : estimate;
  const share = preview && preview.key === previewKey ? preview.result.discountShare : 0;

  return (
    <Modal.Root open onOpenChange={(next: boolean) => !next && !saving && onClose(false)}>
      <Modal.Content style={{ maxWidth: 1100, width: '100%' }}>
        <Modal.Header>
          <Modal.Title>{t('ecommerce.orders.returns.title', { reference: order.reference })}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Flex direction="column" alignItems="stretch" gap={5}>
            {/* Reason and notes first, then the units to return. */}
            <Field.Root name="reason" required error={fieldError('reason')}>
              <Field.Label>{t('ecommerce.orders.returns.reason')}</Field.Label>
              <TextInput
                value={form.reason}
                disabled={saving}
                onChange={(e: any) => {
                  setForm((f) => ({ ...f, reason: e.target.value }));
                  clear(['reason', 'form']);
                }}
              />
              <Field.Error />
            </Field.Root>
            <Field.Root
              name="notes"
              error={fieldError('notes')}
              hint={`${form.notes.length}/${MAX_RETURN_NOTES}`}
            >
              <Field.Label>{t('ecommerce.orders.returns.notes')}</Field.Label>
              <Textarea
                value={form.notes}
                maxLength={MAX_RETURN_NOTES}
                disabled={saving}
                onChange={(e: any) => {
                  setForm((f) => ({ ...f, notes: e.target.value }));
                  clear(['notes', 'form']);
                }}
              />
              <Field.Hint />
              <Field.Error />
            </Field.Root>
            {form.lines.length === 0 ? (
              <Typography textColor="neutral600">{t('ecommerce.orders.returns.nothing')}</Typography>
            ) : (
              <Table colCount={COLUMNS.length} rowCount={form.lines.length + 1}>
                <Thead>
                  <Tr>
                    {COLUMNS.map((c) => (
                      <Th key={c}>
                        <Typography variant="sigma">{t(`ecommerce.orders.returns.columns.${c}`)}</Typography>
                      </Th>
                    ))}
                  </Tr>
                </Thead>
                <Tbody>
                  {form.lines.map((draft) => {
                    const line = lineById.get(draft.orderLineId);
                    if (!line) return null;
                    return (
                      <Tr key={line.id}>
                        {/* A long product name wraps (no ellipsis) instead of running over the columns. */}
                        <Td style={{ ...PRODUCT_CELL, paddingRight: 24 }}>
                          <Flex direction="column" alignItems="flex-start">
                            <Typography textColor="neutral800">
                              {line.name}
                            </Typography>
                            <Typography variant="pi" textColor="neutral600">
                              {[line.option, line.sku].filter(Boolean).join(' · ')}
                            </Typography>
                            {/* What each unit was charged, and its discount (no extra columns). */}
                            <Typography variant="pi" textColor="neutral600">
                              {chargedText(line)}
                            </Typography>
                          </Flex>
                        </Td>
                        <Td style={FIT_CELL}>
                          <Typography textColor="neutral800">{line.shipped}</Typography>
                        </Td>
                        <Td style={FIT_CELL}>
                          <Typography textColor="neutral800">{line.returnedQuantity}</Typography>
                        </Td>
                        <Td style={FIT_CELL}>
                          <Typography textColor="neutral800">{line.returnable}</Typography>
                        </Td>
                        <InputTd style={{ width: 120 }}>
                          <Field.Root name={`quantity-${line.id}`} error={fieldError(`lines.${line.id}`)}>
                            <VisuallyHidden>
                              <Field.Label>{t('ecommerce.orders.returns.columns.quantity')}</Field.Label>
                            </VisuallyHidden>
                            <TextInput
                              value={draft.quantity}
                              inputMode="numeric"
                              disabled={saving}
                              onChange={(e: any) => setLine(line.id, { quantity: e.target.value })}
                            />
                            <Field.Error />
                          </Field.Root>
                        </InputTd>
                        <Td style={FIT_CELL}>
                          <Checkbox
                            checked={draft.restock}
                            disabled={saving || cancelled}
                            aria-label={t('ecommerce.orders.returns.columns.restock')}
                            onCheckedChange={(checked: boolean | 'indeterminate') =>
                              setLine(line.id, { restock: checked === true })
                            }
                          />
                        </Td>
                      </Tr>
                    );
                  })}
                </Tbody>
              </Table>
            )}
            {errors.lines && (
              // Nothing chosen to return: said in words, below the table (not a generic message).
              <Typography variant="pi" textColor="danger600">
                {errors.lines === 'required' ? t('ecommerce.orders.returns.linesRequired') : codeText(errors.lines)}
              </Typography>
            )}
            {cancelled && (
              <Typography variant="pi" textColor="neutral600">
                {t('ecommerce.orders.returns.cancelledNoRestock')}
              </Typography>
            )}


            <Box padding={3} background="neutral100" hasRadius>
              <Flex direction="column" alignItems="stretch" gap={1}>
                {row(t('ecommerce.orders.returns.estimate'), money(value), true)}
                {share > 0 && (
                  <Typography variant="pi" textColor="neutral600">
                    {t('ecommerce.orders.returns.estimateHint', { amount: money(share) })}
                  </Typography>
                )}
              </Flex>
            </Box>
            {errors.form && <Typography textColor="danger600">{codeText(errors.form)}</Typography>}
          </Flex>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="tertiary" onClick={() => onClose(false)} disabled={saving}>
            {t('ecommerce.orders.returns.cancel')}
          </Button>
          <Button variant="secondary" onClick={askRegister} loading={saving} disabled={!form.lines.length}>
            {t('ecommerce.orders.returns.submit')}
          </Button>
        </Modal.Footer>
      </Modal.Content>
      <ActionConfirmModal
        open={confirming}
        title={t('ecommerce.orders.returns.confirm.title')}
        text={t('ecommerce.orders.returns.confirm.text', {
          units: previewLines.reduce((n, l) => n + l.quantity, 0),
          amount: money(value),
        })}
        confirmLabel={t('ecommerce.orders.returns.submit')}
        cancelLabel={t('ecommerce.orders.returns.cancel')}
        confirmVariant="default"
        onConfirm={submit}
        onCancel={() => setConfirming(false)}
      />
    </Modal.Root>
  );
};

export default RegisterReturnModal;
