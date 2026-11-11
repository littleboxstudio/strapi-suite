import { useState } from 'react';
import { useIntl } from 'react-intl';
import { useNotification } from '@strapi/strapi/admin';
import { Button, Field, Flex, Modal, TextInput } from '@strapi/design-system';
import { getTranslation } from '../../../core/utils/getTranslation';
import UpdateShipmentTracking from '../../usecases/orders/updateShipmentTracking';
import { apiErrorMessageId } from '../../utils/orderDetail';
import { extractFieldErrors } from '../../utils/productForm';
import { validateTrackingForm, type FormErrors } from '../../utils/shipmentForm';
import type { ShipmentView } from '../../orderTypes';

type Props = {
  shipment: ShipmentView;
  onClose: () => void;
  onSaved: () => void;
};

const FIELDS = ['trackingCode', 'trackingUrl'] as const;

/** Edits the tracking code and link of a shipment; an empty field clears it. */
const TrackingModal = ({ shipment, onClose, onSaved }: Props) => {
  const { formatMessage } = useIntl();
  const { toggleNotification } = useNotification();
  const t = (id: string, values?: Record<string, any>) => formatMessage({ id: getTranslation(id) }, values);
  const codeText = (code: string) =>
    formatMessage({
      id: getTranslation(`ecommerce.orders.errors.${code}`),
      defaultMessage: t('ecommerce.orders.errors.invalid'),
    });

  const [form, setForm] = useState({
    trackingCode: shipment.trackingCode ?? '',
    trackingUrl: shipment.trackingUrl ?? '',
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (saving) return;
    const local = validateTrackingForm(form);
    if (Object.keys(local).length) {
      setErrors(local);
      return;
    }
    setSaving(true);
    try {
      await new UpdateShipmentTracking().execute(shipment.id, {
        trackingCode: form.trackingCode.trim() || null,
        trackingUrl: form.trackingUrl.trim() || null,
      });
      toggleNotification({ type: 'success', message: t('ecommerce.orders.shipments.tracking.success') });
      onSaved();
    } catch (err) {
      const map: FormErrors = {};
      (extractFieldErrors(err) ?? []).forEach((e) => {
        if ((FIELDS as readonly string[]).includes(e.path) && !map[e.path]) map[e.path] = e.code;
      });
      setErrors(map);
      if (!Object.keys(map).length) {
        toggleNotification({
          type: 'danger',
          message: t(apiErrorMessageId(err, 'ecommerce.orders.shipments.tracking.error')),
        });
      }
    } finally {
      setSaving(false);
    }
  };

  const change = (field: (typeof FIELDS)[number], value: string) => {
    setForm((f) => ({ ...f, [field]: value }));
    setErrors(({ [field]: _removed, ...rest }) => rest);
  };

  return (
    <Modal.Root open onOpenChange={(next: boolean) => !next && !saving && onClose()}>
      <Modal.Content>
        <Modal.Header>
          <Modal.Title>{t('ecommerce.orders.shipments.tracking.title', { id: shipment.id })}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Flex direction="column" alignItems="stretch" gap={5}>
            <Field.Root name="trackingCode" error={errors.trackingCode ? codeText(errors.trackingCode) : undefined}>
              <Field.Label>{t('ecommerce.orders.shipments.trackingCode')}</Field.Label>
              <TextInput value={form.trackingCode} disabled={saving} onChange={(e: any) => change('trackingCode', e.target.value)} />
              <Field.Error />
            </Field.Root>
            <Field.Root
              name="trackingUrl"
              error={errors.trackingUrl ? codeText(errors.trackingUrl) : undefined}
              hint={t('ecommerce.orders.shipments.trackingUrlHint')}
            >
              <Field.Label>{t('ecommerce.orders.shipments.trackingUrl')}</Field.Label>
              <TextInput
                type="url"
                placeholder="https://"
                value={form.trackingUrl}
                disabled={saving}
                onChange={(e: any) => change('trackingUrl', e.target.value)}
              />
              <Field.Hint />
              <Field.Error />
            </Field.Root>
          </Flex>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="tertiary" onClick={onClose} disabled={saving}>
            {t('ecommerce.orders.shipments.back')}
          </Button>
          <Button onClick={submit} loading={saving}>
            {t('ecommerce.orders.shipments.tracking.save')}
          </Button>
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
};

export default TrackingModal;
