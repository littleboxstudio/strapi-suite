import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import { useNotification } from '@strapi/strapi/admin';
import {
  Badge,
  Box,
  Button,
  Field,
  Flex,
  Loader,
  Modal,
  Table,
  Tbody,
  Td,
  TextInput,
  Th,
  Tooltip,
  Thead,
  Tr,
  Typography,
  VisuallyHidden,
} from '@strapi/design-system';
import { getTranslation } from '../../../core/utils/getTranslation';
import { InputTd } from '../InputTd';
import { MethodItem, MethodList, MethodListRest, MethodsPanel } from './MethodsPanel';
import { NOTICE_BACKGROUND, NOTICE_TEXT } from './NoticeBar';
import { ActionConfirmModal } from '../ActionConfirmModal';
import CreateShipment from '../../usecases/orders/createShipment';
import FetchShipMethods from '../../usecases/orders/fetchShipMethods';
import { apiErrorCode, apiErrorMessageId, shouldRenewIdempotencyKey } from '../../utils/orderDetail';
import StoreSelect from './StoreSelect';
import { extractFieldErrors } from '../../utils/productForm';
import { mintUuid } from '../../utils/variantDraft';
import {
  MAX_PARCELS,
  buildShipmentInput,
  defaultShipMethodKey,
  defaultShipStoreId,
  emptyShipForm,
  mapServerFieldErrors,
  selectedShipMethod,
  shipMethodKey,
  shipResultMessageId,
  shipStore,
  shipStoreErrorId,
  shippableOf,
  validateShipForm,
  type FormErrors,
  type ShipForm,
} from '../../utils/shipmentForm';
import type { Order, ShipMethodOption } from '../../orderTypes';

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
  'method.providerId': 'method',
  'method.serviceId': 'method',
  'method.carrierName': 'method',
  'method.trackingCode': 'trackingCode',
  'method.trackingUrl': 'trackingUrl',
  parcels: 'parcels',
  lines: 'lines',
};

/** Store pickup: the store's errors (PICKUP_POINT_INVALID / PICKUP_POINT_REQUIRED) under its select. */
const STORE_PATHS: Record<string, string> = {
  ...METHOD_PATHS,
  'method.pickupPointId': 'store',
  'method.mode': 'store',
};

/** Long product names and options wrap inside their column. */
const WRAP = { whiteSpace: 'normal', wordBreak: 'break-word', overflowWrap: 'anywhere' } as const;

/**
 * Ships units of the order (requirements 10.4 and 12.6) with one of the platform's delivery
 * methods, the order's own preselected: a manual one takes the tracking typed here, a carrier one
 * is created at the carrier (tracking and label), Store pickup makes it ready at a store (no tracking
 * nor parcels). The customer is always notified.
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
  const [form, setForm] = useState<ShipForm>(() => emptyShipForm(order));
  const [errors, setErrors] = useState<FormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  /** The Ship button asks first; the shipment is created on confirmation. */
  const [confirming, setConfirming] = useState(false);
  const [methods, setMethods] = useState<ShipMethodOption[] | null>(null);
  const [methodsError, setMethodsError] = useState(false);
  const lineById = new Map(order.lines.map((l) => [l.id, l]));
  const method = selectedShipMethod(form, methods ?? []);
  const store = shipStore(method, form.storeId);

  useEffect(() => {
    let cancelled = false;
    new FetchShipMethods()
      .execute(order.id, uiLocale)
      .then((list) => {
        if (cancelled) return;
        setMethods(list);
        setForm((f) => ({ ...f, methodKey: defaultShipMethodKey(list), storeId: defaultShipStoreId(list) }));
      })
      .catch(() => {
        if (!cancelled) setMethodsError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [order.id, uiLocale]);

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
  const showServerErrors = (err: unknown, sentLines: { orderLineId: number }[], storePickup: boolean) => {
    const { errors: map, other } = mapServerFieldErrors(
      extractFieldErrors(err) ?? [],
      sentLines,
      storePickup ? STORE_PATHS : METHOD_PATHS
    );
    setErrors(map);
    if (!Object.keys(map).length) {
      setFormError(t(apiErrorMessageId(err, 'ecommerce.orders.ship.error')));
    } else if (other) {
      setFormError(codeText(other));
    }
  };

  /** Validates locally, then asks for confirmation. */
  const askShip = () => {
    if (saving || !methods) return;
    const local = validateShipForm(form, order.lines, method);
    if (!method || Object.keys(local).length) {
      setErrors(local);
      return;
    }
    setConfirming(true);
  };

  const originalMethod = methods?.find((m) => m.original) ?? null;
  /** The chosen method is not the one the order was placed with. */
  const otherMethod = !!method && !!originalMethod && shipMethodKey(method) !== shipMethodKey(originalMethod);

  const submit = async () => {
    setConfirming(false);
    if (saving || !methods || !method) return;
    const input = buildShipmentInput(form, idempotencyKey, method);
    setSaving(true);
    try {
      const shipment = await new CreateShipment().execute(order.id, input);
      if (shipment.status === 'FAILED') {
        // A replay of an attempt that failed at the carrier: say why, the next try is new.
        setIdempotencyKey(mintUuid());
        setFormError(shipment.error ? codeText(shipment.error) : t('ecommerce.orders.ship.error'));
        return;
      }
      const pending = shipment.status === 'PENDING';
      toggleNotification({
        type: pending ? 'warning' : 'success',
        message: t(shipResultMessageId(shipment)),
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
      showServerErrors(err, input.lines, input.method.mode === 'STORE_PICKUP');
    } finally {
      setSaving(false);
    }
  };

  const fieldError = (key: string) => (errors[key] ? codeText(errors[key]) : undefined);
  const storeErrorText = (code: string) =>
    formatMessage({
      id: getTranslation(shipStoreErrorId(code)),
      defaultMessage: t('ecommerce.orders.errors.invalid'),
    });

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
                        <Td style={{ maxWidth: 240, ...WRAP }}>
                          <Flex direction="column" alignItems="flex-start">
                            <Typography textColor="neutral800" style={WRAP}>
                              {line.name}
                            </Typography>
                            {line.option && (
                              <Typography variant="pi" textColor="neutral600" style={WRAP}>
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
                          <Flex direction="column" alignItems="flex-start">
                            <Typography textColor="neutral800">{line.pending}</Typography>
                            {/* Units that wait for payment while the order owes money. */}
                            {line.pending > shippableOf(line) && (
                              <Typography variant="pi" textColor="danger600">
                                {t('ecommerce.orders.ship.unpaidUnits', { count: line.pending - shippableOf(line) })}
                              </Typography>
                            )}
                          </Flex>
                        </Td>
                        <InputTd style={{ width: 120 }}>
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
                        </InputTd>
                      </Tr>
                    );
                  })}
                </Tbody>
              </Table>
            )}
            {errors.lines && <Typography textColor="danger600">{codeText(errors.lines)}</Typography>}

            {methodsError ? (
              <Box padding={3} background="danger100" hasRadius>
                <Typography textColor="danger700">{t('ecommerce.orders.ship.methodsError')}</Typography>
              </Box>
            ) : !methods ? (
              <Flex justifyContent="center" padding={2}>
                <Loader small>{t('ecommerce.orders.ship.method')}</Loader>
              </Flex>
            ) : !methods.length ? (
              <Typography textColor="neutral600">{t('ecommerce.orders.ship.noMethods')}</Typography>
            ) : (
              <MethodsPanel>
                <MethodList role="listbox" aria-label={t('ecommerce.orders.ship.method')}>
                  {methods.map((m) => {
                    const key = shipMethodKey(m);
                    const selected = key === form.methodKey;
                    return (
                      <MethodItem
                        key={key}
                        type="button"
                        role="option"
                        aria-selected={selected}
                        $selected={selected}
                        disabled={saving}
                        onClick={() =>
                          !selected &&
                          update({ methodKey: key }, ['method', 'trackingCode', 'trackingUrl', 'parcels', 'store'])
                        }
                      >
                        <Flex gap={2} wrap="wrap" alignItems="center">
                          <span>{m.name}</span>
                          {m.original && (
                            <Tooltip label={t('ecommerce.orders.ship.originalMethodHint')}>
                              <span style={{ display: 'inline-flex' }}>
                                <Badge>{t('ecommerce.orders.ship.originalMethod')}</Badge>
                              </span>
                            </Tooltip>
                          )}
                        </Flex>
                      </MethodItem>
                    );
                  })}
                  <MethodListRest />
                </MethodList>
                <Box flex="1" padding={5} minWidth={0}>
                  {method && (
                    <Flex direction="column" alignItems="stretch" gap={4}>
                      {errors.method && <Typography textColor="danger600">{codeText(errors.method)}</Typography>}

                      {method.kind === 'MANUAL' && (
                        <Flex direction="column" alignItems="stretch" gap={4}>
                          <Box>
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
                          <Box>
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
                      )}

                      {method.kind === 'CARRIER' && (
                        <>
                          <Box padding={3} hasRadius style={{ background: NOTICE_BACKGROUND }}>
                            <Typography variant="omega" style={{ color: NOTICE_TEXT }}>
                              {t('ecommerce.orders.ship.carrierHint')}
                            </Typography>
                          </Box>
                          {method.parcels && (
                            <Box>
                              <Field.Root name="parcels" required error={fieldError('parcels')} hint={t('ecommerce.orders.ship.parcelsHint', { max: MAX_PARCELS })}>
                                <Field.Label>{t('ecommerce.orders.ship.parcels')}</Field.Label>
                                <TextInput
                                  value={form.parcels}
                                  inputMode="numeric"
                                  disabled={saving}
                                  onChange={(e: any) => update({ parcels: e.target.value }, ['parcels'])}
                                />
                                <Field.Hint />
                                <Field.Error />
                              </Field.Root>
                            </Box>
                          )}
                        </>
                      )}

                      {method.kind === 'STORE_PICKUP' && (
                        <Flex direction="column" alignItems="stretch" gap={4}>
                          <StoreSelect
                            stores={method.stores ?? []}
                            value={form.storeId || null}
                            disabled={saving}
                            error={errors.store ? storeErrorText(errors.store) : undefined}
                            onChange={(s) => update({ storeId: s.id }, ['store'])}
                          />
                          {store && (
                            <Box padding={3} hasRadius style={{ background: NOTICE_BACKGROUND }}>
                              <Typography variant="omega" style={{ color: NOTICE_TEXT }}>
                                {t('ecommerce.orders.ship.storeHint', { store: store.name })}
                              </Typography>
                            </Box>
                          )}
                        </Flex>
                      )}
                    </Flex>
                  )}
                </Box>
              </MethodsPanel>
            )}

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
          <Button onClick={askShip} loading={saving} disabled={!form.lines.length || !method}>
            {t('ecommerce.orders.ship.submit')}
          </Button>
        </Modal.Footer>
      </Modal.Content>
      <ActionConfirmModal
        open={confirming}
        title={t('ecommerce.orders.ship.confirm.title')}
        text={
          <Flex direction="column" gap={3}>
            <Typography>
              {store
                ? t('ecommerce.orders.ship.confirm.storeText', { store: store.name })
                : t('ecommerce.orders.ship.confirm.text', { method: method?.name ?? '' })}
            </Typography>
            {otherMethod && originalMethod && (
              <Typography textColor="warning600">
                {t('ecommerce.orders.ship.confirm.otherMethod', { original: originalMethod.name })}
              </Typography>
            )}
          </Flex>
        }
        confirmLabel={t('ecommerce.orders.ship.submit')}
        cancelLabel={t('ecommerce.orders.ship.cancel')}
        confirmVariant="default"
        onConfirm={submit}
        onCancel={() => setConfirming(false)}
      />
    </Modal.Root>
  );
};

export default ShipOrderModal;
