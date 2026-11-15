import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import { useNotification } from '@strapi/strapi/admin';
import { Box, Button, Field, Flex, Loader, Modal, TextInput, Typography } from '@strapi/design-system';
import { getTranslation } from '../../../core/utils/getTranslation';
import FetchShippingOptions from '../../usecases/orders/fetchShippingOptions';
import EditShippingLine from '../../usecases/orders/editShippingLine';
import AddShippingLine from '../../usecases/orders/addShippingLine';
import { formatAmountInput, formatCents } from '../../utils/money';
import {
  currentShippingMethod,
  defaultShippingOptionKey,
  shippingLineDraftToInput,
  shippingLineEditUnchanged,
  shippingLineErrorKey,
  shippingOptionKey,
  suggestedChargePrice,
} from '../../utils/orderEditing';
import { apiErrorMessageId, type OrderActionPermissions, type ToolbarAction } from '../../utils/orderDetail';
import { extractFieldErrors } from '../../utils/productForm';
import { mintUuid } from '../../utils/variantDraft';
import {
  newPickupSelection,
  orderPointKept,
  pickupErrorId,
  pickupNeeded,
  pickupSelectionInput,
  storeChoices,
} from '../../utils/pickupPoints';
import type {
  EditResult,
  FieldError,
  Order,
  PickupSelection,
  ShippingLineView,
  ShippingOption,
  ShippingQuote,
} from '../../orderTypes';
import BalanceOutcome from './BalanceOutcome';
import EmptyNote from './EmptyNote';
import NoticeBar, { NOTICE_BACKGROUND, NOTICE_TEXT } from './NoticeBar';
import { MethodItem, MethodList, MethodListRest, MethodsPanel } from './MethodsPanel';
import PickupPointPicker from './PickupPointPicker';

type Props = {
  order: Order;
  /** EDIT changes `line` (spec 6.2); ADD always creates a new line. */
  mode: 'EDIT' | 'ADD';
  line?: ShippingLineView;
  permissions: OrderActionPermissions;
  onClose: () => void;
  onSaved: (result: EditResult) => void;
  onAction: (action: ToolbarAction) => void;
};

type ErrorKey = ReturnType<typeof shippingLineErrorKey>;

const errorMap = (errors: FieldError[]): Partial<Record<ErrorKey, string>> => {
  const map: Partial<Record<ErrorKey, string>> = {};
  errors.forEach(({ path, code }) => {
    const key = shippingLineErrorKey(path);
    if (!(key in map)) map[key] = code;
  });
  return map;
};

/**
 * Edit or add a shipping charge: the methods that serve the address and weight, each with its
 * suggested price, and an editable price; then the balance when money is due or refundable.
 * DPD Pickup (spec 5.3) asks for a pickup point, Store pickup for one of its stores (kept when the
 * order already has one of that kind); leaving it gives the customer's address back. Mount it only while open: each opening mints one operationId.
 */
const ShippingLineModal = ({ order, mode, line, permissions, onClose, onSaved, onAction }: Props) => {
  const { formatMessage, locale } = useIntl();
  const { toggleNotification } = useNotification();
  const t = (id: string, values?: Record<string, any>) => formatMessage({ id: getTranslation(id) }, values);
  const codeText = (code: string) =>
    formatMessage({
      id: getTranslation(`ecommerce.orders.errors.${code}`),
      defaultMessage: t('ecommerce.orders.errors.invalid'),
    });
  const money = (cents: number) => formatCents(cents, locale);

  const [operationId] = useState(() => mintUuid());
  const [options, setOptions] = useState<ShippingOption[] | null>(null);
  const [failures, setFailures] = useState<ShippingQuote['failures']>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [price, setPrice] = useState('');
  const [errors, setErrors] = useState<Partial<Record<ErrorKey, string>>>({});
  const [saved, setSaved] = useState<EditResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [point, setPoint] = useState<PickupSelection | null>(null);
  /** What a new charge is suggested against (units not yet shipped, shipping charged so far). */
  const [suggestionBase, setSuggestionBase] = useState<{ pendingOnly?: boolean; charged?: number }>({});

  /**
   * The suggested price of an option: Add, its quote of the units not yet shipped minus the
   * shipping already charged (null below 0: no suggestion, the price starts at 0); Edit, its quote.
   */
  const suggestionOf = (o: ShippingOption, base = suggestionBase): number | null =>
    mode === 'ADD' ? suggestedChargePrice(o.price, base) : o.price;

  useEffect(() => {
    let cancelled = false;
    new FetchShippingOptions()
      .execute(order.id)
      .then(({ options: offered, failures: failed, pendingOnly, charged }) => {
        if (cancelled) return;
        const base = { pendingOnly, charged };
        setSuggestionBase(base);
        const preferred = line
          ? { providerId: line.providerId, serviceId: line.serviceId }
          : currentShippingMethod(order.shippingLines);
        const key = defaultShippingOptionKey(offered, preferred, failed);
        setOptions(offered);
        setFailures(failed);
        setSelected(key);
        const option = offered.find((o) => shippingOptionKey(o) === key);
        if (option) setPrice(formatAmountInput(suggestionOf(option, base) ?? 0, locale));
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadFailed(true);
        toggleNotification({
          type: 'danger',
          message: t(apiErrorMessageId(err, 'ecommerce.orders.shippingCharges.optionsError')),
        });
      });
    return () => {
      cancelled = true;
    };
    // Loaded once per opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const option = options?.find((o) => shippingOptionKey(o) === selected) ?? null;
  const draft = shippingLineDraftToInput(option, price);
  // The point the next shipment goes to (the order's own until it has shipments).
  const orderPoint = order.nextPickupPoint ?? null;
  // The order's point counts only for the same kind of method (a DPD point is no store).
  const pickup = pickupNeeded(
    option,
    orderPointKept(currentShippingMethod(order.shippingLines), !!orderPoint, option)
  );
  const stores = storeChoices(option);
  const shipped = !!order.editing?.hasShipments;
  const pickupErrorText = (code: string) =>
    formatMessage({
      id: getTranslation(pickupErrorId(code, !!stores)),
      defaultMessage: t('ecommerce.orders.errors.invalid'),
    });
  const newPoint = pickup !== 'NONE' ? newPickupSelection(point, orderPoint?.id) : null;
  // Edit: nothing to save while the line would keep charging the same method and amount.
  const unchanged =
    mode === 'EDIT' &&
    !!line &&
    !!draft.input &&
    !newPoint &&
    shippingLineEditUnchanged(order.shippingLines, line, draft.input);

  const choose = (key: string) => {
    const next = options?.find((o) => shippingOptionKey(o) === key);
    setSelected(key);
    // A point chosen for another method does not carry over.
    if (key !== selected) setPoint(null);
    // A new method starts from its suggested price.
    if (next) setPrice(formatAmountInput(suggestionOf(next) ?? 0, locale));
    setErrors({});
  };

  const save = async () => {
    if (busy || unchanged) return;
    if (!draft.input) {
      setErrors(errorMap(draft.errors));
      return;
    }
    if (pickup === 'REQUIRED' && !point) {
      setErrors({ form: 'PICKUP_POINT_REQUIRED' });
      return;
    }
    setBusy(true);
    try {
      const body = { ...draft.input, ...pickupSelectionInput(newPoint), operationId };
      const result =
        mode === 'EDIT' && line
          ? await new EditShippingLine().execute(order.id, line.id, body)
          : await new AddShippingLine().execute(order.id, body);
      onSaved(result);
      if (result.outcome === 'NONE') {
        toggleNotification({ type: 'success', message: t('ecommerce.orders.shippingCharges.saved') });
        onClose();
      } else {
        setSaved(result);
      }
    } catch (err) {
      const fieldErrors = extractFieldErrors(err);
      if (fieldErrors?.length) {
        setErrors(errorMap(fieldErrors));
      } else {
        toggleNotification({
          type: 'danger',
          message: t(apiErrorMessageId(err, 'ecommerce.orders.shippingCharges.saveError')),
        });
      }
    } finally {
      setBusy(false);
    }
  };

  const title = t(mode === 'EDIT' ? 'ecommerce.orders.shippingCharges.editTitle' : 'ecommerce.orders.shippingCharges.add');

  const body = () => {
    if (saved) {
      return (
        <BalanceOutcome
          order={saved.order}
          outcome={saved.outcome as 'DUE' | 'REFUNDABLE'}
          permissions={permissions}
          onAction={onAction}
        />
      );
    }
    if (loadFailed) {
      return (
        <Typography variant="omega" textColor="danger600">
          {t('ecommerce.orders.shippingCharges.optionsError')}
        </Typography>
      );
    }
    if (!options) {
      return (
        <Flex justifyContent="center" padding={4}>
          <Loader small />
        </Flex>
      );
    }
    const failureNote = failures.length > 0 && (
      <NoticeBar
        text={t('ecommerce.orders.shipping.failures', {
          providers: failures.map((f) => f.providerId).join(', '),
        })}
      />
    );
    if (!options.length) {
      return failureNote || <EmptyNote>{t('ecommerce.orders.shippingCharges.noMethods')}</EmptyNote>;
    }
    return (
      <Flex direction="column" alignItems="stretch" gap={4}>
        {failureNote}
        {shipped && option && (
          // Once shipped the order's address stays: a point only goes to the next shipments.
          <Box padding={3} hasRadius style={{ background: NOTICE_BACKGROUND }}>
            <Typography variant="omega" style={{ color: NOTICE_TEXT }}>
              {t(pickup === 'NONE' ? 'ecommerce.orders.pickup.shippedAddress' : 'ecommerce.orders.pickup.shippedPoint')}
            </Typography>
          </Box>
        )}
        {!shipped && pickup === 'NONE' && orderPoint && option && (
          <NoticeBar text={t('ecommerce.orders.pickup.restore')} />
        )}
        <MethodsPanel>
          <MethodList role="listbox" aria-label={t('ecommerce.orders.shippingCharges.method')}>
            {options.map((o) => {
              const key = shippingOptionKey(o);
              const isSelected = key === selected;
              return (
                <MethodItem
                  key={key}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  $selected={isSelected}
                  disabled={busy}
                  onClick={() => !isSelected && choose(key)}
                >
                  {o.name}
                </MethodItem>
              );
            })}
            <MethodListRest />
          </MethodList>
          <Box flex="1" padding={5} minWidth={0}>
            {option && (
              <Flex direction="column" alignItems="stretch" gap={4}>
                {errors.method && (
                  <Typography variant="omega" textColor="danger600">
                    {codeText(errors.method)}
                  </Typography>
                )}
                <Field.Root
                  name="amount"
                  error={errors.amount ? codeText(errors.amount) : undefined}
                  hint={
                    suggestionOf(option) !== null
                      ? t('ecommerce.orders.shippingCharges.suggested', { amount: money(suggestionOf(option)!) })
                      : undefined
                  }
                >
                  <Field.Label>{t('ecommerce.orders.shippingCharges.price')}</Field.Label>
                  <TextInput
                    value={price}
                    disabled={busy}
                    inputMode="decimal"
                    onChange={(e: any) => {
                      setPrice(e.target.value);
                      setErrors({});
                    }}
                  />
                  <Field.Hint />
                  <Field.Error />
                </Field.Root>
                {pickup !== 'NONE' && (
                  <Flex direction="column" alignItems="stretch" gap={2}>
                    <Typography variant="sigma" textColor="neutral600">
                      {t(stores ? 'ecommerce.orders.pickup.store.title' : 'ecommerce.orders.pickup.title')}
                    </Typography>
                    <Typography variant="pi" textColor="neutral600">
                      {pickup === 'OPTIONAL' && orderPoint
                        ? t(stores ? 'ecommerce.orders.pickup.store.keep' : 'ecommerce.orders.pickup.keep', {
                            name: orderPoint.name,
                            id: orderPoint.id,
                          })
                        : t(stores ? 'ecommerce.orders.pickup.store.required' : 'ecommerce.orders.pickup.required')}
                    </Typography>
                    <PickupPointPicker
                      stores={stores}
                      initialPostalCode={orderPoint?.customerAddress?.postalCode ?? order.shippingAddress?.postalCode ?? ''}
                      value={point}
                      onChange={(next) => {
                        setPoint(next);
                        setErrors({});
                      }}
                      disabled={busy}
                      error={errors.form ? pickupErrorText(errors.form) : undefined}
                    />
                  </Flex>
                )}
                {errors.form && pickup === 'NONE' && (
                  <Typography variant="omega" textColor="danger600">
                    {codeText(errors.form)}
                  </Typography>
                )}
              </Flex>
            )}
          </Box>
        </MethodsPanel>
      </Flex>
    );
  };

  return (
    <Modal.Root open onOpenChange={(next: boolean) => !next && !busy && onClose()}>
      <Modal.Content style={{ maxWidth: 960, width: '100%' }}>
        <Modal.Header>
          <Modal.Title>{title}</Modal.Title>
        </Modal.Header>
        <Modal.Body>{body()}</Modal.Body>
        <Modal.Footer>
          <Button variant="tertiary" onClick={onClose} disabled={busy}>
            {t('ecommerce.orders.shippingCharges.close')}
          </Button>
          {!saved && (
            <Button onClick={save} loading={busy} disabled={!option || unchanged}>
              {t('ecommerce.orders.shippingCharges.save')}
            </Button>
          )}
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
};

export default ShippingLineModal;
