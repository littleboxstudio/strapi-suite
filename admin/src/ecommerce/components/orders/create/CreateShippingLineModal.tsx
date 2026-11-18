import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import {
  Box,
  Button,
  Field,
  Flex,
  Loader,
  Modal,
  TextInput,
  Typography,
} from '@strapi/design-system';
import { getTranslation } from '../../../../core/utils/getTranslation';
import { formatAmountInput, formatCents } from '../../../utils/money';
import {
  defaultShippingOptionKey,
  shippingLineDraftToInput,
  shippingOptionKey,
} from '../../../utils/orderEditing';
import { keptPickup, storeChoices } from '../../../utils/pickupPoints';
import { shippingLineFromOption } from '../../../utils/createOrder';
import type { DraftShippingLine } from '../../../utils/orderForm';
import type { PickupSelection, ShippingQuote } from '../../../orderTypes';
import EmptyNote from '../EmptyNote';
import NoticeBar from '../NoticeBar';
import { MethodItem, MethodList, MethodListRest, MethodsPanel } from '../MethodsPanel';
import PickupPointPicker from '../PickupPointPicker';

type Props = {
  /** Edit: the line in the table; Add: none. */
  line?: DraftShippingLine;
  /** Quotes the methods for the cart (gifts included) at the shipping address. */
  loadOptions: () => Promise<ShippingQuote>;
  /** Where the DPD point search starts (the shipping address's postal code). */
  postalCode: string;
  /** A translated server error of this line (its pickup point, method or amount). */
  error?: string;
  /** Translates a picker error code (worded for a store with Store pickup). */
  pickupErrorText: (code: string, store: boolean) => string;
  codeText: (code: string) => string;
  onClose: () => void;
  /** The line as the table keeps it (`key` from `line`, or a new one). */
  onSave: (line: Omit<DraftShippingLine, 'key'>) => void;
};

/**
 * Create order's Add/Edit shipping, like the order's Add shipping: the methods quoted for the cart
 * with their price on the left; the amount (the quote as the suggestion) and, for a pickup method,
 * the point or store on the right. Mount it only while open: each opening quotes once.
 */
const CreateShippingLineModal = ({
  line,
  loadOptions,
  postalCode,
  error,
  pickupErrorText,
  codeText,
  onClose,
  onSave,
}: Props) => {
  const { formatMessage, locale } = useIntl();
  const t = (id: string, values?: Record<string, any>) =>
    formatMessage({ id: getTranslation(id) }, values);
  const money = (cents: number) => formatCents(cents, locale);

  const [quote, setQuote] = useState<ShippingQuote | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [price, setPrice] = useState('');
  const [point, setPoint] = useState<PickupSelection | null>(line?.pickup ?? null);
  const [errors, setErrors] = useState<{ method?: string; amount?: string; pickup?: string }>({});

  useEffect(() => {
    let cancelled = false;
    loadOptions()
      .then((result) => {
        if (cancelled) return;
        const key = defaultShippingOptionKey(result.options, line ?? null, result.failures);
        setQuote(result);
        setSelected(key);
        const option = result.options.find((o) => shippingOptionKey(o) === key);
        // Edit keeps the line's own amount for its own method; else the quote is the start.
        const same =
          !!option &&
          !!line &&
          option.providerId === line.providerId &&
          option.serviceId === line.serviceId;
        if (option) setPrice(formatAmountInput(same && line ? line.amount : option.price, locale));
        // The line's point belongs to its own method only.
        if (!same) setPoint(null);
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      });
    return () => {
      cancelled = true;
    };
    // Quoted once per opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const options = quote?.options ?? null;
  const option = options?.find((o) => shippingOptionKey(o) === selected) ?? null;
  const stores = storeChoices(option);

  const choose = (key: string) => {
    const next = options?.find((o) => shippingOptionKey(o) === key);
    if (!next) return;
    // A point chosen for another method does not carry over.
    setPoint((p) => (option ? keptPickup(option, next, p) : null));
    setSelected(key);
    setPrice(formatAmountInput(next.price, locale));
    setErrors({});
  };

  const save = () => {
    const draft = shippingLineDraftToInput(option, price);
    if (!draft.input || !option) {
      const found: typeof errors = {};
      draft.errors.forEach((e) => {
        if (e.path === 'amount' || e.path === 'method') found[e.path] = e.code;
      });
      setErrors(found);
      return;
    }
    if (option.requiresPickupPoint && !point) {
      setErrors({ pickup: 'PICKUP_POINT_REQUIRED' });
      return;
    }
    const { key: _key, ...next } = shippingLineFromOption(option, draft.input.amount, point, '');
    onSave(next);
    onClose();
  };

  const body = () => {
    if (loadFailed) {
      return (
        <Typography variant="omega" textColor="danger600">
          {t('ecommerce.orders.shipping.error')}
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
    return (
      <Flex direction="column" alignItems="stretch" gap={4}>
        {quote && quote.failures.length > 0 && (
          <NoticeBar
            wrap
            text={t('ecommerce.orders.shipping.failures', {
              providers: quote.failures.map((f) => f.providerId).join(', '),
            })}
          />
        )}
        {error && (
          <Typography variant="omega" textColor="danger600" role="alert">
            {error}
          </Typography>
        )}
        {!options.length ? (
          <EmptyNote>{t('ecommerce.orders.shipping.none')}</EmptyNote>
        ) : (
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
                    onClick={() => !isSelected && choose(key)}
                  >
                    <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <span>{o.name}</span>
                      <span style={{ whiteSpace: 'nowrap' }}>{money(o.price)}</span>
                    </span>
                  </MethodItem>
                );
              })}
              <MethodListRest />
            </MethodList>
            <Box flex="1" padding={5} minWidth={0}>
              {!option ? (
                <Typography variant="omega" textColor={errors.method ? 'danger600' : 'neutral600'}>
                  {t('ecommerce.orders.shipping.choose')}
                </Typography>
              ) : (
                <Flex direction="column" alignItems="stretch" gap={4}>
                  <Field.Root
                    name="amount"
                    error={errors.amount ? codeText(errors.amount) : undefined}
                    hint={t('ecommerce.orders.shippingCharges.suggested', {
                      amount: money(option.price),
                    })}
                  >
                    <Field.Label>{t('ecommerce.orders.shippingCharges.price')}</Field.Label>
                    <TextInput
                      value={price}
                      inputMode="decimal"
                      onChange={(e: any) => {
                        setPrice(e.target.value);
                        setErrors({});
                      }}
                    />
                    <Field.Hint />
                    <Field.Error />
                  </Field.Root>
                  {option.requiresPickupPoint && (
                    <Flex direction="column" alignItems="stretch" gap={2}>
                      <Typography variant="sigma" textColor="neutral600">
                        {t(
                          stores
                            ? 'ecommerce.orders.pickup.store.title'
                            : 'ecommerce.orders.pickup.title'
                        )}
                      </Typography>
                      <PickupPointPicker
                        stores={stores}
                        hint={t('ecommerce.orders.pickup.store.required')}
                        initialPostalCode={point?.postalCode || postalCode}
                        value={point}
                        onChange={(next) => {
                          setPoint(next);
                          setErrors({});
                        }}
                        error={errors.pickup ? pickupErrorText(errors.pickup, !!stores) : undefined}
                      />
                    </Flex>
                  )}
                </Flex>
              )}
            </Box>
          </MethodsPanel>
        )}
      </Flex>
    );
  };

  return (
    <Modal.Root open onOpenChange={(next: boolean) => !next && onClose()}>
      <Modal.Content style={{ maxWidth: 960, width: '100%' }}>
        <Modal.Header>
          <Modal.Title>
            {t(line ? 'ecommerce.orders.new.shippingEdit' : 'ecommerce.orders.new.shippingAdd')}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>{body()}</Modal.Body>
        <Modal.Footer>
          <Button variant="tertiary" onClick={onClose}>
            {t('ecommerce.orders.shippingCharges.close')}
          </Button>
          <Button variant="secondary" onClick={save} disabled={!option}>
            {t('ecommerce.orders.shippingCharges.save')}
          </Button>
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
};

export default CreateShippingLineModal;
