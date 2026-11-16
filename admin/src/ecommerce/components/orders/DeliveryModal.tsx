import { useState } from 'react';
import { useIntl } from 'react-intl';
import { useNotification } from '@strapi/strapi/admin';
import { Button, Field, Flex, Modal, Typography } from '@strapi/design-system';
import { getTranslation } from '../../../core/utils/getTranslation';
import { ActionConfirmModal } from '../ActionConfirmModal';
import { DateInput } from '../DateInput';
import ConfirmDelivery from '../../usecases/orders/confirmDelivery';
import { apiErrorMessageId } from '../../utils/orderDetail';
import { extractFieldErrors } from '../../utils/productForm';
import { defaultDeliveredAtInput, resolveDeliveredAt } from '../../utils/shipmentForm';
import type { ShipmentView } from '../../orderTypes';

type Props = {
  shipment: ShipmentView;
  onClose: () => void;
  onDelivered: () => void;
};

/** Date errors of the delivery endpoint, with delivery-specific wording. */
const DATE_CODES = ['invalid_date', 'before_shipment', 'in_future', 'invalid_shipped_at'];

/**
 * Confirms the delivery of one shipment: date and time (default now), then a confirmation. The
 * customer is always notified (the e-mail goes once the whole order is delivered).
 */
const DeliveryModal = ({ shipment, onClose, onDelivered }: Props) => {
  const { formatMessage, formatDate } = useIntl();
  const { toggleNotification } = useNotification();
  const t = (id: string, values?: Record<string, any>) => formatMessage({ id: getTranslation(id) }, values);

  // The default is "now" to the minute; left untouched, the real current time is sent.
  const [defaultValue] = useState(() => defaultDeliveredAtInput());
  const [deliveredAt, setDeliveredAt] = useState(defaultValue);
  /** The Confirm button asks first; the delivery is recorded on confirmation. */
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const dateText = (code: string) => t(`ecommerce.orders.shipments.deliver.errors.${code}`);

  /** Validates the date locally, then asks for confirmation. */
  const askConfirm = () => {
    if (saving) return;
    if (!resolveDeliveredAt(deliveredAt, defaultValue)) {
      setError(dateText('invalid_date'));
      return;
    }
    setConfirming(true);
  };

  const submit = async () => {
    setConfirming(false);
    if (saving) return;
    const iso = resolveDeliveredAt(deliveredAt, defaultValue);
    if (!iso) {
      setError(dateText('invalid_date'));
      return;
    }
    setSaving(true);
    try {
      await new ConfirmDelivery().execute(shipment.id, { deliveredAt: iso, notifyCustomer: true });
      toggleNotification({ type: 'success', message: t('ecommerce.orders.shipments.deliver.success') });
      onDelivered();
    } catch (err) {
      const dateError = (extractFieldErrors(err) ?? []).find((e) => DATE_CODES.includes(e.code));
      if (dateError) setError(dateText(dateError.code));
      else {
        toggleNotification({
          type: 'danger',
          message: t(apiErrorMessageId(err, 'ecommerce.orders.shipments.deliver.error')),
        });
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal.Root open onOpenChange={(next: boolean) => !next && !saving && onClose()}>
      {/* No autofocus: focusing the date field opens its calendar, which should follow a user action. */}
      <Modal.Content onOpenAutoFocus={(e: Event) => e.preventDefault()}>
        <Modal.Header>
          <Modal.Title>{t('ecommerce.orders.shipments.deliver.title', { id: shipment.id })}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Flex direction="column" alignItems="stretch" gap={5}>
            <Typography variant="omega" textColor="neutral600">
              {t('ecommerce.orders.shipments.deliver.text', { carrier: shipment.carrierName })}
            </Typography>
            <Field.Root name="deliveredAt" required error={error ?? undefined}>
              <Field.Label>{t('ecommerce.orders.shipments.deliver.deliveredAt')}</Field.Label>
              <DateInput
                type="datetime-local"
                value={deliveredAt}
                disabled={saving}
                onChange={(e: any) => {
                  setDeliveredAt(e.target.value);
                  setError(null);
                }}
              />
              <Field.Error />
            </Field.Root>
          </Flex>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="tertiary" onClick={onClose} disabled={saving}>
            {t('ecommerce.orders.shipments.back')}
          </Button>
          <Button variant="secondary" onClick={askConfirm} loading={saving}>
            {t('ecommerce.orders.shipments.deliver.confirm')}
          </Button>
        </Modal.Footer>
      </Modal.Content>
      <ActionConfirmModal
        open={confirming}
        title={t('ecommerce.orders.shipments.deliver.confirmTitle')}
        text={
          <Flex direction="column" gap={3}>
            <Typography>
              {t('ecommerce.orders.shipments.deliver.confirmText', {
                id: shipment.id,
                date: deliveredAt ? formatDate(new Date(deliveredAt), { dateStyle: 'medium', timeStyle: 'short' }) : '',
              })}
            </Typography>
            <Typography textColor="neutral600">{t('ecommerce.orders.shipments.deliver.notifyHint')}</Typography>
          </Flex>
        }
        confirmLabel={t('ecommerce.orders.shipments.deliver.confirm')}
        cancelLabel={t('ecommerce.orders.shipments.back')}
        confirmVariant="default"
        onConfirm={submit}
        onCancel={() => setConfirming(false)}
      />
    </Modal.Root>
  );
};

export default DeliveryModal;
