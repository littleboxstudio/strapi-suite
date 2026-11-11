import { useState } from 'react';
import { useIntl } from 'react-intl';
import { useNotification } from '@strapi/strapi/admin';
import { Box, Button, Field, Flex, Grid, Modal, Radio, TextInput, Typography } from '@strapi/design-system';
import { getTranslation } from '../../../core/utils/getTranslation';
import PreviewOrderModification from '../../usecases/orders/previewOrderModification';
import ApplyOrderModification from '../../usecases/orders/applyOrderModification';
import { extractFieldErrors } from '../../utils/productForm';
import { mintUuid } from '../../utils/variantDraft';
import { formatCents } from '../../utils/money';
import { isActionUnavailable } from '../../utils/orderDetail';
import type { AddressForm } from '../../utils/orderForm';
import {
  SHIPPING_MODES,
  addModifyLine,
  buildModificationInput,
  modifyFormFromOrder,
  removeModifyLine,
  restoreModifyLine,
  setModifyLineQuantity,
  toModificationErrorMap,
  validateModificationForm,
  type ModificationErrorMap,
  type ModifyOrderForm,
  type ShippingMode,
} from '../../utils/modification';
import type { FieldError, ModificationApplied, ModificationPreview, Order } from '../../orderTypes';
import ModifyLinesEditor from './ModifyLinesEditor';
import ModificationSummary from './ModificationSummary';
import VariantPicker from './VariantPicker';
import AddressFields, { type AddressField } from './AddressFields';
import OrderSection from './OrderSection';

export type ModifyOrderModalProps = {
  order: Order;
  onClose: () => void;
  /** Called after a modification is applied; the page refetches the order. */
  onApplied: (result: ModificationApplied) => void;
};

type AddressKind = 'shippingAddress' | 'billingAddress';

/**
 * Modifies an order (requirement 16): edit, then review the server preview, then confirm.
 * Mount it only while open: each opening mints the operationId reused by confirm retries.
 */
const ModifyOrderModal = ({ order, onClose, onApplied }: ModifyOrderModalProps) => {
  const { formatMessage, locale: uiLocale } = useIntl();
  const { toggleNotification } = useNotification();
  const t = (id: string, values?: Record<string, any>) =>
    formatMessage({ id: getTranslation(id) }, values);

  const [operationId] = useState(() => mintUuid());
  const [form, setForm] = useState<ModifyOrderForm>(() => modifyFormFromOrder(order));
  const [step, setStep] = useState<'edit' | 'review'>('edit');
  const [preview, setPreview] = useState<ModificationPreview | null>(null);
  const [errors, setErrors] = useState<ModificationErrorMap>({});
  const [busy, setBusy] = useState<'preview' | 'apply' | null>(null);
  const [lastQuote, setLastQuote] = useState<number | null>(null);

  const codeText = (code: string) =>
    formatMessage({
      id: getTranslation(`ecommerce.orders.errors.${code}`),
      defaultMessage: t('ecommerce.orders.errors.invalid'),
    });
  const errorText = (key: string) => (errors[key] ? codeText(errors[key]) : undefined);

  const change = (next: ModifyOrderForm, clearKeys: string[] = []) => {
    setForm(next);
    if (clearKeys.length) {
      setErrors((map) => {
        if (!clearKeys.some((k) => k in map)) return map;
        const out = { ...map };
        clearKeys.forEach((k) => delete out[k]);
        return out;
      });
    }
  };

  const showErrors = (draft: ModifyOrderForm, list: FieldError[]) => {
    setErrors(toModificationErrorMap(draft, list));
    setStep('edit');
    setPreview(null);
    toggleNotification({ type: 'warning', message: t('ecommerce.orders.errors.fix') });
  };

  const handleFailure = (err: unknown, fallbackKey: string) => {
    const fieldErrors = extractFieldErrors(err);
    if (fieldErrors?.length && !isActionUnavailable(err)) {
      showErrors(form, fieldErrors);
      return;
    }
    toggleNotification({
      type: 'danger',
      message: t(isActionUnavailable(err) ? 'ecommerce.orders.detail.actions.unavailable' : fallbackKey),
    });
  };

  const review = async () => {
    if (busy) return;
    const local = validateModificationForm(form);
    if (local.length) {
      showErrors(form, local);
      return;
    }
    setBusy('preview');
    try {
      const result = await new PreviewOrderModification().execute(order.id, buildModificationInput(form));
      if (result.shipping.mode === 'RECALCULATE' && result.shipping.quote !== undefined) {
        setLastQuote(result.shipping.quote);
      }
      if (result.errors.length) {
        showErrors(form, result.errors);
        return;
      }
      setErrors({});
      setPreview(result);
      setStep('review');
    } catch (err) {
      handleFailure(err, 'ecommerce.orders.modify.previewError');
    } finally {
      setBusy(null);
    }
  };

  const confirm = async () => {
    if (busy) return;
    setBusy('apply');
    try {
      const result = await new ApplyOrderModification().execute(order.id, {
        ...buildModificationInput(form),
        operationId,
      });
      toggleNotification({ type: 'success', message: t('ecommerce.orders.modify.success') });
      onApplied(result);
    } catch (err) {
      handleFailure(err, 'ecommerce.orders.modify.error');
    } finally {
      setBusy(null);
    }
  };

  const setAddress = (kind: AddressKind) => (field: AddressField, value: string) =>
    change({ ...form, [kind]: { ...form[kind], [field]: value } as AddressForm }, [`${kind}.${field}`]);

  const shippingDescription = (mode: ShippingMode) => {
    if (mode === 'KEEP') {
      return t('ecommerce.orders.modify.shipping.keepHint', {
        amount: formatCents(order.totals.shippingTotal, uiLocale),
      });
    }
    if (mode === 'RECALCULATE') {
      return lastQuote !== null
        ? t('ecommerce.orders.modify.shipping.lastQuote', { amount: formatCents(lastQuote, uiLocale) })
        : t('ecommerce.orders.modify.shipping.recalculateHint');
    }
    return t('ecommerce.orders.modify.shipping.manualHint');
  };

  const disabled = busy !== null;

  const editStep = (
    <Flex direction="column" alignItems="stretch" gap={6}>
      <OrderSection title={t('ecommerce.orders.detail.lines.title')}>
        <Flex direction="column" alignItems="stretch" gap={4}>
          <ModifyLinesEditor
            lines={form.lines}
            disabled={disabled}
            errorFor={(key) => errorText(`line.${key}`)}
            onQuantityChange={(key, quantity) =>
              change({ ...form, lines: setModifyLineQuantity(form.lines, key, quantity) }, [`line.${key}`])
            }
            onRemove={(key) => change({ ...form, lines: removeModifyLine(form.lines, key) }, [`line.${key}`])}
            onRestore={(key) => change({ ...form, lines: restoreModifyLine(form.lines, key) }, [`line.${key}`])}
          />
          {errors.lines && <Typography textColor="danger600">{errorText('lines')}</Typography>}
          <VariantPicker
            locale={order.locale}
            disabled={disabled}
            onAdd={(v) => change({ ...form, lines: addModifyLine(form.lines, v) }, ['lines'])}
          />
        </Flex>
      </OrderSection>

      <Grid.Root gap={6}>
        {(['shippingAddress', 'billingAddress'] as const).map((kind) => (
          <Grid.Item key={kind} col={6} s={12} direction="column" alignItems="stretch">
            <OrderSection
              title={t(`ecommerce.orders.detail.address.${kind === 'shippingAddress' ? 'shipping' : 'billing'}`)}
            >
              <AddressFields
                name={`modify.${kind}`}
                value={form[kind]}
                billing={kind === 'billingAddress'}
                disabled={disabled}
                onChange={setAddress(kind)}
                errorFor={(field) => errorText(`${kind}.${field}`)}
              />
            </OrderSection>
          </Grid.Item>
        ))}
      </Grid.Root>

      <OrderSection title={t('ecommerce.orders.shipping.title')}>
        <Flex direction="column" alignItems="stretch" gap={4}>
          <Radio.Group
            value={form.shippingMode}
            disabled={disabled}
            aria-label={t('ecommerce.orders.shipping.title')}
            onValueChange={(value: string) =>
              change({ ...form, shippingMode: value as ShippingMode }, ['shipping', 'shipping.amount'])
            }
          >
            {SHIPPING_MODES.map((mode) => (
              <Radio.Item key={mode} value={mode}>
                <Flex direction="column" alignItems="flex-start">
                  <Typography textColor="neutral800">{t(`ecommerce.orders.modify.shipping.${mode}`)}</Typography>
                  <Typography variant="pi" textColor="neutral600">
                    {shippingDescription(mode)}
                  </Typography>
                </Flex>
              </Radio.Item>
            ))}
          </Radio.Group>
          {form.shippingMode === 'MANUAL' && (
            <Box style={{ maxWidth: 240 }}>
              <Field.Root name="shipping.amount" required error={errorText('shipping.amount')}>
                <Field.Label>{t('ecommerce.orders.modify.shipping.amount')}</Field.Label>
                <TextInput
                  value={form.manualAmount}
                  inputMode="decimal"
                  disabled={disabled}
                  endAction={<span>€</span>}
                  onChange={(e: any) => change({ ...form, manualAmount: e.target.value }, ['shipping.amount'])}
                />
                <Field.Error />
              </Field.Root>
            </Box>
          )}
          {errors.shipping && <Typography textColor="danger600">{errorText('shipping')}</Typography>}
          {form.shippingMode !== 'MANUAL' && errors['shipping.amount'] && (
            <Typography textColor="danger600">{errorText('shipping.amount')}</Typography>
          )}
        </Flex>
      </OrderSection>

      {errors.form && <Typography textColor="danger600">{errorText('form')}</Typography>}
    </Flex>
  );

  return (
    <Modal.Root open onOpenChange={(next: boolean) => !next && !busy && onClose()}>
      <Modal.Content>
        <Modal.Header>
          <Modal.Title>
            {step === 'edit'
              ? t('ecommerce.orders.modify.title', { reference: order.reference })
              : t('ecommerce.orders.modify.summary.title', { reference: order.reference })}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {step === 'review' && preview ? <ModificationSummary preview={preview} form={form} /> : editStep}
        </Modal.Body>
        <Modal.Footer>
          {step === 'edit' ? (
            <>
              <Button variant="tertiary" onClick={onClose} disabled={disabled}>
                {t('ecommerce.orders.modify.cancel')}
              </Button>
              <Button onClick={review} loading={busy === 'preview'} disabled={disabled}>
                {t('ecommerce.orders.modify.review')}
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="tertiary"
                disabled={disabled}
                onClick={() => {
                  setStep('edit');
                  setPreview(null);
                }}
              >
                {t('ecommerce.orders.modify.back')}
              </Button>
              <Button onClick={confirm} loading={busy === 'apply'} disabled={disabled}>
                {t('ecommerce.orders.modify.confirm')}
              </Button>
            </>
          )}
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
};

export default ModifyOrderModal;
