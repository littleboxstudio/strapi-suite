import { useState } from 'react';
import { useIntl } from 'react-intl';
import { useNotification } from '@strapi/strapi/admin';
import { Button, Field, Flex, Modal, Tabs, TextInput, Typography } from '@strapi/design-system';
import { getTranslation } from '../../../core/utils/getTranslation';
import AddOrderPayment from '../../usecases/orders/addOrderPayment';
import AddStoreCreditPayment from '../../usecases/orders/addStoreCreditPayment';
import { extractFieldErrors } from '../../utils/productForm';
import { mintUuid } from '../../utils/variantDraft';
import { MAX_MONEY_CENTS, formatAmountInput, formatCents, parseMoneyToCents } from '../../utils/money';
import { apiErrorCode, apiErrorMessageId, isActionUnavailable } from '../../utils/orderDetail';

type Props = {
  orderId: number;
  /** Amount still due, in cents: the default amount. */
  due: number;
  onClose: () => void;
  onAdded: () => void;
};

type ErrorMap = Partial<Record<'amount' | 'reference' | 'methodLabel' | 'code' | 'form', string>>;

type Tab = 'manual' | 'storeCredit';

/**
 * Registers a manual payment, or pays with a store credit code (`store-credit-payment`). Mount it
 * only while open: each opening mints a new idempotency key.
 */
const AddPaymentModal = ({ orderId, due, onClose, onAdded }: Props) => {
  const { formatMessage, locale: uiLocale } = useIntl();
  const { toggleNotification } = useNotification();
  const t = (id: string, values?: Record<string, any>) =>
    formatMessage({ id: getTranslation(id) }, values);

  // One key per opening: a retried submit returns the payment stored first.
  const [idempotencyKey] = useState(() => mintUuid());
  const [tab, setTab] = useState<Tab>('manual');
  const [amount, setAmount] = useState(() => formatAmountInput(due, uiLocale));
  const [code, setCode] = useState('');
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

  const submitStoreCredit = async () => {
    if (saving) return;
    const value = code.trim().toUpperCase();
    if (!value) {
      setErrors({ code: codeText('required') });
      return;
    }
    setSaving(true);
    try {
      // A distinct key namespace: switching tabs never replays the other tab's operation.
      await new AddStoreCreditPayment().execute(orderId, { code: value, idempotencyKey: `sc:${idempotencyKey}` });
      toggleNotification({ type: 'success', message: t('ecommerce.orders.detail.addPayment.storeCredit.success') });
      onAdded();
    } catch (err) {
      const errorCode = apiErrorCode(err);
      if (errorCode && errorCode.startsWith('STORE_CREDIT_') && errorCode !== 'STORE_CREDIT_CONFLICT') {
        setErrors({ code: codeText(errorCode) });
      } else {
        toggleNotification({
          type: 'danger',
          message: t(apiErrorMessageId(err, 'ecommerce.orders.detail.addPayment.storeCredit.error')),
        });
      }
    } finally {
      setSaving(false);
    }
  };

  const submit = async () => {
    if (tab === 'storeCredit') {
      await submitStoreCredit();
      return;
    }
    if (saving) return;
    const cents = parseMoneyToCents(amount);
    if (cents === null || cents <= 0 || cents > MAX_MONEY_CENTS) {
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
            unavailable
              ? 'ecommerce.orders.detail.actions.unavailable'
              : apiErrorMessageId(err, 'ecommerce.orders.detail.addPayment.error')
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
          <Tabs.Root variant="simple" value={tab} onValueChange={(value: string) => setTab(value as Tab)}>
            <Tabs.List aria-label={t('ecommerce.orders.detail.addPayment.title')}>
              <Tabs.Trigger value="manual" disabled={saving}>
                {t('ecommerce.orders.detail.addPayment.tabs.manual')}
              </Tabs.Trigger>
              <Tabs.Trigger value="storeCredit" disabled={saving}>
                {t('ecommerce.orders.detail.addPayment.tabs.storeCredit')}
              </Tabs.Trigger>
            </Tabs.List>
            <Tabs.Content value="manual">
              <Flex direction="column" alignItems="stretch" gap={5} paddingTop={4}>
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
            </Tabs.Content>
            <Tabs.Content value="storeCredit">
              <Flex direction="column" alignItems="stretch" gap={4} paddingTop={4}>
                <Typography variant="omega" textColor="neutral600">
                  {t('ecommerce.orders.detail.addPayment.storeCredit.hint', { due: formatCents(due, uiLocale) })}
                </Typography>
                <Field.Root name="code" required error={errors.code}>
                  <Field.Label>{t('ecommerce.orders.detail.addPayment.storeCredit.code')}</Field.Label>
                  <TextInput
                    value={code}
                    placeholder="XXXX-XXXX-XXXX"
                    autoComplete="off"
                    onChange={(e: any) => {
                      setCode(e.target.value);
                      clear('code');
                    }}
                  />
                  <Field.Error />
                </Field.Root>
              </Flex>
            </Tabs.Content>
          </Tabs.Root>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="tertiary" onClick={onClose} disabled={saving}>
            {t('ecommerce.orders.detail.addPayment.cancel')}
          </Button>
          <Button onClick={submit} loading={saving}>
            {t(
              tab === 'storeCredit'
                ? 'ecommerce.orders.detail.addPayment.storeCredit.submit'
                : 'ecommerce.orders.detail.addPayment.submit'
            )}
          </Button>
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
};

export default AddPaymentModal;
