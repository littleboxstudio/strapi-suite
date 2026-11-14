import { useState } from 'react';
import { useIntl } from 'react-intl';
import { useNotification } from '@strapi/strapi/admin';
import { Button, Flex, Modal, Typography } from '@strapi/design-system';
import { Pin } from '@strapi/icons';
import { getTranslation } from '../../../core/utils/getTranslation';
import UpdateBillingAddress from '../../usecases/orders/updateBillingAddress';
import { addressFormFromAddress, toAddress, type AddressForm } from '../../utils/orderForm';
import { shippingAddressErrors } from '../../utils/orderEditing';
import { apiErrorMessageId } from '../../utils/orderDetail';
import { extractFieldErrors } from '../../utils/productForm';
import { mintUuid } from '../../utils/variantDraft';
import type { EditResult, FieldError, Order } from '../../orderTypes';
import AddressFields, { type AddressField } from './AddressFields';
import NoticeBar from './NoticeBar';

type Props = {
  order: Pick<Order, 'id' | 'billingAddress' | 'billingAddressLock'>;
  /** `orders.manage`. */
  canManage: boolean;
  onSaved: (result: EditResult) => void;
};

/** First code per address field (`address.<field>`); anything else under `form`. */
const errorMap = (errors: FieldError[]): Record<string, string> => {
  const map: Record<string, string> = {};
  errors.forEach(({ path, code }) => {
    const key = path.startsWith('address.') ? path.slice('address.'.length) : 'form';
    if (!(key in map)) map[key] = code;
  });
  return map;
};

/**
 * The order's billing address: editable (with company and NIF) until the first invoice; then the
 * same fields locked, with the reason. Mounted per opening: each opening mints one operationId.
 */
const BillingAddressDialog = ({ order, canManage, onSaved, onClose }: Props & { onClose: () => void }) => {
  const { formatMessage } = useIntl();
  const { toggleNotification } = useNotification();
  const t = (id: string, values?: Record<string, any>) => formatMessage({ id: getTranslation(id) }, values);
  const codeText = (code: string) =>
    formatMessage({
      id: getTranslation(`ecommerce.orders.errors.${code}`),
      defaultMessage: t('ecommerce.orders.errors.invalid'),
    });

  const editable = canManage && !order.billingAddressLock;
  const [operationId] = useState(() => mintUuid());
  const [initial] = useState(() => addressFormFromAddress(order.billingAddress));
  const [form, setForm] = useState<AddressForm>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const change = (field: AddressField, value: string) => {
    setForm((f) => ({ ...f, [field]: value }));
    setErrors({});
  };

  const changed = JSON.stringify(form) !== JSON.stringify(initial);

  const save = async () => {
    if (busy) return;
    const local = shippingAddressErrors(form);
    if (local.length) {
      setErrors(errorMap(local));
      return;
    }
    setBusy(true);
    try {
      const result = await new UpdateBillingAddress().execute(order.id, {
        address: toAddress(form, true),
        operationId,
      });
      onSaved(result);
      toggleNotification({ type: 'success', message: t('ecommerce.orders.address.saved') });
      onClose();
    } catch (err) {
      const fieldErrors = extractFieldErrors(err);
      if (fieldErrors?.length) {
        setErrors(errorMap(fieldErrors));
      } else {
        toggleNotification({
          type: 'danger',
          message: t(apiErrorMessageId(err, 'ecommerce.orders.address.saveError')),
        });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal.Root open onOpenChange={(next: boolean) => !next && !busy && onClose()}>
      <Modal.Content>
        <Modal.Header>
          <Modal.Title>{t('ecommerce.orders.detail.address.billing')}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Flex direction="column" alignItems="stretch" gap={4}>
            {order.billingAddressLock && (
              <NoticeBar text={t(`ecommerce.orders.address.billingLocked.${order.billingAddressLock}`)} />
            )}
            <AddressFields
              name="billingAddress"
              value={form}
              onChange={change}
              errorFor={(field) => (errors[field] ? codeText(errors[field]) : undefined)}
              billing
              disabled={!editable || busy}
            />
            {errors.form && (
              <Typography variant="omega" textColor="danger600">
                {codeText(errors.form)}
              </Typography>
            )}
          </Flex>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="tertiary" onClick={onClose} disabled={busy}>
            {t('ecommerce.orders.notifications.close')}
          </Button>
          {editable && (
            <Button onClick={save} loading={busy} disabled={!changed}>
              {t('ecommerce.orders.address.save')}
            </Button>
          )}
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
};

/** The Billing address button of the Invoices header and its modal. */
const BillingAddressModal = (props: Props) => {
  const { formatMessage } = useIntl();
  // Remounts the dialog per opening (one operationId each).
  const [openKey, setOpenKey] = useState<number | null>(null);

  return (
    <>
      <Button size="S" variant="tertiary" startIcon={<Pin />} onClick={() => setOpenKey((k) => (k ?? 0) + 1)}>
        {formatMessage({ id: getTranslation('ecommerce.orders.detail.address.billing') })}
      </Button>
      {openKey !== null && (
        <BillingAddressDialog key={openKey} {...props} onClose={() => setOpenKey(null)} />
      )}
    </>
  );
};

export default BillingAddressModal;
