import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import { useNotification } from '@strapi/strapi/admin';
import {
  Box,
  Button,
  Dialog,
  Field,
  Flex,
  Loader,
  Modal,
  Radio,
  SingleSelect,
  SingleSelectOption,
  Textarea,
  TextInput,
  Typography,
} from '@strapi/design-system';
import { getTranslation } from '../../../core/utils/getTranslation';
import { DateInput } from '../DateInput';
import FetchRefundPreview from '../../usecases/orders/fetchRefundPreview';
import CreateRefund from '../../usecases/orders/createRefund';
import { formatCents } from '../../utils/money';
import { apiErrorMessageId } from '../../utils/orderDetail';
import { extractFieldErrors } from '../../utils/productForm';
import { mintUuid } from '../../utils/variantDraft';
import {
  REFUND_METHODS,
  REFUND_REASONS,
  emptyRefundForm,
  previewForScope,
  refundScopes,
  refundServerErrors,
  scopeLimits,
  switchRefundScope,
  validateRefundForm,
  type RefundDraft,
  type RefundForm,
  type RefundInitial,
} from '../../utils/refundForm';
import { refundElementsTotal, refundOptionValue, selectionKey } from '../../utils/refundCreditNote';
import type { FieldError, InvoiceView, RefundMethod, RefundPreview, RefundScope } from '../../orderTypes';
import { Tile, Tiles } from './SummaryTiles';
import NoticeBar from './NoticeBar';
import RefundElementsTable from './RefundElementsTable';

type Props = {
  orderId: number;
  reference: number;
  /** The order's documents: the invoice lines value the chosen units as the server does. */
  invoices: InvoiceView[];
  /** Prefill (e.g. reason RETURN and the return's value after a return); capped by the preview. */
  initial?: RefundInitial;
  onClose: () => void;
  /** The refund request started (true) or settled (false): the page must keep this modal open meanwhile. */
  onSubmitting?: (submitting: boolean) => void;
  /** After the refund was created (the order changed). */
  onRefunded: () => void;
};

type FormField = Exclude<keyof RefundForm, 'selection'> | 'items';
type ErrorMap = Partial<Record<FormField | 'form', string>>;

const FORM_FIELDS: FormField[] = [
  'amount',
  'items',
  'reason',
  'description',
  'method',
  'reference',
  'expiresAt',
  'conditions',
];

/**
 * Creates a refund (requirement 15.5): amounts from the server preview and the form; Review opens
 * a confirmation (amount, method and its note) before sending. An INVOICED refund (plan 15) is the
 * invoiced elements the admin picks, one table per invoice: its amount is their sum (read-only).
 * Mount it only while open: each opening mints a new idempotency key.
 */
const RefundModal = ({ orderId, reference, invoices, initial, onClose, onSubmitting, onRefunded }: Props) => {
  const { formatMessage, locale: uiLocale } = useIntl();
  const { toggleNotification } = useNotification();
  const t = (id: string, values?: Record<string, any>) =>
    formatMessage({ id: getTranslation(id) }, values);
  const money = (cents: number) => formatCents(cents, uiLocale);

  const [idempotencyKey] = useState(() => mintUuid());
  const [preview, setPreview] = useState<RefundPreview | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [form, setForm] = useState<RefundForm | null>(null);
  const [errors, setErrors] = useState<ErrorMap>({});
  /** Per invoiced element (`selectionKey`): the server's code for it. */
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState<RefundDraft | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    new FetchRefundPreview()
      .execute(orderId)
      .then((p) => {
        if (cancelled) return;
        setPreview(p);
        setForm(emptyRefundForm(p, uiLocale, new Date(), initial));
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
    // `initial` is read once, when the preview arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, uiLocale]);

  const errorText = (code: string) =>
    formatMessage({
      id: getTranslation(`ecommerce.orders.errors.${code}`),
      defaultMessage: t('ecommerce.orders.errors.invalid'),
    });

  const toErrorMap = (list: FieldError[]): ErrorMap => {
    const map: ErrorMap = {};
    list.forEach((e) => {
      const key = (FORM_FIELDS as string[]).includes(e.path) ? (e.path as FormField) : 'form';
      const text =
        key === 'items' && e.code === 'required' ? t('ecommerce.orders.refund.elements.required') : errorText(e.code);
      if (!map[key]) map[key] = text;
    });
    return map;
  };

  const lineOf = (invoiceId: number, index: number) => invoices.find((i) => i.id === invoiceId)?.lines[index];

  /** INVOICED: units of an element chosen; the amount follows. */
  const choose = (invoiceId: number, index: number, quantity: number) => {
    const key = selectionKey(invoiceId, index);
    setForm((f) => (f ? { ...f, selection: { ...f.selection, [key]: quantity } } : f));
    setRowErrors((map) => {
      if (!map[key]) return map;
      const next = { ...map };
      delete next[key];
      return next;
    });
    setErrors((map) => {
      const next = { ...map };
      (['items', 'amount', 'form'] as const).forEach((k) => delete next[k]);
      return next;
    });
  };

  const update = <K extends Exclude<FormField, 'items'>>(field: K, value: RefundForm[K]) => {
    setForm((f) => (f ? { ...f, [field]: value } : f));
    // A new method changes which amount is allowed: its amount error goes too.
    const cleared: (FormField | 'form')[] = field === 'method' ? ['method', 'amount', 'form'] : [field, 'form'];
    setErrors((map) => {
      if (!cleared.some((k) => map[k])) return map;
      const next = { ...map };
      cleared.forEach((k) => delete next[k]);
      return next;
    });
  };

  /** Another scope: its maximum, and a method it allows. */
  const changeScope = (scope: RefundScope) => {
    if (!preview) return;
    setForm((f) => (f ? switchRefundScope(f, preview, scope, uiLocale, initial) : f));
    setErrors((map) => {
      const next = { ...map };
      (['amount', 'items', 'method', 'form'] as const).forEach((k) => delete next[k]);
      return next;
    });
  };

  const review = () => {
    if (!form || !preview) return;
    const result = validateRefundForm(form, preview, new Date(), lineOf);
    if (!result.input) {
      setErrors(toErrorMap(result.errors));
      return;
    }
    setErrors({});
    setRowErrors({});
    setDraft(result.input);
  };

  const submit = async () => {
    if (!draft || saving) return;
    setSaving(true);
    onSubmitting?.(true);
    try {
      const created = await new CreateRefund().execute(orderId, { ...draft, idempotencyKey });
      const processing = created.some((r) => r.status === 'PROCESSING');
      toggleNotification({
        type: 'success',
        message: t(processing ? 'ecommerce.orders.refund.processing' : 'ecommerce.orders.refund.success'),
      });
      onRefunded();
    } catch (err) {
      // `items.<j>` on the element sent at j; the others on their field (e.g. `method`).
      const { rows, fields } = refundServerErrors(extractFieldErrors(err) ?? [], draft.items ?? []);
      const fieldErrors = fields.filter((e) => (FORM_FIELDS as string[]).includes(e.path));
      if (fieldErrors.length || Object.keys(rows).length) {
        // Back to the form with the server's field errors (e.g. the refundable amount changed).
        setErrors(toErrorMap(fieldErrors));
        setRowErrors(rows);
        setDraft(null);
        // The maximums may have changed (e.g. a concurrent refund): refresh them, keep the form.
        new FetchRefundPreview()
          .execute(orderId)
          .then(setPreview)
          .catch(() => undefined);
      } else {
        toggleNotification({
          type: 'danger',
          message: t(apiErrorMessageId(err, 'ecommerce.orders.refund.error')),
        });
      }
    } finally {
      setSaving(false);
      onSubmitting?.(false);
    }
  };

  const amountRows = (p: RefundPreview) => [
    { key: 'total', amount: p.orderTotal },
    { key: 'received', amount: p.received },
    { key: 'refunded', amount: p.refunded },
    { key: 'inFlight', amount: p.inFlight },
    { key: 'refundable', amount: p.refundable, strong: true },
    // Only when it differs: store-credit value never goes back as money.
    ...(p.moneyRefundable < p.refundable ? [{ key: 'moneyRefundable', amount: p.moneyRefundable }] : []),
  ];

  const body = () => {
    if (loadError) {
      return <Typography textColor="danger600">{t('ecommerce.orders.refund.loadError')}</Typography>;
    }
    if (!preview || !form) {
      return (
        <Flex justifyContent="center" padding={6}>
          <Loader small />
        </Flex>
      );
    }

    // The chosen scope's limits (EXCESS: the excess; INVOICED: the invoiced value not yet credited).
    const scoped = previewForScope(preview, form.scope);
    const scopes = refundScopes(preview);
    const invoiced = form.scope === 'INVOICED';
    const elements = preview.invoicedElements?.invoices ?? [];
    const selected = refundElementsTotal(elements, form.selection, lineOf);
    // The figures as tiles on one row, like the payments overview; the refundable one is highlighted
    // (INVOICED: the amount to refund, the sum of the chosen elements, instead).
    const figures = invoiced
      ? [
          ...amountRows(scoped).map((row) => ({ ...row, strong: false })),
          { key: 'selected', amount: selected, strong: true },
        ]
      : amountRows(scoped);
    const amounts = (
      <Tiles $columns={figures.length}>
        {figures.map((row) => (
          // Label on top, value at the bottom: values line up even when a label wraps to 2 lines.
          <Tile key={row.key} $tone={row.strong ? 'success' : undefined} style={{ justifyContent: 'space-between' }}>
            <Typography variant="sigma" textColor="neutral600">
              {t(`ecommerce.orders.refund.summary.${row.key}`)}
            </Typography>
            <Typography variant="beta" tag="p" textColor="neutral800" style={{ whiteSpace: 'nowrap' }}>
              {money(row.amount)}
            </Typography>
          </Tile>
        ))}
      </Tiles>
    );

    if (scopes.length === 0) {
      return (
        <Flex direction="column" alignItems="stretch" gap={4}>
          {amounts}
          <Box padding={3} background="neutral100" hasRadius>
            <Typography variant="omega" textColor="neutral600">
              {t('ecommerce.orders.refund.nothing')}
            </Typography>
          </Box>
        </Flex>
      );
    }

    return (
      <Flex direction="column" alignItems="stretch" gap={5}>
        {amounts}

        {scopes.length > 1 ? (
          // Both are possible: the admin chooses, each with its limit.
          <Field.Root name="scope">
            <Field.Label>{t('ecommerce.orders.refund.scope')}</Field.Label>
            <Radio.Group
              value={form.scope}
              aria-label={t('ecommerce.orders.refund.scope')}
              onValueChange={(value: string) => changeScope(value as RefundScope)}
            >
              {scopes.map((scope) => (
                <Radio.Item key={scope} value={scope}>
                  <Flex direction="column" alignItems="flex-start" gap={1}>
                    <Typography>{t(`ecommerce.orders.refund.scopes.${scope}`)}</Typography>
                    <Typography variant="pi" textColor="neutral600">
                      {t(`ecommerce.orders.refund.scopes.${scope}.hint`, {
                        amount: money(scopeLimits(preview, scope).refundable),
                      })}
                    </Typography>
                  </Flex>
                </Radio.Item>
              ))}
            </Radio.Group>
          </Field.Root>
        ) : (
          form.scope === 'INVOICED' && (
            // No excess: the refund is of invoiced value, with its limit.
            <Flex direction="column" alignItems="flex-start" gap={1}>
              <Typography variant="omega" fontWeight="semiBold" textColor="neutral800">
                {t('ecommerce.orders.refund.scopes.INVOICED')}
              </Typography>
              <Typography variant="pi" textColor="neutral600">
                {t('ecommerce.orders.refund.scopes.INVOICED.hint', { amount: money(scoped.refundable) })}
              </Typography>
            </Flex>
          )
        )}

        {invoiced ? (
          // The invoiced elements, one table per invoice; the amount is their sum (in the tiles).
          <Flex direction="column" alignItems="stretch" gap={4}>
            {elements.length ? (
              <>
                <Typography variant="omega" textColor="neutral700">
                  {t('ecommerce.orders.refund.elements.intro')}
                </Typography>
                {elements.map((invoice) => (
                  <RefundElementsTable
                    key={invoice.invoiceId}
                    invoice={invoice}
                    selection={form.selection}
                    errors={rowErrors}
                    quantityLabel={t('ecommerce.orders.refund.elements.quantity')}
                    valueOf={(option, quantity) =>
                      refundOptionValue(option, quantity, lineOf(invoice.invoiceId, option.index))
                    }
                    disabled={saving}
                    onChoose={choose}
                  />
                ))}
              </>
            ) : (
              <NoticeBar wrap text={t('ecommerce.orders.refund.elements.none')} />
            )}
            {(errors.items || errors.amount) && (
              <Typography variant="omega" textColor="danger600">
                {errors.items ?? errors.amount}
              </Typography>
            )}
          </Flex>
        ) : (
          <Field.Root name="amount" required error={errors.amount}>
            <Field.Label>{t('ecommerce.orders.refund.amount')}</Field.Label>
            <TextInput
              value={form.amount}
              inputMode="decimal"
              endAction={<span>€</span>}
              onChange={(e: any) => update('amount', e.target.value)}
            />
            <Field.Error />
          </Field.Root>
        )}

        <Field.Root name="reason" required error={errors.reason}>
          <Field.Label>{t('ecommerce.orders.refund.reason')}</Field.Label>
          <SingleSelect
            value={form.reason}
            placeholder={t('ecommerce.orders.refund.reasonPlaceholder')}
            onChange={(value: string | number) => update('reason', String(value) as RefundForm['reason'])}
            hasError={!!errors.reason}
          >
            {REFUND_REASONS.map((reason) => (
              <SingleSelectOption key={reason} value={reason}>
                {t(`ecommerce.orders.refund.reasons.${reason}`)}
              </SingleSelectOption>
            ))}
          </SingleSelect>
          <Field.Error />
        </Field.Root>

        <Field.Root name="description" error={errors.description}>
          <Field.Label>{t('ecommerce.orders.refund.description')}</Field.Label>
          <Textarea value={form.description} onChange={(e: any) => update('description', e.target.value)} />
          <Field.Error />
        </Field.Root>
        {/* The description goes into the refund e-mails the customer receives (same look as the top notices). */}
        <NoticeBar text={t('ecommerce.orders.refund.descriptionNotice')} />

        <Field.Root name="method" error={errors.method}>
          <Field.Label>{t('ecommerce.orders.refund.method')}</Field.Label>
          <Radio.Group
            value={form.method}
            aria-label={t('ecommerce.orders.refund.method')}
            onValueChange={(value: string) => update('method', value as RefundMethod)}
          >
            {REFUND_METHODS.map((method) => (
              <Radio.Item
                key={method}
                value={method}
                disabled={
                  (method === 'STRIPE' && (!scoped.hasStripe || scoped.stripeRefundable <= 0)) ||
                  (method !== 'STORE_CREDIT' && scoped.moneyRefundable <= 0)
                }
              >
                {t(`ecommerce.orders.refund.methods.${method}`)}
                {method === 'STRIPE' && (
                  // Why Stripe is (un)available, right after the option, in italics.
                  <Typography variant="pi" textColor="neutral600" style={{ fontStyle: 'italic', marginLeft: 8 }}>
                    {scoped.hasStripe
                      ? t('ecommerce.orders.refund.stripeRefundable', { amount: money(scoped.stripeRefundable) })
                      : t('ecommerce.orders.refund.stripeUnavailable')}
                  </Typography>
                )}
              </Radio.Item>
            ))}
          </Radio.Group>
          <Field.Error />
        </Field.Root>

        {scoped.moneyRefundable <= 0 && (
          <Typography variant="pi" textColor="neutral600">
            {t('ecommerce.orders.refund.moneyOnlyCredit')}
          </Typography>
        )}

        {form.method === 'MANUAL_TRANSFER' && (
          <Field.Root name="reference" error={errors.reference}>
            <Field.Label>{t('ecommerce.orders.refund.reference')}</Field.Label>
            <TextInput value={form.reference} onChange={(e: any) => update('reference', e.target.value)} />
            <Field.Error />
          </Field.Root>
        )}

        {form.method === 'STORE_CREDIT' && (
          <>
            <Field.Root name="expiresAt" required error={errors.expiresAt}>
              <Field.Label>{t('ecommerce.orders.refund.expiresAt')}</Field.Label>
              <DateInput
                type="date"
                value={form.expiresAt}
                onChange={(e: any) => update('expiresAt', e.target.value)}
              />
              <Field.Error />
            </Field.Root>
            <Field.Root name="conditions" error={errors.conditions}>
              <Field.Label>{t('ecommerce.orders.refund.conditions')}</Field.Label>
              <Textarea value={form.conditions} onChange={(e: any) => update('conditions', e.target.value)} />
              <Field.Error />
            </Field.Root>
          </>
        )}

        {errors.form && <Typography textColor="danger600">{errors.form}</Typography>}
      </Flex>
    );
  };

  const canReview =
    !!preview &&
    !!form &&
    refundScopes(preview).length > 0 &&
    (form.scope !== 'INVOICED' || (preview.invoicedElements?.invoices ?? []).length > 0);
  const wide = form?.scope === 'INVOICED';

  return (
    <Modal.Root open onOpenChange={(next: boolean) => !next && !saving && onClose()}>
      <Modal.Content
        // The element tables of an INVOICED refund need the room.
        style={wide ? { maxWidth: 1000, width: '100%' } : undefined}
        // While the confirmation is open (or saving), a stray click on the overlay must not dismiss it.
        onPointerDownOutside={(e: Event) => {
          if (draft || saving) e.preventDefault();
        }}
      >
        <Modal.Header>
          <Modal.Title>{t('ecommerce.orders.refund.title', { reference })}</Modal.Title>
        </Modal.Header>
        <Modal.Body>{body()}</Modal.Body>
        <Modal.Footer>
          <Button variant="tertiary" onClick={onClose} disabled={saving}>
            {t('ecommerce.orders.refund.cancel')}
          </Button>
          <Button variant="secondary" onClick={review} disabled={!canReview || saving}>
            {t('ecommerce.orders.refund.review')}
          </Button>
        </Modal.Footer>
      </Modal.Content>
      {draft && (
        // Confirmation with what will happen: amount, method and what the merchant must know about it.
        <Dialog.Root open onOpenChange={(next: boolean) => !next && !saving && setDraft(null)}>
          <Dialog.Content>
            <Dialog.Header>{t('ecommerce.orders.refund.confirmTitle')}</Dialog.Header>
            <Dialog.Body>
              <Flex direction="column" alignItems="center" gap={2}>
                <Typography variant="omega" fontWeight="semiBold" textColor="neutral800" style={{ textAlign: 'center' }}>
                  {t('ecommerce.orders.refund.confirmText', {
                    amount: money(draft.amount),
                    method: t(`ecommerce.orders.refund.methods.${draft.method}`),
                  })}
                </Typography>
                <Typography variant="omega" textColor="neutral700" style={{ textAlign: 'center' }}>
                  {t(`ecommerce.orders.refund.reviewNote.${draft.method}`)}
                </Typography>
                {draft.scope === 'INVOICED' && (
                  <Typography variant="omega" textColor="neutral700" style={{ textAlign: 'center' }}>
                    {t('ecommerce.orders.refund.reviewNote.INVOICED', { amount: money(draft.amount) })}
                  </Typography>
                )}
              </Flex>
            </Dialog.Body>
            <Dialog.Footer>
              <Flex style={{ width: '100%' }} gap={2}>
                <Button fullWidth variant="tertiary" disabled={saving} onClick={() => setDraft(null)}>
                  {t('ecommerce.orders.refund.cancel')}
                </Button>
                <Button fullWidth variant="danger-light" loading={saving} onClick={submit}>
                  {t('ecommerce.orders.refund.confirm')}
                </Button>
              </Flex>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Root>
      )}
    </Modal.Root>
  );
};

export default RefundModal;
