import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useIntl } from 'react-intl';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useNotification } from '@strapi/strapi/admin';
import {
  Box,
  Button,
  Checkbox,
  Field,
  Flex,
  Grid,
  IconButton,
  SingleSelect,
  SingleSelectOption,
  TextInput,
  Typography,
} from '@strapi/design-system';
import { ArrowLeft } from '@strapi/icons';
import config from '../../../core/config';
import { getTranslation } from '../../../core/utils/getTranslation';
import FetchOrderLocales from '../../usecases/orders/fetchOrderLocales';
import FetchCustomer from '../../usecases/orders/fetchCustomer';
import FetchCustomerLastAddresses from '../../usecases/orders/fetchCustomerLastAddresses';
import QuoteOrderShipping from '../../usecases/orders/quoteOrderShipping';
import CreateOrder from '../../usecases/orders/createOrder';
import QuoteOrder from '../../usecases/orders/quoteOrder';
import AddressFields, { type AddressField } from '../../components/orders/AddressFields';
import VariantPicker from '../../components/orders/VariantPicker';
import OrderLinesEditor from '../../components/orders/OrderLinesEditor';
import TotalsPreview from '../../components/orders/TotalsPreview';
import OrderQuotePanel from '../../components/orders/OrderQuotePanel';
import { extractFieldErrors } from '../../utils/productForm';
import { mintUuid } from '../../utils/variantDraft';
import { formatCents } from '../../utils/money';
import { useOrderPermissions } from '../../hooks/useOrderPermissions';
import { apiErrorCode } from '../../utils/orderDetail';
import {
  addLine,
  addPromotionCode,
  addressFormFromAddress,
  buildCreateOrderInput,
  buildQuoteInput,
  createOrderConflict,
  emptyOrderForm,
  giftChoicesFromQuote,
  pruneGiftChoices,
  toOrderErrorMap,
  validateOrderForm,
  type OrderErrorMap,
  type OrderForm,
} from '../../utils/orderForm';
import type {
  FieldError,
  OrderLocales,
  OrderQuote,
  ShippingQuote,
  VariantSearchResult,
} from '../../orderTypes';

/** Typing pause before the cart is priced again. */
const QUOTE_DELAY_MS = 400;

const CUSTOMER_FIELDS = [
  { field: 'firstName', required: true, type: 'text' },
  { field: 'lastName', required: true, type: 'text' },
  { field: 'email', required: true, type: 'email' },
  { field: 'phone', required: false, type: 'tel' },
] as const;

type CustomerField = (typeof CUSTOMER_FIELDS)[number]['field'];

const optionKey = (o: { providerId: string; serviceId: string }) => `${o.providerId}::${o.serviceId}`;

const Section = ({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) => (
  <Box background="neutral0" shadow="tableShadow" hasRadius padding={6}>
    <Flex direction="column" alignItems="stretch" gap={5}>
      <Flex justifyContent="space-between" alignItems="center" gap={4}>
        <Typography variant="delta" tag="h2">
          {title}
        </Typography>
        {actions}
      </Flex>
      {children}
    </Flex>
  </Box>
);

const OrderCreatePage = () => {
  const { formatMessage, locale: uiLocale } = useIntl();
  const navigate = useNavigate();
  const { toggleNotification } = useNotification();
  const [searchParams] = useSearchParams();
  const basePath = `/plugins/${config.pluginId}/ecommerce/orders`;
  const t = (id: string, values?: Record<string, any>) =>
    formatMessage({ id: getTranslation(id) }, values);

  const rawCustomerId = Number(searchParams.get('customerId'));
  const customerId = Number.isInteger(rawCustomerId) && rawCustomerId > 0 ? rawCustomerId : null;

  const { isLoading: permissionsLoading, canManage } = useOrderPermissions();

  // One key per form: a retried submit returns the order created by the first one.
  const [idempotencyKey] = useState(() => mintUuid());
  const [form, setForm] = useState<OrderForm>(() => emptyOrderForm(''));
  const [errors, setErrors] = useState<OrderErrorMap>({});
  const [locales, setLocales] = useState<OrderLocales['locales']>([]);
  const [quote, setQuote] = useState<ShippingQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [loadingAddresses, setLoadingAddresses] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // Promotions: the server's quote of the cart (codes, gifts, discounts and totals).
  const [defaultLocale, setDefaultLocale] = useState<string | null>(null);
  const [giftChoices, setGiftChoices] = useState<Record<number, number>>({});
  const [priced, setPriced] = useState<{ signature: string; quote: OrderQuote } | null>(null);
  const [pricing, setPricing] = useState(0);
  const [pricingError, setPricingError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    new FetchOrderLocales()
      .execute()
      .then((data) => {
        if (cancelled) return;
        setLocales(data.locales);
        setDefaultLocale(data.defaultLocale);
        setForm((f) => (f.locale ? f : { ...f, locale: data.defaultLocale }));
      })
      .catch(() => {
        if (!cancelled) toggleNotification({ type: 'danger', message: t('ecommerce.orders.new.localesError') });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!customerId) return undefined;
    let cancelled = false;
    new FetchCustomer()
      .execute(customerId)
      .then((c) => {
        if (cancelled) return;
        setForm((f) => ({
          ...f,
          customer: {
            firstName: c.firstName ?? '',
            lastName: c.lastName ?? '',
            email: c.email ?? '',
            phone: c.phone ?? '',
          },
        }));
      })
      .catch(() => {
        if (!cancelled) toggleNotification({ type: 'warning', message: t('ecommerce.orders.new.customerError') });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId]);

  // The quote depends on the destination country and the lines: any change invalidates it.
  const quoteSignature = useMemo(
    () =>
      `${form.shippingAddress.country}|${form.lines.map((l) => `${l.variantId}x${l.quantity}`).join(',')}`,
    [form.shippingAddress.country, form.lines]
  );
  // Latest signature, read by the async quote handler.
  const quoteSignatureRef = useRef(quoteSignature);
  quoteSignatureRef.current = quoteSignature;
  useEffect(() => {
    setQuote(null);
    setForm((f) => (f.shipping ? { ...f, shipping: null } : f));
  }, [quoteSignature]);

  const quoteInput = useMemo(() => buildQuoteInput(form, giftChoices), [form, giftChoices]);
  const priceSignature = useMemo(() => JSON.stringify(quoteInput), [quoteInput]);
  const priceSignatureRef = useRef(priceSignature);
  priceSignatureRef.current = priceSignature;
  const canPrice =
    !!quoteInput.locale &&
    quoteInput.lines.length > 0 &&
    quoteInput.lines.every((l) => Number.isSafeInteger(l.quantity) && l.quantity >= 1);

  /**
   * Prices the cart as it is now. `quote` is null when it failed (`error`, `cause`) or the cart
   * changed meanwhile.
   */
  const runPriceQuote = async (): Promise<{ quote: OrderQuote | null; error: string | null; cause?: unknown }> => {
    if (!canPrice) return { quote: null, error: t('ecommerce.orders.quote.error') };
    const signature = priceSignature;
    setPricing((n) => n + 1);
    try {
      const result = await new QuoteOrder().execute(quoteInput);
      if (signature !== priceSignatureRef.current) return { quote: null, error: null };
      setPriced({ signature, quote: result });
      setPricingError(null);
      // Choices of promotions that no longer offer a gift choice are dropped.
      setGiftChoices((choices) => pruneGiftChoices(choices, result));
      return { quote: result, error: null };
    } catch (err) {
      const code = apiErrorCode(err);
      const message = code
        ? formatMessage({
            id: getTranslation(`ecommerce.orders.errors.${code}`),
            defaultMessage: t('ecommerce.orders.quote.error'),
          })
        : t('ecommerce.orders.quote.error');
      if (signature === priceSignatureRef.current) setPricingError(message);
      return { quote: null, error: message, cause: err };
    } finally {
      setPricing((n) => n - 1);
    }
  };

  useEffect(() => {
    if (!canPrice) {
      setPriced(null);
      setPricingError(null);
      return undefined;
    }
    const timer = setTimeout(() => {
      runPriceQuote();
    }, QUOTE_DELAY_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [priceSignature, canPrice]);

  const freshQuote = priced && priced.signature === priceSignature ? priced.quote : null;
  const shownQuote = canPrice ? (priced?.quote ?? null) : null;

  const variantLabel = (variantId: number) => {
    const fromQuote = shownQuote?.lines.find((l) => l.variantId === variantId);
    if (fromQuote) return fromQuote.option ? `${fromQuote.name} — ${fromQuote.option}` : fromQuote.name;
    const fromCart = form.lines.find((l) => l.variantId === variantId);
    if (fromCart) return fromCart.option ? `${fromCart.name} — ${fromCart.option}` : fromCart.name;
    // Gift variants on offer come with their names in the quote (no promotions.read needed).
    const fromGifts = shownQuote?.giftOptions
      .flatMap((g) => g.variants)
      .find((v) => v.variantId === variantId);
    if (fromGifts) return fromGifts.option ? `${fromGifts.name} — ${fromGifts.option}` : fromGifts.name;
    return `#${variantId}`;
  };

  const addCode = (raw: string) => {
    const result = addPromotionCode(form.promotionCodes, raw);
    if (!result.error) setForm((f) => ({ ...f, promotionCodes: result.codes }));
    return result.error;
  };

  const removeCode = (code: string) =>
    setForm((f) => ({ ...f, promotionCodes: f.promotionCodes.filter((c) => c !== code) }));

  const clearErrors = (match: (path: string) => boolean) =>
    setErrors((map) => {
      const keys = Object.keys(map).filter(match);
      if (!keys.length) return map;
      const next = { ...map };
      keys.forEach((k) => delete next[k]);
      return next;
    });

  const translateCode = (code: string | undefined) =>
    code
      ? formatMessage({
          id: getTranslation(`ecommerce.orders.errors.${code}`),
          defaultMessage: t('ecommerce.orders.errors.invalid'),
        })
      : undefined;

  const updateCustomer = (field: CustomerField, value: string) => {
    setForm((f) => ({ ...f, customer: { ...f.customer, [field]: value } }));
    clearErrors((p) => p === `customer.${field}`);
  };

  const updateAddress = (which: 'shippingAddress' | 'billingAddress', field: AddressField, value: string) => {
    setForm((f) => ({ ...f, [which]: { ...f[which], [field]: value } }));
    clearErrors((p) => p === `${which}.${field}`);
  };

  const updateLines = (fn: (lines: OrderForm['lines']) => OrderForm['lines']) => {
    setForm((f) => ({ ...f, lines: fn(f.lines) }));
    // Line errors are keyed by index, which a change may shift.
    clearErrors((p) => p === 'lines' || p.startsWith('lines.') || p === 'shipping');
  };

  const addVariant = (v: VariantSearchResult) => updateLines((lines) => addLine(lines, v));

  const applyLastAddresses = async () => {
    if (!customerId) return;
    setLoadingAddresses(true);
    try {
      const last = await new FetchCustomerLastAddresses().execute(customerId);
      if (!last.shippingAddress && !last.billingAddress) {
        toggleNotification({ type: 'info', message: t('ecommerce.orders.new.noLastAddresses') });
        return;
      }
      setForm((f) => ({
        ...f,
        shippingAddress: last.shippingAddress
          ? addressFormFromAddress(last.shippingAddress)
          : f.shippingAddress,
        billingAddress: last.billingAddress ? addressFormFromAddress(last.billingAddress) : f.billingAddress,
        billingSameAsShipping: last.billingAddress ? false : f.billingSameAsShipping,
      }));
      clearErrors((p) => p.startsWith('shippingAddress.') || p.startsWith('billingAddress.'));
    } catch {
      toggleNotification({ type: 'danger', message: t('ecommerce.orders.new.lastAddressesError') });
    } finally {
      setLoadingAddresses(false);
    }
  };

  const getShippingOptions = async () => {
    if (!form.shippingAddress.country || !form.lines.length) {
      toggleNotification({ type: 'warning', message: t('ecommerce.orders.shipping.needInput') });
      return;
    }
    const signature = quoteSignature;
    setQuoting(true);
    try {
      const result = await new QuoteOrderShipping().execute({
        country: form.shippingAddress.country,
        postalCode: form.shippingAddress.postalCode.trim() || undefined,
        lines: form.lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity })),
        locale: form.locale || undefined,
      });
      // Ignore a quote for lines or a country that changed meanwhile.
      if (signature !== quoteSignatureRef.current) return;
      setQuote(result);
      clearErrors((p) => p === 'shipping');
    } catch (err) {
      const fieldErrors = extractFieldErrors(err);
      if (fieldErrors) setErrors((map) => ({ ...toOrderErrorMap(fieldErrors, form.billingSameAsShipping), ...map }));
      toggleNotification({ type: 'danger', message: t('ecommerce.orders.shipping.error') });
    } finally {
      setQuoting(false);
    }
  };

  const selectedKey = form.shipping ? optionKey(form.shipping) : null;
  const selectedOption = quote?.options.find((o) => optionKey(o) === selectedKey) ?? null;

  const showErrors = (list: FieldError[]) => {
    setErrors(toOrderErrorMap(list, form.billingSameAsShipping));
    toggleNotification({ type: 'warning', message: t('ecommerce.orders.errors.fix') });
  };

  const submit = async () => {
    if (submitting || !canManage) return;
    const local = validateOrderForm(form);
    if (local.length) {
      showErrors(local);
      return;
    }
    setSubmitting(true);
    try {
      // The order is created only with the totals the admin saw: a different server total → 409.
      let quote = freshQuote;
      if (!quote) {
        const priced = await runPriceQuote();
        if (!priced.quote) {
          // Never create without a confirmed total: show why the cart could not be priced.
          const fieldErrors = extractFieldErrors(priced.cause);
          if (fieldErrors?.length) showErrors(fieldErrors);
          else
            toggleNotification({
              type: 'danger',
              message: priced.error ?? t('ecommerce.orders.quote.error'),
            });
          return;
        }
        quote = priced.quote;
      }
      const decision = { expectedTotal: quote.totals.total, giftChoices: giftChoicesFromQuote(quote) };
      const created = await new CreateOrder().execute(buildCreateOrderInput(form, idempotencyKey, decision));
      toggleNotification({
        type: 'success',
        message: t('ecommerce.orders.new.created', { reference: created.reference }),
      });
      navigate(`${basePath}/${created.id}`);
    } catch (err) {
      const conflict = createOrderConflict(err);
      if (conflict) {
        // A promotion or the total changed: drop the old quote (its total must never be sent
        // again), price again and let the admin confirm.
        setPriced(null);
        const { quote: requoted } = await runPriceQuote();
        toggleNotification({
          type: 'warning',
          message:
            conflict === 'TOTAL_CHANGED' && requoted
              ? t('ecommerce.orders.quote.totalChanged', { total: formatCents(requoted.totals.total, uiLocale) })
              : t(`ecommerce.orders.errors.${conflict}`),
        });
        return;
      }
      const fieldErrors = extractFieldErrors(err);
      if (fieldErrors) showErrors(fieldErrors);
      else toggleNotification({ type: 'danger', message: t('ecommerce.orders.new.error') });
    } finally {
      setSubmitting(false);
    }
  };

  const backButton = (
    <IconButton label={t('ecommerce.orders.back')} onClick={() => navigate(basePath)}>
      <ArrowLeft />
    </IconButton>
  );

  if (!permissionsLoading && !canManage) {
    return (
      <Flex gap={3} alignItems="center">
        {backButton}
        <Typography textColor="neutral600">{t('ecommerce.orders.new.noPermission')}</Typography>
      </Flex>
    );
  }

  const disabled = submitting;
  const lineError = (index: number) =>
    translateCode(errors[`lines.${index}.quantity`] ?? errors[`lines.${index}.variantId`]);

  return (
    <Flex direction="column" alignItems="stretch" gap={6}>
      <Flex justifyContent="space-between" alignItems="center" gap={4}>
        <Flex gap={3} alignItems="center">
          {backButton}
          <Typography variant="beta" tag="h1">
            {t('ecommerce.orders.new.title')}
          </Typography>
        </Flex>
        <Button onClick={submit} loading={submitting} disabled={permissionsLoading}>
          {t('ecommerce.orders.create')}
        </Button>
      </Flex>

      <Section title={t('ecommerce.orders.new.customer')}>
        <Grid.Root gap={5}>
          {CUSTOMER_FIELDS.map(({ field, required, type }) => (
            <Grid.Item key={field} col={6} s={12} direction="column" alignItems="stretch">
              <Field.Root
                name={`customer.${field}`}
                required={required}
                error={translateCode(errors[`customer.${field}`])}
              >
                <Field.Label>{t(`ecommerce.customers.fields.${field}`)}</Field.Label>
                <TextInput
                  type={type}
                  value={form.customer[field]}
                  disabled={disabled}
                  onChange={(e: any) => updateCustomer(field, e.target.value)}
                />
                <Field.Error />
              </Field.Root>
            </Grid.Item>
          ))}
          <Grid.Item col={6} s={12} direction="column" alignItems="stretch">
            <Field.Root name="locale" required error={translateCode(errors.locale)}>
              <Field.Label>{t('ecommerce.orders.new.locale')}</Field.Label>
              <SingleSelect
                value={form.locale || null}
                disabled={disabled}
                hasError={!!errors.locale}
                onChange={(value: string | number) => {
                  setForm((f) => ({ ...f, locale: String(value) }));
                  clearErrors((p) => p === 'locale');
                }}
              >
                {locales.map((l) => (
                  <SingleSelectOption key={l.code} value={l.code}>
                    {l.name}
                  </SingleSelectOption>
                ))}
              </SingleSelect>
              <Field.Error />
            </Field.Root>
          </Grid.Item>
        </Grid.Root>
      </Section>

      <Section
        title={t('ecommerce.orders.new.shippingAddress')}
        actions={
          customerId ? (
            <Button
              size="S"
              variant="secondary"
              loading={loadingAddresses}
              disabled={disabled}
              onClick={applyLastAddresses}
            >
              {t('ecommerce.orders.new.useLastAddresses')}
            </Button>
          ) : undefined
        }
      >
        <AddressFields
          name="shippingAddress"
          value={form.shippingAddress}
          disabled={disabled}
          onChange={(field, value) => updateAddress('shippingAddress', field, value)}
          errorFor={(field) => translateCode(errors[`shippingAddress.${field}`])}
        />
      </Section>

      <Section title={t('ecommerce.orders.new.billingAddress')}>
        <Checkbox
          checked={form.billingSameAsShipping}
          disabled={disabled}
          onCheckedChange={(checked: boolean | 'indeterminate') => {
            setForm((f) => ({ ...f, billingSameAsShipping: checked === true }));
            clearErrors((p) => p.startsWith('billingAddress.'));
          }}
        >
          {t('ecommerce.orders.new.billingSame')}
        </Checkbox>
        {!form.billingSameAsShipping && (
          <AddressFields
            name="billingAddress"
            billing
            value={form.billingAddress}
            disabled={disabled}
            onChange={(field, value) => updateAddress('billingAddress', field, value)}
            errorFor={(field) => translateCode(errors[`billingAddress.${field}`])}
          />
        )}
      </Section>

      <Section title={t('ecommerce.orders.new.products')}>
        <VariantPicker locale={form.locale || undefined} onAdd={addVariant} disabled={disabled} />
        {errors.lines && (
          <Typography textColor="danger600" variant="pi">
            {translateCode(errors.lines)}
          </Typography>
        )}
        <OrderLinesEditor
          lines={form.lines}
          disabled={disabled}
          errorFor={lineError}
          onQuantityChange={(index, quantity) =>
            updateLines((lines) => lines.map((l, i) => (i === index ? { ...l, quantity } : l)))
          }
          onRemove={(index) => updateLines((lines) => lines.filter((_, i) => i !== index))}
        />
      </Section>

      <Grid.Root gap={6}>
        <Grid.Item col={7} s={12} direction="column" alignItems="stretch">
          <Section title={t('ecommerce.orders.shipping.title')}>
            <Flex direction="column" alignItems="stretch" gap={4}>
              <Box>
                <Button
                  variant="secondary"
                  loading={quoting}
                  disabled={disabled}
                  onClick={getShippingOptions}
                >
                  {t('ecommerce.orders.shipping.get')}
                </Button>
              </Box>
              {quote && quote.failures.length > 0 && (
                <Box padding={3} background="warning100" borderColor="warning200" hasRadius>
                  <Typography textColor="warning700" variant="pi">
                    {t('ecommerce.orders.shipping.failures', {
                      providers: quote.failures.map((f) => f.providerId).join(', '),
                    })}
                  </Typography>
                </Box>
              )}
              {quote && quote.options.length === 0 && (
                <Typography textColor="neutral600">{t('ecommerce.orders.shipping.none')}</Typography>
              )}
              {(!!quote?.options.length || !!errors.shipping) && (
                <Field.Root name="shipping" required error={translateCode(errors.shipping)}>
                  <Field.Label>{t('ecommerce.orders.shipping.option')}</Field.Label>
                  <SingleSelect
                    value={selectedOption ? selectedKey : null}
                    disabled={disabled || !quote?.options.length}
                    hasError={!!errors.shipping}
                    placeholder={t('ecommerce.orders.shipping.placeholder')}
                    onChange={(value: string | number) => {
                      const option = quote?.options.find((o) => optionKey(o) === String(value));
                      if (!option) return;
                      setForm((f) => ({
                        ...f,
                        shipping: { providerId: option.providerId, serviceId: option.serviceId },
                      }));
                      clearErrors((p) => p === 'shipping');
                    }}
                  >
                    {(quote?.options ?? []).map((o) => (
                      <SingleSelectOption key={optionKey(o)} value={optionKey(o)}>
                        {`${o.name} — ${formatCents(o.price, uiLocale)}`}
                      </SingleSelectOption>
                    ))}
                  </SingleSelect>
                  <Field.Error />
                </Field.Root>
              )}
            </Flex>
          </Section>
        </Grid.Item>
        <Grid.Item col={5} s={12} direction="column" alignItems="stretch">
          <OrderQuotePanel
            codes={form.promotionCodes}
            onAddCode={addCode}
            onRemoveCode={removeCode}
            quote={shownQuote}
            loading={pricing > 0}
            error={canPrice ? pricingError : null}
            locale={form.locale}
            defaultLocale={defaultLocale}
            variantLabel={variantLabel}
            onGiftChoice={(promotionId, variantId) =>
              setGiftChoices((choices) => ({ ...choices, [promotionId]: variantId }))
            }
            disabled={disabled}
            fallbackTotals={<TotalsPreview lines={form.lines} shippingPrice={selectedOption?.price ?? null} />}
          />
        </Grid.Item>
      </Grid.Root>
    </Flex>
  );
};

export { OrderCreatePage };
