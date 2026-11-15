import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import { useNotification } from '@strapi/strapi/admin';
import { Box, Button, Flex, Loader, Modal, Typography } from '@strapi/design-system';
import { Pin } from '@strapi/icons';
import { getTranslation } from '../../../core/utils/getTranslation';
import FetchShippingAddressCountries from '../../usecases/orders/fetchShippingAddressCountries';
import UpdateShippingAddress from '../../usecases/orders/updateShippingAddress';
import FetchShipMethods from '../../usecases/orders/fetchShipMethods';
import { addressFormFromAddress, toAddress, type AddressForm } from '../../utils/orderForm';
import {
  addressLockReason,
  allowedCountryCodes,
  canEdit,
  currentShippingMethod,
  shippingAddressErrors,
} from '../../utils/orderEditing';
import { isStorePickupMethod, pickupErrorId, pickupSelectionInput } from '../../utils/pickupPoints';
import { apiErrorMessageId } from '../../utils/orderDetail';
import { extractFieldErrors } from '../../utils/productForm';
import { mintUuid } from '../../utils/variantDraft';
import type { EditResult, FieldError, Order, PickupSelection, PickupStore } from '../../orderTypes';
import AddressFields, { type AddressField } from './AddressFields';
import PickupPointPicker from './PickupPointPicker';
import { NOTICE_BACKGROUND, NOTICE_TEXT } from './NoticeBar';

type Props = {
  order: Order;
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
 * The order's shipping address (spec 5). While it can change, a form whose countries are the ones
 * the current method serves; otherwise the same fields locked, with the reason. A DPD Pickup order
 * (spec 5.3) shows the point's address read-only; it changes only by choosing another point. A Store
 * pickup order chooses among its market's stores (those the Ship modal offers).
 * Mounted per opening: each opening mints one operationId, so a retried save is applied once.
 */
const ShippingAddressDialog = ({ order, canManage, onSaved, onClose }: Props & { onClose: () => void }) => {
  const { formatMessage, locale } = useIntl();
  const { toggleNotification } = useNotification();
  const t = (id: string, values?: Record<string, any>) => formatMessage({ id: getTranslation(id) }, values);
  const codeText = (code: string) =>
    formatMessage({
      id: getTranslation(`ecommerce.orders.errors.${code}`),
      defaultMessage: t('ecommerce.orders.errors.invalid'),
    });
  const pickupErrorText = (code: string) =>
    formatMessage({
      id: getTranslation(pickupErrorId(code, storeOrder)),
      defaultMessage: t('ecommerce.orders.errors.invalid'),
    });

  const editable = canManage && canEdit(order, 'EDIT_ADDRESS');
  const lockReason = editable ? null : (addressLockReason(order.editing) ?? 'default');
  const pickupPoint = order.pickupPoint ?? null;
  // The typed address form: never for a Pickup order.
  const editableForm = editable && !pickupPoint;
  const [changingPoint, setChangingPoint] = useState(false);
  const [newPoint, setNewPoint] = useState<PickupSelection | null>(null);
  // Store pickup: the point is a store, chosen among the stores of the Ship modal's method.
  const storeOrder = !!pickupPoint && isStorePickupMethod(currentShippingMethod(order.shippingLines));
  const [stores, setStores] = useState<PickupStore[] | null>(null);
  const [storesFailed, setStoresFailed] = useState(false);

  useEffect(() => {
    if (!storeOrder || !changingPoint || stores) return;
    let cancelled = false;
    new FetchShipMethods()
      .execute(order.id, locale)
      .then((methods) => {
        if (!cancelled) setStores(methods.find((m) => m.kind === 'STORE_PICKUP')?.stores ?? []);
      })
      .catch(() => {
        if (!cancelled) setStoresFailed(true);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeOrder, changingPoint]);

  const [operationId] = useState(() => mintUuid());
  const [initial] = useState(() => addressFormFromAddress(order.shippingAddress));
  const [form, setForm] = useState<AddressForm>(initial);
  // Undefined: every country (locked view, or the served list could not be loaded).
  const [countries, setCountries] = useState<string[] | undefined>(undefined);
  const [loading, setLoading] = useState(editableForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!editableForm) return;
    let cancelled = false;
    new FetchShippingAddressCountries()
      .execute(order.id)
      .then((r) => {
        if (!cancelled) setCountries(allowedCountryCodes(r.countries, initial.country));
      })
      .catch((err) => {
        // The server still checks the country on save.
        if (!cancelled) {
          toggleNotification({
            type: 'warning',
            message: t(apiErrorMessageId(err, 'ecommerce.orders.address.countriesError')),
          });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // Loaded once per opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const change = (field: AddressField, value: string) => {
    setForm((f) => ({ ...f, [field]: value }));
    setErrors({});
  };

  const changed = pickupPoint
    ? !!newPoint && newPoint.point.id !== pickupPoint.id
    : JSON.stringify(form) !== JSON.stringify(initial);

  const save = async () => {
    if (busy) return;
    if (!pickupPoint) {
      const local = shippingAddressErrors(form);
      if (local.length) {
        setErrors(errorMap(local));
        return;
      }
    } else if (!newPoint) {
      return;
    }
    setBusy(true);
    try {
      // Shipping addresses never show company / NIF: what the order had is sent back unchanged.
      const result = await new UpdateShippingAddress().execute(
        order.id,
        newPoint
          ? { ...pickupSelectionInput(newPoint), pickupPointId: newPoint.point.id, operationId }
          : { address: toAddress(form, true), operationId }
      );
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
          <Modal.Title>{t('ecommerce.orders.detail.address.shipping')}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {loading ? (
            <Flex justifyContent="center" padding={4}>
              <Loader small />
            </Flex>
          ) : (
            <Flex direction="column" alignItems="stretch" gap={4}>
              {lockReason && (
                <Box padding={3} hasRadius style={{ background: NOTICE_BACKGROUND }}>
                  <Typography variant="omega" style={{ color: NOTICE_TEXT }}>
                    {t(`ecommerce.orders.address.locked.${lockReason}`)}
                  </Typography>
                </Box>
              )}
              {pickupPoint && (
                <Box padding={3} background="neutral100" hasRadius>
                  <Flex direction="column" alignItems="flex-start" gap={1}>
                    <Typography variant="omega" fontWeight="semiBold">
                      {t(storeOrder ? 'ecommerce.orders.pickup.store.current' : 'ecommerce.orders.pickup.current', {
                        name: pickupPoint.name,
                        id: pickupPoint.id,
                      })}
                    </Typography>
                    <Typography variant="pi" textColor="neutral600">
                      {storeOrder ? t('ecommerce.orders.pickup.store.locked') : codeText('PICKUP_ADDRESS_LOCKED')}
                    </Typography>
                  </Flex>
                </Box>
              )}
              <AddressFields
                name="shippingAddress"
                value={form}
                onChange={change}
                errorFor={(field) => (errors[field] ? codeText(errors[field]) : undefined)}
                disabled={!editableForm || busy}
                countries={editableForm ? countries : undefined}
              />
              {pickupPoint && editable && !changingPoint && (
                <Box>
                  <Button variant="secondary" startIcon={<Pin />} onClick={() => setChangingPoint(true)} disabled={busy}>
                    {t(storeOrder ? 'ecommerce.orders.pickup.store.change' : 'ecommerce.orders.pickup.change')}
                  </Button>
                </Box>
              )}
              {storeOrder && editable && changingPoint && storesFailed && (
                <Typography variant="omega" textColor="danger600">
                  {t('ecommerce.orders.pickup.store.loadError')}
                </Typography>
              )}
              {storeOrder && editable && changingPoint && !stores && !storesFailed && (
                <Flex justifyContent="center" padding={2}>
                  <Loader small />
                </Flex>
              )}
              {pickupPoint && editable && changingPoint && (!storeOrder || stores) && (
                <PickupPointPicker
                  stores={storeOrder ? stores : null}
                  initialPostalCode={pickupPoint.customerAddress?.postalCode ?? pickupPoint.postalCode}
                  value={newPoint}
                  onChange={(next) => {
                    setNewPoint(next);
                    setErrors({});
                  }}
                  disabled={busy}
                  error={errors.form ? pickupErrorText(errors.form) : undefined}
                />
              )}
              {errors.form && !(pickupPoint && changingPoint) && (
                <Typography variant="omega" textColor="danger600">
                  {codeText(errors.form)}
                </Typography>
              )}
            </Flex>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="tertiary" onClick={onClose} disabled={busy}>
            {t('ecommerce.orders.notifications.close')}
          </Button>
          {editable && (
            <Button onClick={save} loading={busy} disabled={loading || !changed}>
              {t('ecommerce.orders.address.save')}
            </Button>
          )}
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
};

/** The Shipping address button of the Shipments header and its modal. */
const ShippingAddressModal = (props: Props) => {
  const { formatMessage } = useIntl();
  // Remounts the dialog per opening (one operationId each).
  const [openKey, setOpenKey] = useState<number | null>(null);

  return (
    <>
      <Button size="S" variant="tertiary" startIcon={<Pin />} onClick={() => setOpenKey((k) => (k ?? 0) + 1)}>
        {formatMessage({ id: getTranslation('ecommerce.orders.detail.address.shipping') })}
      </Button>
      {openKey !== null && (
        <ShippingAddressDialog key={openKey} {...props} onClose={() => setOpenKey(null)} />
      )}
    </>
  );
};

export default ShippingAddressModal;
