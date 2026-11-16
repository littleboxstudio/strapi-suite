import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import {
  Box,
  Button,
  Checkbox,
  Field,
  Flex,
  Loader,
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
} from '@strapi/design-system';
import { getTranslation } from '../../../core/utils/getTranslation';
import { InputTd } from '../InputTd';
import FetchShippingReview from '../../usecases/orders/fetchShippingReview';
import { apiErrorMessageId } from '../../utils/orderDetail';
import { parseQuantity, shippableOf } from '../../utils/shipmentForm';
import type { Order, ShippingReview, ShipUnits } from '../../orderTypes';
import ShippingReviewSummary from './ShippingReviewSummary';

/** What the admin recalculates once units have shipped. */
export type RecalculationChoice = 'WHOLE' | 'REMAINING' | 'SELECT';
type Step = 'CHOOSE' | 'SUMMARY' | 'PRODUCTS';

/** Where the steps were left, to come back to them from the shipping charge modal. */
export type RecalculationState = {
  review: ShippingReview;
  step: Step;
  choice: RecalculationChoice;
  withUnpaid: boolean;
  quantities: Record<number, string>;
};

type Props = {
  order: Order;
  onClose: () => void;
  /**
   * Options 2 and 3: a new charge for `units` in the shipping charge modal. `state` brings the steps
   * back as they were (Back).
   */
  onAddCharge: (units: ShipUnits, state: RecalculationState) => void;
  /** Coming back from the shipping charge modal. */
  resume?: RecalculationState;
};

const CHOICES: RecalculationChoice[] = ['WHOLE', 'REMAINING', 'SELECT'];

/**
 * Recalculate shipping (informative). Nothing shipped yet: the whole order quoted under its original
 * method against what was paid (still to pay, or a refund). Once units shipped, in steps: (1) the
 * same summary; (2) a new charge for the units not yet shipped; (3) a new charge for chosen units
 * not yet shipped. Products not paid yet count only when the admin ticks it (step 2). 2 and 3
 * continue in the shipping charge modal. It never changes charges.
 */
const RecalculateShippingModal = ({ order, onClose, onAddCharge, resume }: Props) => {
  const { formatMessage } = useIntl();
  const t = (id: string, values?: Record<string, any>) => formatMessage({ id: getTranslation(id) }, values);
  const [review, setReview] = useState<ShippingReview | null>(resume?.review ?? null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>(resume?.step ?? 'CHOOSE');
  const [choice, setChoice] = useState<RecalculationChoice>(resume?.choice ?? 'WHOLE');
  const [quantityError, setQuantityError] = useState<string | null>(null);
  /** Options 2 and 3: count the units not paid yet too (off: only the paid ones). */
  const [withUnpaid, setWithUnpaid] = useState(resume?.withUnpaid ?? false);
  /** The units of a line options 2 and 3 work with. */
  const unitsOf = (l: Order['lines'][number]) => (withUnpaid ? l.pending : shippableOf(l));
  const hasUnpaid = order.lines.some((l) => l.pending > shippableOf(l));
  // Option 3: those units, each line defaulting to all of them (reset when the checkbox changes).
  const selectable = order.lines.filter((l) => unitsOf(l) > 0);
  const defaults = (unpaid: boolean) =>
    Object.fromEntries(
      order.lines
        .filter((l) => (unpaid ? l.pending : shippableOf(l)) > 0)
        .map((l) => [l.id, String(unpaid ? l.pending : shippableOf(l))])
    );
  // Back from option 3 keeps its quantities; from option 2 its checkbox may have changed them.
  const [quantities, setQuantities] = useState<Record<number, string>>(() =>
    resume && resume.choice === 'SELECT' ? resume.quantities : defaults(resume?.withUnpaid ?? false)
  );
  const toggleUnpaid = (on: boolean) => {
    setWithUnpaid(on);
    setQuantities(defaults(on));
    setQuantityError(null);
  };

  useEffect(() => {
    if (resume) return;
    let cancelled = false;
    new FetchShippingReview()
      .execute(order.id)
      .then((r) => {
        if (cancelled) return;
        setReview(r);
        if (!r.hasShipments) setStep('SUMMARY');
      })
      .catch((err) => !cancelled && setLoadError(apiErrorMessageId(err, 'ecommerce.orders.shippingCharges.previewError')));
    return () => {
      cancelled = true;
    };
    // Loaded once per opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const state = (): RecalculationState => ({ review: review!, step, choice, withUnpaid, quantities });

  /** Option 3: the chosen units, or null (and the error) when one is not valid. */
  const chosenUnits = (): ShipUnits | null => {
    const units: ShipUnits = [];
    for (const l of selectable) {
      const q = parseQuantity(quantities[l.id] ?? '');
      if (q === null || q > unitsOf(l)) {
        setQuantityError('ecommerce.orders.errors.QUANTITY_EXCEEDS_PENDING');
        return null;
      }
      if (q > 0) units.push({ orderLineId: l.id, quantity: q });
    }
    if (!units.length) {
      setQuantityError('ecommerce.orders.shippingCharges.steps.noUnits');
      return null;
    }
    return units;
  };

  const next = () => {
    if (!review) return;
    if (step === 'CHOOSE') {
      if (choice === 'WHOLE') setStep('SUMMARY');
      else if (choice === 'SELECT') setStep('PRODUCTS');
      // Option 2: its checkbox is in the next step (the shipping charge modal).
      else onAddCharge([], { ...state(), step: 'CHOOSE' });
      return;
    }
    if (step === 'PRODUCTS') {
      const units = chosenUnits();
      if (units) onAddCharge(units, state());
    }
  };

  const body = () => {
    if (loadError) {
      return (
        <Typography variant="omega" textColor="danger600">
          {t(loadError)}
        </Typography>
      );
    }
    if (!review) {
      return (
        <Flex justifyContent="center" padding={4}>
          <Loader small />
        </Flex>
      );
    }
    if (step === 'SUMMARY') return <ShippingReviewSummary review={review} />;
    if (step === 'CHOOSE') {
      return (
        <Field.Root name="recalculation">
          <Field.Label>{t('ecommerce.orders.shippingCharges.steps.question')}</Field.Label>
          <Radio.Group
            value={choice}
            aria-label={t('ecommerce.orders.shippingCharges.steps.question')}
            onValueChange={(v: string) => setChoice(v as RecalculationChoice)}
          >
            {CHOICES.map((c) => {
              const disabled = c !== 'WHOLE' && !order.lines.some((l) => l.pending > 0);
              return (
                <Radio.Item key={c} value={c} disabled={disabled}>
                  <Flex direction="column" alignItems="flex-start" gap={1}>
                    <Typography>{t(`ecommerce.orders.shippingCharges.steps.${c}`)}</Typography>
                    <Typography variant="pi" textColor="neutral600">
                      {t(`ecommerce.orders.shippingCharges.steps.${c}.hint`)}
                    </Typography>
                  </Flex>
                </Radio.Item>
              );
            })}
          </Radio.Group>
        </Field.Root>
      );
    }
    // PRODUCTS: the units not yet shipped (the paid ones, unless the checkbox adds the others).
    return (
      <Flex direction="column" alignItems="stretch" gap={3}>
        {hasUnpaid && (
          <Checkbox checked={withUnpaid} onCheckedChange={(v: boolean | 'indeterminate') => toggleUnpaid(v === true)}>
            {t('ecommerce.orders.shippingCharges.steps.withUnpaid.SELECT')}
          </Checkbox>
        )}
        <Table colCount={3} rowCount={selectable.length + 1}>
          <Thead>
            <Tr>
              <Th>
                <Typography variant="sigma">{t('ecommerce.orders.ship.columns.product')}</Typography>
              </Th>
              <Th>
                <Typography variant="sigma">{t('ecommerce.orders.ship.columns.pending')}</Typography>
              </Th>
              <Th>
                <Typography variant="sigma">{t('ecommerce.orders.ship.columns.quantity')}</Typography>
              </Th>
            </Tr>
          </Thead>
          <Tbody>
            {selectable.map((l) => (
              <Tr key={l.id}>
                <Td style={{ maxWidth: 320, whiteSpace: 'normal' }}>
                  <Flex direction="column" alignItems="flex-start">
                    <Typography textColor="neutral800" style={{ whiteSpace: 'normal' }}>
                      {l.name}
                    </Typography>
                    {l.option && (
                      <Typography variant="pi" textColor="neutral600">
                        {l.option}
                      </Typography>
                    )}
                  </Flex>
                </Td>
                <Td>
                  <Typography textColor="neutral800">{unitsOf(l)}</Typography>
                </Td>
                {/* A plain cell: the Table's keyboard grid would trap the focus in the first field. */}
                <InputTd style={{ width: 120 }}>
                  <TextInput
                    aria-label={t('ecommerce.orders.ship.columns.quantity')}
                    value={quantities[l.id] ?? ''}
                    inputMode="numeric"
                    onChange={(e: any) => {
                      setQuantities((q) => ({ ...q, [l.id]: e.target.value }));
                      setQuantityError(null);
                    }}
                  />
                </InputTd>
              </Tr>
            ))}
          </Tbody>
        </Table>
        {quantityError && (
          <Typography variant="omega" textColor="danger600">
            {t(quantityError)}
          </Typography>
        )}
      </Flex>
    );
  };

  const canGoBack = !!review?.hasShipments && step !== 'CHOOSE';

  return (
    <Modal.Root open onOpenChange={(open: boolean) => !open && onClose()}>
      <Modal.Content style={{ maxWidth: 760, width: '100%' }}>
        <Modal.Header>
          <Modal.Title>{t('ecommerce.orders.shippingCharges.recalculate')}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Box>{body()}</Box>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="tertiary" onClick={canGoBack ? () => setStep('CHOOSE') : onClose}>
            {t(canGoBack ? 'ecommerce.orders.shippingCharges.steps.back' : 'ecommerce.orders.shippingCharges.close')}
          </Button>
          {review && (step === 'CHOOSE' || step === 'PRODUCTS') && (
            <Button variant="secondary" onClick={next}>{t('ecommerce.orders.shippingCharges.steps.next')}</Button>
          )}
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
};

export default RecalculateShippingModal;
