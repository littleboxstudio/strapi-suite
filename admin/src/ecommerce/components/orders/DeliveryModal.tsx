import { useState } from 'react';
import { useIntl } from 'react-intl';
import { useNotification } from '@strapi/strapi/admin';
import { Button, Checkbox, Field, Flex, Modal, TextInput, Typography } from '@strapi/design-system';
import { getTranslation } from '../../../core/utils/getTranslation';
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

/** Confirms the delivery of one shipment: date and time (default now) and the customer notice. */
const DeliveryModal = ({ shipment, onClose, onDelivered }: Props) => {
  const { formatMessage } = useIntl();
  const { toggleNotification } = useNotification();
  const t = (id: string, values?: Record<string, any>) => formatMessage({ id: getTranslation(id) }, values);

  // The default is "now" to the minute; left untouched, the real current time is sent.
  const [defaultValue] = useState(() => defaultDeliveredAtInput());
  const [deliveredAt, setDeliveredAt] = useState(defaultValue);
  const [notifyCustomer, setNotifyCustomer] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const dateText = (code: string) => t(`ecommerce.orders.shipments.deliver.errors.${code}`);

  const submit = async () => {
    if (saving) return;
    const iso = resolveDeliveredAt(deliveredAt, defaultValue);
    if (!iso) {
      setError(dateText('invalid_date'));
      return;
    }
    setSaving(true);
    try {
      await new ConfirmDelivery().execute(shipment.id, { deliveredAt: iso, notifyCustomer });
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
      <Modal.Content>
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
              <TextInput
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
            <Checkbox
              checked={notifyCustomer}
              disabled={saving}
              onCheckedChange={(checked: boolean | 'indeterminate') => setNotifyCustomer(checked === true)}
            >
              {t('ecommerce.orders.shipments.notifyCustomer')}
            </Checkbox>
            <Typography variant="pi" textColor="neutral600">
              {t('ecommerce.orders.shipments.deliver.notifyHint')}
            </Typography>
          </Flex>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="tertiary" onClick={onClose} disabled={saving}>
            {t('ecommerce.orders.shipments.back')}
          </Button>
          <Button onClick={submit} loading={saving}>
            {t('ecommerce.orders.shipments.deliver.confirm')}
          </Button>
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
};

export default DeliveryModal;
