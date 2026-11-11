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
  Radio,
  Table,
  Tbody,
  Td,
  TextInput,
  Th,
  Thead,
  Tr,
  Typography,
  VisuallyHidden,
} from '@strapi/design-system';
import { getTranslation } from '../../../core/utils/getTranslation';
import CreateShipment from '../../usecases/orders/createShipment';
import { apiErrorCode, apiErrorMessageId, shouldRenewIdempotencyKey } from '../../utils/orderDetail';
import { extractFieldErrors } from '../../utils/productForm';
import { mintUuid } from '../../utils/variantDraft';
import {
  buildShipmentInput,
  canShipByCarrier,
  emptyShipForm,
  mapServerFieldErrors,
  validateShipForm,
  type FormErrors,
  type ShipForm,
  type ShipMode,
} from '../../utils/shipmentForm';
import type { Order } from '../../orderTypes';

type Props = {
  order: Order;
  onClose: () => void;
  /** After a shipment was created (or left pending at the carrier). */
  onShipped: () => void;
};

const THUMBNAIL_SIZE = 32;
const COLUMNS = ['product', 'sku', 'ordered', 'shipped', 'pending', 'quantity'] as const;

/** Server paths of the create body → form paths. */
const METHOD_PATHS: Record<string, string> = {
  'method.carrierName': 'carrierName',
  'method.trackingCode': 'trackingCode',
  'method.trackingUrl': 'trackingUrl',
  shippingCost: 'shippingCost',
  lines: 'lines',
};

/**
 * Ships units of the order (requirements 10.4 and 12.6), manually or through the order's carrier.
 * Mount it only while open: each opening mints a new idempotency key.
 */
const ShipOrderModal = ({ order, onClose, onShipped }: Props) => {
  const { formatMessage, locale: uiLocale } = useIntl();
  const { toggleNotification } = useNotification();
  const t = (id: string, values?: Record<string, any>) => formatMessage({ id: getTranslation(id) }, values);
  const codeText = (code: string) =>
    formatMessage({
      id: getTranslation(`ecommerce.orders.errors.${code}`),
      defaultMessage: t('ecommerce.orders.errors.invalid'),
    });

  // One key per opening; a carrier failure is final, so the next attempt gets a new one.
  const [idempotencyKey, setIdempotencyKey] = useState(() => mintUuid());
  const [form, setForm] = useState<ShipForm>(() => emptyShipForm(order, uiLocale));
  const [errors, setErrors] = useState<FormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const carrierAvailable = canShipByCarrier(order.shippingMethod);
  const lineById = new Map(order.lines.map((l) => [l.id, l]));

  const update = (patch: Partial<ShipForm>, clear: string[]) => {
    setForm((f) => ({ ...f, ...patch }));
    setFormError(null);
    setErrors((map) => {
      if (!clear.some((k) => map[k])) return map;
      const next = { ...map };
      clear.forEach((k) => delete next[k]);
      return next;
    });
  };

  const setQuantity = (orderLineId: number, quantity: string) => {
    setForm((f) => ({
      ...f,
      lines: f.lines.map((l) => (l.orderLineId === orderLineId ? { ...l, quantity } : l)),
    }));
    update({}, [`lines.${orderLineId}`, 'lines']);
  };

  /** Field errors of the server mapped back to the form; the rest becomes the form message. */
  const showServerErrors = (err: unknown, sentLines: { orderLineId: number }[]) => {
    const { errors: map, other } = mapServerFieldErrors(extractFieldErrors(err) ?? [], sentLines, METHOD_PATHS);
    setErrors(map);
    if (!Object.keys(map).length) {
      setFormError(t(apiErrorMessageId(err, 'ecommerce.orders.ship.error')));
    } else if (other) {
      setFormError(codeText(other));
    }
  };

  const submit = async () => {
    if (saving) return;
    const local = validateShipForm(form, order.lines);
    if (Object.keys(local).length) {
      setErrors(local);
      return;
    }
    const input = buildShipmentInput(form, idempotencyKey);
    setSaving(true);
    try {
      const shipment = await new CreateShipment().execute(order.id, input);
      if (shipment.status === 'FAILED') {
        // A replay of an attempt that failed at the carrier: say why, the next try is new.
        setIdempotencyKey(mintUuid());
        setFormError(shipment.error ? codeText(shipment.error) : t('ecommerce.orders.ship.error'));
        return;
      }
      toggleNotification({
        type: shipment.status === 'PENDING' ? 'warning' : 'success',
        message: t(shipment.status === 'PENDING' ? 'ecommerce.orders.ship.uncertain' : 'ecommerce.orders.ship.success'),
      });
      onShipped();
    } catch (err) {
      const code = apiErrorCode(err);
      const hasFieldErrors = !!extractFieldErrors(err)?.length;
      // A carrier refusal (4xx with a code, no field errors) left a FAILED row behind. A 5xx or no
      // answer keeps the key: the shipment may exist, and a retry replays it.
      if (code && !hasFieldErrors && input.method.mode === 'CARRIER' && shouldRenewIdempotencyKey(err)) {
        setIdempotencyKey(mintUuid());
      }
      showServerErrors(err, input.lines);
    } finally {
      setSaving(false);
    }
  };

  const fieldError = (key: string) => (errors[key] ? codeText(errors[key]) : undefined);

  return (
    <Modal.Root open onOpenChange={(next: boolean) => !next && !saving && onClose()}>
      <Modal.Content style={{ maxWidth: 960, width: '100%' }}>
        <Modal.Header>
          <Modal.Title>{t('ecommerce.orders.ship.title', { reference: order.reference })}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Flex direction="column" alignItems="stretch" gap={5}>
            {form.lines.length === 0 ? (
              <Typography textColor="neutral600">{t('ecommerce.orders.ship.nothing')}</Typography>
            ) : (
              <Table colCount={COLUMNS.length + 1} rowCount={form.lines.length + 1}>
                <Thead>
                  <Tr>
                    <Th>
                      <VisuallyHidden>{t('ecommerce.orders.detail.lines.photo')}</VisuallyHidden>
                    </Th>
                    {COLUMNS.map((c) => (
                      <Th key={c}>
                        <Typography variant="sigma">{t(`ecommerce.orders.ship.columns.${c}`)}</Typography>
                      </Th>
                    ))}
                  </Tr>
                </Thead>
                <Tbody>
                  {form.lines.map((draft) => {
                    const line = lineById.get(draft.orderLineId);
                    if (!line) return null;
                    const error = fieldError(`lines.${line.id}`);
                    return (
                      <Tr key={line.id}>
                        <Td>
                          {line.imageUrl ? (
                            <img
                              src={line.imageUrl}
                              alt=""
                              width={THUMBNAIL_SIZE}
                              height={THUMBNAIL_SIZE}
                              style={{ objectFit: 'cover', borderRadius: '4px', display: 'block' }}
                            />
                          ) : (
                            <Box background="neutral150" hasRadius style={{ width: THUMBNAIL_SIZE, height: THUMBNAIL_SIZE }} />
                          )}
                        </Td>
                        <Td style={{ maxWidth: 240 }}>
                          <Flex direction="column" alignItems="flex-start">
                            <Typography textColor="neutral800" ellipsis>
                              {line.name}
                            </Typography>
                            {line.option && (
                              <Typography variant="pi" textColor="neutral600" ellipsis>
                                {line.option}
                              </Typography>
                            )}
                          </Flex>
                        </Td>
                        <Td>
                          <Typography textColor="neutral800">{line.sku}</Typography>
                        </Td>
                        <Td>
                          <Typography textColor="neutral800">{line.quantity}</Typography>
                        </Td>
                        <Td>
                          <Typography textColor="neutral800">{line.shipped}</Typography>
                        </Td>
                        <Td>
                          <Typography textColor="neutral800">{line.pending}</Typography>
                        </Td>
                        <Td style={{ width: 120 }}>
                          <Field.Root name={`quantity-${line.id}`} error={error}>
                            <VisuallyHidden>
                              <Field.Label>{t('ecommerce.orders.ship.columns.quantity')}</Field.Label>
                            </VisuallyHidden>
                            <TextInput
                              value={draft.quantity}
                              inputMode="numeric"
                              disabled={saving}
                              onChange={(e: any) => setQuantity(line.id, e.target.value)}
                            />
                            <Field.Error />
                          </Field.Root>
                        </Td>
                      </Tr>
                    );
                  })}
                </Tbody>
              </Table>
            )}
            {errors.lines && <Typography textColor="danger600">{codeText(errors.lines)}</Typography>}

            <Field.Root name="mode">
              <Field.Label>{t('ecommerce.orders.ship.method')}</Field.Label>
              <Radio.Group
                value={form.mode}
                aria-label={t('ecommerce.orders.ship.method')}
                onValueChange={(value: string) => update({ mode: value as ShipMode }, ['carrierName', 'trackingCode', 'trackingUrl'])}
              >
                <Radio.Item value="MANUAL" disabled={saving}>
                  {t('ecommerce.orders.ship.modes.MANUAL')}
                </Radio.Item>
                {carrierAvailable && (
                  <Radio.Item value="CARRIER" disabled={saving}>
                    {t('ecommerce.orders.ship.modes.CARRIER', {
                      carrier: String(order.shippingMethod?.name ?? order.shippingMethod?.providerId ?? ''),
                    })}
                  </Radio.Item>
                )}
              </Radio.Group>
            </Field.Root>

            {form.mode === 'MANUAL' ? (
              <>
                <Field.Root name="carrierName" required error={fieldError('carrierName')}>
                  <Field.Label>{t('ecommerce.orders.ship.carrierName')}</Field.Label>
                  <TextInput
                    value={form.carrierName}
                    disabled={saving}
                    onChange={(e: any) => update({ carrierName: e.target.value }, ['carrierName'])}
                  />
                  <Field.Error />
                </Field.Root>
                <Flex gap={4} alignItems="flex-start" wrap="wrap">
                  <Box flex="1" minWidth="200px">
                    <Field.Root name="trackingCode" error={fieldError('trackingCode')}>
                      <Field.Label>{t('ecommerce.orders.shipments.trackingCode')}</Field.Label>
                      <TextInput
                        value={form.trackingCode}
                        disabled={saving}
                        onChange={(e: any) => update({ trackingCode: e.target.value }, ['trackingCode'])}
                      />
                      <Field.Error />
                    </Field.Root>
                  </Box>
                  <Box flex="2" minWidth="240px">
                    <Field.Root name="trackingUrl" error={fieldError('trackingUrl')} hint={t('ecommerce.orders.shipments.trackingUrlHint')}>
                      <Field.Label>{t('ecommerce.orders.shipments.trackingUrl')}</Field.Label>
                      <TextInput
                        value={form.trackingUrl}
                        type="url"
                        placeholder="https://"
                        disabled={saving}
                        onChange={(e: any) => update({ trackingUrl: e.target.value }, ['trackingUrl'])}
                      />
                      <Field.Hint />
                      <Field.Error />
                    </Field.Root>
                  </Box>
                </Flex>
              </>
            ) : (
              <Box padding={3} background="neutral100" hasRadius>
                <Typography variant="omega" textColor="neutral700">
                  {t('ecommerce.orders.ship.carrierHint')}
                </Typography>
              </Box>
            )}

            <Field.Root name="shippingCost" error={fieldError('shippingCost')} hint={t('ecommerce.orders.ship.costHint')}>
              <Field.Label>{t('ecommerce.orders.ship.cost')}</Field.Label>
              <TextInput
                value={form.shippingCost}
                inputMode="decimal"
                endAction={<span>€</span>}
                disabled={saving}
                onChange={(e: any) => update({ shippingCost: e.target.value }, ['shippingCost'])}
              />
              <Field.Hint />
              <Field.Error />
            </Field.Root>

            <Checkbox
              checked={form.notifyCustomer}
              disabled={saving}
              onCheckedChange={(checked: boolean | 'indeterminate') => update({ notifyCustomer: checked === true }, [])}
            >
              {t('ecommerce.orders.shipments.notifyCustomer')}
            </Checkbox>

            {formError && (
              <Box padding={3} background="danger100" hasRadius>
                <Typography textColor="danger700">{formError}</Typography>
              </Box>
            )}
          </Flex>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="tertiary" onClick={onClose} disabled={saving}>
            {t('ecommerce.orders.ship.cancel')}
          </Button>
          <Button onClick={submit} loading={saving} disabled={!form.lines.length}>
            {t('ecommerce.orders.ship.submit')}
          </Button>
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
};

export default ShipOrderModal;
