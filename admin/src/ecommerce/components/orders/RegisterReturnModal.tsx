import { useState } from 'react';
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
import { getTranslation } from '../../../core/utils/getTranslation';
import RegisterReturn from '../../usecases/orders/registerReturn';
import { formatCents } from '../../utils/money';
import { apiErrorMessageId } from '../../utils/orderDetail';
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
import type { FormErrors } from '../../utils/shipmentForm';
import type { RefundInitial } from '../../utils/refundForm';
import type { Order, ReturnRegistered } from '../../orderTypes';

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
  const [result, setResult] = useState<ReturnRegistered | null>(null);
  const lineById = new Map(order.lines.map((l) => [l.id, l]));

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

  const submit = async () => {
    if (saving) return;
    const local = validateReturnForm(form, order.lines);
    if (Object.keys(local).length) {
      setErrors(local);
      return;
    }
    const input = buildReturnInput(form, idempotencyKey);
    setSaving(true);
    try {
      const registered = await new RegisterReturn().execute(order.id, input);
      toggleNotification({ type: 'success', message: t('ecommerce.orders.returns.success') });
      setResult(registered);
    } catch (err) {
      const map: FormErrors = {};
      (extractFieldErrors(err) ?? []).forEach((e) => {
        const m = /^lines\.(\d+)\./.exec(e.path);
        let key = 'form';
        if (m) key = input.lines[Number(m[1])] ? `lines.${input.lines[Number(m[1])].orderLineId}` : 'lines';
        else if (e.path === 'lines' || e.path === 'reason' || e.path === 'notes') key = e.path;
        if (!map[key]) map[key] = e.code;
      });
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
        <Modal.Content>
          <Modal.Header>
            <Modal.Title>{t('ecommerce.orders.returns.doneTitle', { id: r.id })}</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <Flex direction="column" alignItems="stretch" gap={3}>
              {r.items.map((i) => (
                <Typography key={i.orderLineId} variant="omega" textColor="neutral800">
                  {i.quantity} × {i.name}
                  {i.option ? ` (${i.option})` : ''} ·{' '}
                  {t(i.restock ? 'ecommerce.orders.returns.restocked' : 'ecommerce.orders.returns.notRestocked')}
                </Typography>
              ))}
              {row(t('ecommerce.orders.returns.gross'), money(r.grossValue))}
              {r.discountShare > 0 && row(t('ecommerce.orders.returns.discountShare'), money(-r.discountShare))}
              {row(t('ecommerce.orders.returns.refundableValue'), money(r.refundableValue), true)}
              {row(t('ecommerce.orders.returns.refundableNow'), money(result.refundable))}
              <Box padding={3} background="neutral100" hasRadius>
                <Typography variant="omega" textColor="neutral700">
                  {t(result.refundable > 0 ? 'ecommerce.orders.returns.refundHint' : 'ecommerce.orders.returns.nothingToRefund')}
                </Typography>
              </Box>
            </Flex>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="tertiary" onClick={() => onClose(true)}>
              {t('ecommerce.orders.returns.close')}
            </Button>
            {showRefund && (
              <Button
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

  return (
    <Modal.Root open onOpenChange={(next: boolean) => !next && !saving && onClose(false)}>
      <Modal.Content style={{ maxWidth: 960, width: '100%' }}>
        <Modal.Header>
          <Modal.Title>{t('ecommerce.orders.returns.title', { reference: order.reference })}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Flex direction="column" alignItems="stretch" gap={5}>
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
                        <Td style={{ maxWidth: 260 }}>
                          <Flex direction="column" alignItems="flex-start">
                            <Typography textColor="neutral800" ellipsis>
                              {line.name}
                            </Typography>
                            <Typography variant="pi" textColor="neutral600" ellipsis>
                              {[line.option, line.sku].filter(Boolean).join(' · ')}
                            </Typography>
                          </Flex>
                        </Td>
                        <Td>
                          <Typography textColor="neutral800">{line.shipped}</Typography>
                        </Td>
                        <Td>
                          <Typography textColor="neutral800">{line.returnedQuantity}</Typography>
                        </Td>
                        <Td>
                          <Typography textColor="neutral800">{line.returnable}</Typography>
                        </Td>
                        <Td style={{ width: 120 }}>
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
                        </Td>
                        <Td>
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
            {errors.lines && <Typography textColor="danger600">{codeText(errors.lines)}</Typography>}
            {cancelled && (
              <Typography variant="pi" textColor="neutral600">
                {t('ecommerce.orders.returns.cancelledNoRestock')}
              </Typography>
            )}

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
              hint={t('ecommerce.orders.returns.notesHint', { max: MAX_RETURN_NOTES })}
            >
              <Field.Label>{t('ecommerce.orders.returns.notes')}</Field.Label>
              <Textarea
                value={form.notes}
                disabled={saving}
                onChange={(e: any) => {
                  setForm((f) => ({ ...f, notes: e.target.value }));
                  clear(['notes', 'form']);
                }}
              />
              <Field.Hint />
              <Field.Error />
            </Field.Root>

            <Box padding={3} background="neutral100" hasRadius>
              <Flex direction="column" alignItems="stretch" gap={1}>
                {row(t('ecommerce.orders.returns.estimate'), money(estimate), true)}
                <Typography variant="pi" textColor="neutral600">
                  {t('ecommerce.orders.returns.estimateHint')}
                </Typography>
              </Flex>
            </Box>
            {errors.form && <Typography textColor="danger600">{codeText(errors.form)}</Typography>}
          </Flex>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="tertiary" onClick={() => onClose(false)} disabled={saving}>
            {t('ecommerce.orders.returns.cancel')}
          </Button>
          <Button onClick={submit} loading={saving} disabled={!form.lines.length}>
            {t('ecommerce.orders.returns.submit')}
          </Button>
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
};

export default RegisterReturnModal;
