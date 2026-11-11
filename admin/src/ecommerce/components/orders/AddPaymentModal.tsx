import { useState } from 'react';
import { useIntl } from 'react-intl';
import { useNotification } from '@strapi/strapi/admin';
import { Button, Field, Flex, Modal, TextInput } from '@strapi/design-system';
import { getTranslation } from '../../../core/utils/getTranslation';
import AddOrderPayment from '../../usecases/orders/addOrderPayment';
import { extractFieldErrors } from '../../utils/productForm';
import { mintUuid } from '../../utils/variantDraft';
import { parseMoneyToCents } from '../../utils/money';
import { isActionUnavailable } from '../../utils/orderDetail';

type Props = {
  orderId: number;
  /** Amount still due, in cents: the default amount. */
  due: number;
  onClose: () => void;
  onAdded: () => void;
};

type ErrorMap = Partial<Record<'amount' | 'reference' | 'methodLabel' | 'form', string>>;

/** Decimal amount in the admin's locale, without currency or grouping (e.g. "17,50"). */
const formatAmount = (cents: number, locale: string) =>
  new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: false,
  }).format(Math.max(0, cents) / 100);

/** Registers a manual payment. Mount it only while open: each opening mints a new idempotency key. */
const AddPaymentModal = ({ orderId, due, onClose, onAdded }: Props) => {
  const { formatMessage, locale: uiLocale } = useIntl();
  const { toggleNotification } = useNotification();
  const t = (id: string, values?: Record<string, any>) =>
    formatMessage({ id: getTranslation(id) }, values);

  // One key per opening: a retried submit returns the payment stored first.
  const [idempotencyKey] = useState(() => mintUuid());
  const [amount, setAmount] = useState(() => formatAmount(due, uiLocale));
  const [reference, setReference] = useState('');
  const [methodLabel, setMethodLabel] = useState('');
  const [errors, setErrors] = useState<ErrorMap>({});
  const [saving, setSaving] = useState(false);

  const codeText = (code: string) =>
    formatMessage({
      id: getTranslation(
        code === 'invalid_amount' ? 'ecommerce.orders.detail.addPayment.invalid_amount' : `ecommerce.orders.errors.${code}`
      ),
      defaultMessage: t('ecommerce.orders.errors.invalid'),
    });

  const submit = async () => {
    if (saving) return;
    const cents = parseMoneyToCents(amount);
    if (cents === null || cents <= 0) {
      setErrors({ amount: codeText('invalid_amount') });
      return;
    }
    setSaving(true);
    try {
      await new AddOrderPayment().execute(orderId, {
        amount: cents,
        reference: reference.trim() || undefined,
        methodLabel: methodLabel.trim() || undefined,
        idempotencyKey,
      });
      toggleNotification({ type: 'success', message: t('ecommerce.orders.detail.addPayment.success') });
      onAdded();
    } catch (err) {
      const fieldErrors = extractFieldErrors(err);
      const map: ErrorMap = {};
      (fieldErrors ?? []).forEach((e) => {
        const key = e.path === 'amount' || e.path === 'reference' || e.path === 'methodLabel' ? e.path : 'form';
        if (!map[key]) map[key] = codeText(e.code);
      });
      setErrors(map);
      if (!map.amount && !map.reference && !map.methodLabel) {
        const unavailable = isActionUnavailable(err);
        toggleNotification({
          type: 'danger',
          message: t(
            unavailable ? 'ecommerce.orders.detail.actions.unavailable' : 'ecommerce.orders.detail.addPayment.error'
          ),
        });
      }
    } finally {
      setSaving(false);
    }
  };

  const clear = (key: keyof ErrorMap) =>
    setErrors((map) => {
      if (!map[key]) return map;
      const { [key]: _removed, ...rest } = map;
      return rest;
    });

  return (
    <Modal.Root open onOpenChange={(next: boolean) => !next && onClose()}>
      <Modal.Content>
        <Modal.Header>
          <Modal.Title>{t('ecommerce.orders.detail.addPayment.title')}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Flex direction="column" alignItems="stretch" gap={5}>
            <Field.Root name="amount" required error={errors.amount}>
              <Field.Label>{t('ecommerce.orders.detail.addPayment.amount')}</Field.Label>
              <TextInput
                value={amount}
                inputMode="decimal"
                endAction={<span>€</span>}
                onChange={(e: any) => {
                  setAmount(e.target.value);
                  clear('amount');
                }}
              />
              <Field.Error />
            </Field.Root>
            <Field.Root name="reference" error={errors.reference}>
              <Field.Label>{t('ecommerce.orders.detail.addPayment.reference')}</Field.Label>
              <TextInput
                value={reference}
                onChange={(e: any) => {
                  setReference(e.target.value);
                  clear('reference');
                }}
              />
              <Field.Error />
            </Field.Root>
            <Field.Root name="methodLabel" error={errors.methodLabel}>
              <Field.Label>{t('ecommerce.orders.detail.addPayment.method')}</Field.Label>
              <TextInput
                value={methodLabel}
                placeholder={t('ecommerce.orders.detail.addPayment.methodPlaceholder')}
                onChange={(e: any) => {
                  setMethodLabel(e.target.value);
                  clear('methodLabel');
                }}
              />
              <Field.Error />
            </Field.Root>
          </Flex>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="tertiary" onClick={onClose} disabled={saving}>
            {t('ecommerce.orders.detail.addPayment.cancel')}
          </Button>
          <Button onClick={submit} loading={saving}>
            {t('ecommerce.orders.detail.addPayment.submit')}
          </Button>
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
};

export default AddPaymentModal;
