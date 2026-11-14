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
  validateRefundForm,
  type RefundDraft,
  type RefundForm,
  type RefundInitial,
} from '../../utils/refundForm';
import type { FieldError, RefundMethod, RefundPreview } from '../../orderTypes';
import { Tile, Tiles } from './SummaryTiles';
import NoticeBar from './NoticeBar';

type Props = {
  orderId: number;
  reference: number;
  /** Prefill (e.g. reason RETURN and the return's value after a return); capped by the preview. */
  initial?: RefundInitial;
  onClose: () => void;
  /** The refund request started (true) or settled (false): the page must keep this modal open meanwhile. */
  onSubmitting?: (submitting: boolean) => void;
  /** After the refund was created (the order changed). */
  onRefunded: () => void;
};

type FormField = keyof RefundForm;
type ErrorMap = Partial<Record<FormField | 'form', string>>;

const FORM_FIELDS: FormField[] = ['amount', 'reason', 'description', 'method', 'reference', 'expiresAt', 'conditions'];

/**
 * Creates a refund (requirement 15.5): amounts from the server preview and the form; Review opens
 * a confirmation (amount, method and its note) before sending. Mount it only while open: each
 * opening mints a new idempotency key.
 */
const RefundModal = ({ orderId, reference, initial, onClose, onSubmitting, onRefunded }: Props) => {
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
      if (!map[key]) map[key] = errorText(e.code);
    });
    return map;
  };

  const update = <K extends FormField>(field: K, value: RefundForm[K]) => {
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

  const review = () => {
    if (!form || !preview) return;
    const result = validateRefundForm(form, preview);
    if (!result.input) {
      setErrors(toErrorMap(result.errors));
      return;
    }
    setErrors({});
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
      const fieldErrors = (extractFieldErrors(err) ?? []).filter((e) =>
        (FORM_FIELDS as string[]).includes(e.path)
      );
      if (fieldErrors.length) {
        // Back to the form with the server's field errors (e.g. the refundable amount changed).
        setErrors(toErrorMap(fieldErrors));
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

    // The figures as tiles on one row, like the payments overview; the refundable one is highlighted.
    const figures = amountRows(preview);
    const amounts = (
      <Tiles style={{ gridTemplateColumns: `repeat(${figures.length}, minmax(0, 1fr))` }}>
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

    if (preview.refundable <= 0) {
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
                  (method === 'STRIPE' && !preview.hasStripe) ||
                  (method !== 'STORE_CREDIT' && preview.moneyRefundable <= 0)
                }
              >
                {t(`ecommerce.orders.refund.methods.${method}`)}
              </Radio.Item>
            ))}
          </Radio.Group>
          <Field.Error />
        </Field.Root>

        {preview.moneyRefundable <= 0 && (
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
              <TextInput
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

        <Typography variant="pi" textColor="neutral600">
          {preview.hasStripe
            ? t('ecommerce.orders.refund.stripeRefundable', { amount: money(preview.stripeRefundable) })
            : t('ecommerce.orders.refund.stripeUnavailable')}
        </Typography>
        {errors.form && <Typography textColor="danger600">{errors.form}</Typography>}
      </Flex>
    );
  };

  const canReview = !!preview && !!form && preview.refundable > 0;

  return (
    <Modal.Root open onOpenChange={(next: boolean) => !next && !saving && onClose()}>
      <Modal.Content
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
          <Button onClick={review} disabled={!canReview || saving}>
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
              </Flex>
            </Dialog.Body>
            <Dialog.Footer>
              <Flex style={{ width: '100%' }} gap={2}>
                <Button fullWidth variant="tertiary" disabled={saving} onClick={() => setDraft(null)}>
                  {t('ecommerce.orders.refund.cancel')}
                </Button>
                <Button fullWidth variant="danger" loading={saving} onClick={submit}>
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
