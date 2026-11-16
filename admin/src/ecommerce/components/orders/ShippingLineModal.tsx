import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import { useNotification } from '@strapi/strapi/admin';
import { Box, Button, Checkbox, Field, Flex, Loader, Modal, TextInput, Typography } from '@strapi/design-system';
import { getTranslation } from '../../../core/utils/getTranslation';
import FetchShippingOptions from '../../usecases/orders/fetchShippingOptions';
import FetchShippingOptionsForUnits from '../../usecases/orders/fetchShippingOptionsForUnits';
import ShippingReviewSummary from './ShippingReviewSummary';
import EditShippingLine from '../../usecases/orders/editShippingLine';
import AddShippingLine from '../../usecases/orders/addShippingLine';
import { formatAmountInput, formatCents } from '../../utils/money';
import {
  currentShippingMethod,
  defaultShippingOptionKey,
  shippingLineDraftToInput,
  shippingLineEditUnchanged,
  shippingLineErrorKey,
  shippingLineAmount,
  shippingOptionKey,
  suggestedChargePrice,
} from '../../utils/orderEditing';
import { apiErrorMessageId } from '../../utils/orderDetail';
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
  ShipUnits,
  ShippingReview,
} from '../../orderTypes';
import EmptyNote from './EmptyNote';
import NoticeBar, { NOTICE_BACKGROUND, NOTICE_TEXT } from './NoticeBar';
import { MethodItem, MethodList, MethodListRest, MethodsPanel } from './MethodsPanel';
import PickupPointPicker from './PickupPointPicker';

type Props = {
  order: Order;
  /** EDIT changes `line` (spec 6.2); ADD always creates a new line. */
  mode: 'EDIT' | 'ADD';
  line?: ShippingLineView;
  onClose: () => void;
  onSaved: (result: EditResult) => void;
  /**
   * From Recalculate shipping: the units the new charge is for (the options are quoted for them and
   * each method's quote is its suggestion), with the review shown above, updated as the method and
   * price change.
   */
  recalculation?: {
    units: ShipUnits;
    review: ShippingReview;
    /**
     * Option 2 (the products still to ship): a checkbox switches between the paid units and every
     * unit not yet shipped; the options are quoted again.
     */
    unpaid?: { paid: ShipUnits; all: ShipUnits; withUnpaid: boolean; onChange: (withUnpaid: boolean) => void };
    /** Back to Recalculate shipping's previous step. */
    onBack: () => void;
  };
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
 * Edit or add a shipping charge: the methods that serve the address and weight on the left, the
 * price (with its suggestion) and the pickup point or store on the right. Saving closes it: money
 * due or to give back is handled from the order page. Mount it only while open: each opening
 * mints one operationId.
 */
const ShippingLineModal = ({ order, mode, line, onClose, onSaved, recalculation }: Props) => {
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
  const [loadFailed, setLoadFailed] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [price, setPrice] = useState('');
  const [errors, setErrors] = useState<Partial<Record<ErrorKey, string>>>({});
  const [busy, setBusy] = useState(false);
  const [point, setPoint] = useState<PickupSelection | null>(null);
  /** What a new charge is suggested against (units not yet shipped, shipping charged so far). */
  const [suggestionBase, setSuggestionBase] = useState<{ pendingOnly?: boolean; charged?: number }>({});

  /**
   * The suggested price of an option (Add and Edit): its quote of the units not yet shipped minus
   * the shipping already charged (Edit: without the line being edited). Null at 0 or below: no
   * suggestion.
   */
  const suggestionOf = (o: ShippingOption, base = suggestionBase): number | null =>
    recalculation
      ? o.price > 0
        ? o.price
        : null
      : suggestedChargePrice(o.price, {
      ...base,
      // Edit: the line being edited is replaced, so it does not count as already charged.
      charged: (base.charged ?? 0) - (mode === 'EDIT' && line ? shippingLineAmount(line) : 0),
    });

  /** The price a method starts with: Edit, the line's own amount for its own method; else the suggestion. */
  const startPrice = (o: ShippingOption, base = suggestionBase): number =>
    mode === 'EDIT' && line && o.providerId === line.providerId && o.serviceId === line.serviceId
      ? shippingLineAmount(line)
      : (suggestionOf(o, base) ?? 0);

  // Recalculation: the units quoted (option 2 switches them with its checkbox).
  const units = recalculation?.unpaid
    ? recalculation.unpaid.withUnpaid
      ? recalculation.unpaid.all
      : recalculation.unpaid.paid
    : recalculation?.units;
  const unitsKey = JSON.stringify(units ?? null);

  useEffect(() => {
    let cancelled = false;
    if (units && units.length === 0) {
      setOptions([]);
      return;
    }
    setOptions(null);
    (units
      ? new FetchShippingOptionsForUnits().execute(order.id, units)
      : new FetchShippingOptions().execute(order.id)
    )
      .then(({ options: offered, failures: failed, pendingOnly, charged }) => {
        if (cancelled) return;
        const base = { pendingOnly, charged };
        setSuggestionBase(base);
        const preferred = line
          ? { providerId: line.providerId, serviceId: line.serviceId }
          : currentShippingMethod(order.shippingLines);
        const key = defaultShippingOptionKey(offered, preferred, failed);
        setOptions(offered);
        setSelected(key);
        const option = offered.find((o) => shippingOptionKey(o) === key);
        if (option) setPrice(formatAmountInput(startPrice(option, base), locale));
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
    // Loaded once per opening (and per units in a recalculation).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unitsKey]);

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
    if (next) setPrice(formatAmountInput(startPrice(next), locale));
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
      // Money due or to give back is on the order page (its alerts and buttons): no balance step.
      toggleNotification({ type: 'success', message: t('ecommerce.orders.shippingCharges.saved') });
      onClose();
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

  const title = t(
    recalculation
      ? 'ecommerce.orders.shippingCharges.recalculate'
      : mode === 'EDIT'
        ? 'ecommerce.orders.shippingCharges.editTitle'
        : 'ecommerce.orders.shippingCharges.add'
  );

  /** Option 2: count the products not paid yet too (the options are quoted again). */
  const unpaidCheckbox = recalculation?.unpaid ? (
    <Checkbox
      checked={recalculation.unpaid.withUnpaid}
      disabled={busy}
      onCheckedChange={(v: boolean | 'indeterminate') => recalculation.unpaid!.onChange(v === true)}
    >
      {t('ecommerce.orders.shippingCharges.steps.withUnpaid.REMAINING')}
    </Checkbox>
  ) : null;

  const body = () => {
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
    if (!options.length) {
      // Option 2 with no paid unit left to ship: the checkbox can still add the unpaid ones.
      return (
        <Flex direction="column" alignItems="stretch" gap={4}>
          {unpaidCheckbox}
          <EmptyNote>
            {t(
              units && units.length === 0
                ? 'ecommerce.orders.shippingCharges.steps.noUnits'
                : 'ecommerce.orders.shippingCharges.noMethods'
            )}
          </EmptyNote>
        </Flex>
      );
    }
    return (
      <Flex direction="column" alignItems="stretch" gap={4}>
        {!recalculation && shipped && option && (
          // Once shipped the order's address stays: a point only goes to the next shipments.
          <Box padding={3} hasRadius style={{ background: NOTICE_BACKGROUND }}>
            <Typography variant="omega" style={{ color: NOTICE_TEXT }}>
              {t(pickup === 'NONE' ? 'ecommerce.orders.pickup.shippedAddress' : 'ecommerce.orders.pickup.shippedPoint')}
            </Typography>
          </Box>
        )}
        {!recalculation && !shipped && pickup === 'NONE' && orderPoint && option && (
          <NoticeBar text={t('ecommerce.orders.pickup.restore')} />
        )}
        {unpaidCheckbox}
        {recalculation && (
          // Every charge plus the price typed, against what was paid.
          <ShippingReviewSummary
            review={recalculation.review}
            quote={recalculation.review.charged + (draft.input?.amount ?? 0)}
          />
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
                    {/* DPD Pickup: only the point the order keeps unless another is chosen. */}
                    {!stores && pickup === 'OPTIONAL' && orderPoint && (
                      <Typography variant="pi" textColor="neutral600">
                        {t('ecommerce.orders.pickup.keep', { name: orderPoint.name, id: orderPoint.id })}
                      </Typography>
                    )}
                    <PickupPointPicker
                      stores={stores}
                      hint={
                        pickup === 'OPTIONAL' && orderPoint
                          ? t('ecommerce.orders.pickup.store.keep', { name: orderPoint.name })
                          : t('ecommerce.orders.pickup.store.required')
                      }
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
          <Button variant="tertiary" onClick={recalculation ? recalculation.onBack : onClose} disabled={busy}>
            {t(recalculation ? 'ecommerce.orders.shippingCharges.steps.back' : 'ecommerce.orders.shippingCharges.close')}
          </Button>
          <Button variant="secondary" onClick={save} loading={busy} disabled={!option || unchanged}>
            {t(recalculation ? 'ecommerce.orders.shippingCharges.add' : 'ecommerce.orders.shippingCharges.save')}
          </Button>
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
};

export default ShippingLineModal;
