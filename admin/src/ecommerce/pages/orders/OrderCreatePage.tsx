import { useEffect, useMemo, useRef, useState } from 'react';
import { useIntl } from 'react-intl';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useNotification } from '@strapi/strapi/admin';
import {
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
import FetchOrder from '../../usecases/orders/fetchOrder';
import SearchPickupPoints from '../../usecases/orders/searchPickupPoints';
import AddressFields, { type AddressField } from '../../components/orders/AddressFields';
import VariantPicker from '../../components/orders/VariantPicker';
import OrderLinesEditor from '../../components/orders/OrderLinesEditor';
import OrderSection from '../../components/orders/OrderSection';
import NoticeBar from '../../components/orders/NoticeBar';
import EmptyNote from '../../components/orders/EmptyNote';
import DiscountsTable from '../../components/orders/DiscountsTable';
import PromotionCodesField from '../../components/orders/PromotionCodesField';
import QuoteGifts from '../../components/orders/QuoteGifts';
import CreateManualDiscountModal from '../../components/orders/CreateManualDiscountModal';
import CreateShippingPanel, { shippingOptionKey } from '../../components/orders/CreateShippingPanel';
import { Tile, Tiles } from '../../components/orders/SummaryTiles';
import { extractFieldErrors } from '../../utils/productForm';
import { mintUuid } from '../../utils/variantDraft';
import { formatCents } from '../../utils/money';
import { keptPickup, pickupErrorId, storeChoices } from '../../utils/pickupPoints';
import { useOrderPermissions } from '../../hooks/useOrderPermissions';
import { apiErrorCode, apiErrorMessageId, promotionDisplayName, promotionRows } from '../../utils/orderDetail';
import { manualLineDiscountRows } from '../../utils/orderEditing';
import {
  dropUnavailableLines,
  duplicateDraft,
  duplicateQuoteNotices,
  restoreDuplicateShipping,
  type ShippingRef,
} from '../../utils/duplicateOrder';
import {
  addLine,
  addPromotionCode,
  addressFormFromAddress,
  buildCreateOrderInput,
  buildQuoteInput,
  createOrderConflict,
  createTotalsTiles,
  emptyOrderForm,
  giftChoicesFromQuote,
  manualDiscountEntryError,
  MAX_CREATE_MANUAL_DISCOUNTS,
  pruneGiftChoices,
  refreshLinesFromQuote,
  sumPreviewTotals,
  toOrderErrorMap,
  validateOrderForm,
  type OrderErrorMap,
  type OrderForm,
} from '../../utils/orderForm';
import type {
  FieldError,
  ManualDiscountInput,
  OrderLocales,
  OrderQuote,
  PickupSelection,
  ShippingOption,
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

/**
 * A duplicated order being settled: `LINES` until the first quote (unavailable products are
 * dropped), `SHIPPING` while its method is restored, then `DONE`.
 */
type Duplicate = {
  reference: number;
  codes: string[];
  giftChoices: Record<number, number>;
  giftNames: Record<number, string>;
  shipping: ShippingRef | null;
  pickup: PickupSelection | null;
  phase: 'LINES' | 'SHIPPING' | 'DONE';
};

/** What a duplicate could not keep, shown as notices. */
type DuplicateNotices = {
  droppedLines: string[];
  refusedCodes: string[];
  missingGifts: string[];
  shipping: 'METHOD_GONE' | 'PICKUP_GONE' | null;
};

const NO_NOTICES: DuplicateNotices = { droppedLines: [], refusedCodes: [], missingGifts: [], shipping: null };

const positiveId = (raw: string | null) => {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const OrderCreatePage = () => {
  const { formatMessage, locale: uiLocale } = useIntl();
  const navigate = useNavigate();
  const { toggleNotification } = useNotification();
  const [searchParams] = useSearchParams();
  const basePath = `/plugins/${config.pluginId}/ecommerce/orders`;
  const t = (id: string, values?: Record<string, any>) =>
    formatMessage({ id: getTranslation(id) }, values);

  const customerId = positiveId(searchParams.get('customerId'));
  // Duplicate (order detail): the order whose customer, addresses, products and choices are copied.
  const duplicateId = positiveId(searchParams.get('duplicate'));

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
  const [duplicate, setDuplicate] = useState<Duplicate | null>(null);
  const [loadingDuplicate, setLoadingDuplicate] = useState(!!duplicateId);
  const [notices, setNotices] = useState<DuplicateNotices>(NO_NOTICES);
  const [addingDiscount, setAddingDiscount] = useState(false);
  // Latest form and duplicate, read by the async quote handlers.
  const formRef = useRef(form);
  formRef.current = form;
  const duplicateRef = useRef(duplicate);
  duplicateRef.current = duplicate;

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

  useEffect(() => {
    if (!duplicateId) return undefined;
    let cancelled = false;
    setLoadingDuplicate(true);
    new FetchOrder()
      .execute(duplicateId)
      .then((order) => {
        if (cancelled) return;
        const draft = duplicateDraft(order, { legacyReason: t('ecommerce.orders.discounts.legacyReason') });
        setForm((f) => ({ ...draft.form, locale: draft.form.locale || f.locale }));
        setGiftChoices(draft.giftChoices);
        setErrors({});
        setNotices(NO_NOTICES);
        setDuplicate({
          reference: order.reference,
          codes: draft.form.promotionCodes,
          giftChoices: draft.giftChoices,
          giftNames: draft.giftNames,
          shipping: draft.shipping,
          pickup: draft.pickup,
          phase: draft.form.lines.length ? 'LINES' : 'SHIPPING',
        });
      })
      .catch(() => {
        if (!cancelled) toggleNotification({ type: 'danger', message: t('ecommerce.orders.new.duplicate.error') });
      })
      .finally(() => {
        if (!cancelled) setLoadingDuplicate(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duplicateId]);

  const setDuplicatePhase = (phase: Duplicate['phase']) =>
    setDuplicate((d) => (d && d.phase !== phase ? { ...d, phase } : d));

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
    setForm((f) => (f.shipping ? { ...f, shipping: null, pickup: null } : f));
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
      // Current prices and names (a duplicated order's lines carry the old ones).
      setForm((f) => {
        const lines = refreshLinesFromQuote(f.lines, result);
        return lines === f.lines ? f : { ...f, lines };
      });
      clearErrors((p) => p.startsWith('manualDiscounts.'));
      const dup = duplicateRef.current;
      if (dup?.phase === 'LINES') {
        // The first quote of a duplicate: what it no longer gives, then its shipping.
        const found = duplicateQuoteNotices(dup, result);
        setNotices((n) => ({
          ...n,
          refusedCodes: found.refusedCodes,
          missingGifts: found.missingGifts.map((v) => dup.giftNames[v] ?? `#${v}`),
        }));
        setDuplicatePhase('SHIPPING');
      }
      return { quote: result, error: null };
    } catch (err) {
      const code = apiErrorCode(err);
      const message = code
        ? formatMessage({
            id: getTranslation(`ecommerce.orders.errors.${code}`),
            defaultMessage: t('ecommerce.orders.quote.error'),
          })
        : t('ecommerce.orders.quote.error');
      if (signature === priceSignatureRef.current) {
        setPricingError(message);
        const fieldErrors = extractFieldErrors(err) ?? [];
        // A manual discount's error is shown on its row.
        const discountErrors = fieldErrors.filter((e) => e.path.startsWith('manualDiscounts.'));
        if (discountErrors.length) {
          setErrors((map) => {
            const kept = Object.fromEntries(Object.entries(map).filter(([k]) => !k.startsWith('manualDiscounts.')));
            return { ...kept, ...toOrderErrorMap(discountErrors, true) };
          });
        }
        if (duplicateRef.current?.phase === 'LINES') settleDuplicateLines(fieldErrors);
      }
      return { quote: null, error: message, cause: err };
    } finally {
      setPricing((n) => n - 1);
    }
  };

  /** A duplicate's first quote failed: drop the products no longer sold, or move on to shipping. */
  const settleDuplicateLines = (fieldErrors: FieldError[]) => {
    const { lines, dropped } = dropUnavailableLines(formRef.current.lines, fieldErrors);
    if (!dropped.length) {
      setDuplicatePhase('SHIPPING');
      return;
    }
    const names = dropped.map((l) => (l.option ? `${l.name} — ${l.option}` : l.name));
    setNotices((n) => ({ ...n, droppedLines: [...n.droppedLines, ...names] }));
    setForm((f) => ({ ...f, lines }));
    clearErrors((p) => p === 'lines' || p.startsWith('lines.'));
    // The remaining lines are quoted again (still LINES); with none left there is nothing to ship.
    if (!lines.length) setDuplicatePhase('DONE');
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

  /** A pickup picker's error, worded for a store with Store pickup. */
  const pickupError = (code: string | undefined, store: boolean) =>
    code
      ? formatMessage({
          id: getTranslation(pickupErrorId(code, store)),
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

  /** Quotes the shipping options of the cart; the quote, or null when it failed or is outdated. */
  const getShippingOptions = async (): Promise<ShippingQuote | null> => {
    if (!form.shippingAddress.country || !form.lines.length) {
      toggleNotification({ type: 'warning', message: t('ecommerce.orders.shipping.needInput') });
      return null;
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
      if (signature !== quoteSignatureRef.current) return null;
      setQuote(result);
      clearErrors((p) => p === 'shipping');
      return result;
    } catch (err) {
      const fieldErrors = extractFieldErrors(err);
      if (fieldErrors) setErrors((map) => ({ ...toOrderErrorMap(fieldErrors, form.billingSameAsShipping), ...map }));
      toggleNotification({ type: 'danger', message: t('ecommerce.orders.shipping.error') });
      return null;
    } finally {
      setQuoting(false);
    }
  };

  /** A duplicate's DPD point is kept only when a search of its postal code still finds it. */
  const checkDuplicatePoint = async (pickup: PickupSelection) => {
    try {
      const found = (await new SearchPickupPoints().execute(pickup.postalCode)).find((p) => p.id === pickup.point.id);
      setForm((f) =>
        f.pickup?.point.id !== pickup.point.id
          ? f
          : { ...f, pickup: found ? { point: found, postalCode: pickup.postalCode } : null }
      );
      if (!found) setNotices((n) => ({ ...n, shipping: 'PICKUP_GONE' }));
    } catch {
      // The search failed: the point stays, and creating the order confirms it.
    }
  };

  // A duplicate's shipping: quote the options once its products are settled, then restore its method.
  useEffect(() => {
    const dup = duplicate;
    if (dup?.phase !== 'SHIPPING') return;
    setDuplicatePhase('DONE');
    if (!form.shippingAddress.country || !form.lines.length) return;
    getShippingOptions().then((result) => {
      if (!result) return;
      const restored = restoreDuplicateShipping(dup.shipping, dup.pickup, result.options);
      if (restored.shipping) {
        setForm((f) => (f.shipping ? f : { ...f, shipping: restored.shipping, pickup: restored.pickup }));
      }
      if (restored.notice) setNotices((n) => ({ ...n, shipping: restored.notice }));
      if (restored.checkPoint && restored.pickup) checkDuplicatePoint(restored.pickup);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duplicate?.phase]);

  const selectedKey = form.shipping ? shippingOptionKey(form.shipping) : null;
  const selectedOption = quote?.options.find((o) => shippingOptionKey(o) === selectedKey) ?? null;
  // Store pickup: the stores of the quote instead of the DPD search.
  const stores = storeChoices(selectedOption);

  const selectShipping = (option: ShippingOption) => {
    setForm((f) => ({
      ...f,
      shipping: {
        providerId: option.providerId,
        serviceId: option.serviceId,
        ...(option.requiresPickupPoint ? { requiresPickupPoint: true } : {}),
      },
      // DPD Pickup / Store pickup: the point is chosen beside it; another option drops it.
      pickup: keptPickup(f.shipping, option, f.pickup),
    }));
    clearErrors((p) => p === 'shipping' || p === 'pickupPointId' || p === 'pickupPostalCode');
  };

  // Manual discounts are indexed by the server: any change clears their errors.
  const addDiscount = (input: ManualDiscountInput) => {
    setForm((f) => ({ ...f, manualDiscounts: [...(f.manualDiscounts ?? []), { ...input, key: mintUuid() }] }));
    clearErrors((p) => p.startsWith('manualDiscounts'));
  };

  const removeDiscount = (key: string) => {
    setForm((f) => ({ ...f, manualDiscounts: (f.manualDiscounts ?? []).filter((m) => m.key !== key) }));
    clearErrors((p) => p.startsWith('manualDiscounts'));
  };

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
      // A carrier answer (e.g. PICKUP_SEARCH_FAILED) has a code but no field.
      else toggleNotification({ type: 'danger', message: t(apiErrorMessageId(err, 'ecommerce.orders.new.error')) });
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

  const disabled = submitting || loadingDuplicate;
  const lineError = (index: number) =>
    translateCode(errors[`lines.${index}.quantity`] ?? errors[`lines.${index}.variantId`]);
  const discountError = (index: number) => translateCode(errors[`lines.${index}.discountPercent`]);

  // Promotions and discounts: the quote's promotions, the draft's manual discounts (their amounts
  // come from a quote of the current cart only) and the manual line discounts.
  const manualDiscounts = form.manualDiscounts ?? [];
  const quotedDiscounts = freshQuote?.manualDiscounts ?? null;
  const promotionLocales = { locale: form.locale, defaultLocale };
  const appliedRows = shownQuote
    ? promotionRows(
        shownQuote.promotions.map((p) => ({ ...p, redemptionStatus: null })),
        promotionLocales
      )
    : [];
  const lineDiscountRows = shownQuote ? manualLineDiscountRows(shownQuote.lines, uiLocale) : [];
  const percentText = (value: number) =>
    `${new Intl.NumberFormat(uiLocale, { maximumFractionDigits: 2 }).format(value)} %`;
  const manualRows = manualDiscounts.map((m, index) => {
    const quoted = quotedDiscounts?.[index];
    const amount = quoted ? quoted.amount : m.kind === 'FIXED' ? m.value : null;
    return {
      key: m.key,
      reason: m.reason,
      detail:
        m.kind === 'PERCENT'
          ? amount !== null
            ? `${percentText(m.value)} (${formatCents(amount, uiLocale)})`
            : percentText(m.value)
          : null,
      amount,
      error: translateCode(manualDiscountEntryError(errors, index)),
      action: (
        <Button size="S" variant="danger-light" disabled={disabled} onClick={() => removeDiscount(m.key)}>
          {t('ecommerce.orders.discounts.remove')}
        </Button>
      ),
    };
  });
  const hasDiscountRows = appliedRows.length + manualRows.length + lineDiscountRows.length > 0;
  const promotionName = (p: OrderQuote['promotions'][number]) =>
    promotionDisplayName(p, form.locale, defaultLocale) ?? t('ecommerce.orders.promotions.fallbackName');

  const tiles = createTotalsTiles(
    shownQuote?.totals ?? null,
    sumPreviewTotals(form.lines, selectedOption?.price ?? null),
    !!selectedOption
  );
  const tileLabel: Record<(typeof tiles)[number]['key'], string> = {
    products: 'ecommerce.orders.new.products',
    shipping: 'ecommerce.orders.detail.summary.shipping',
    discounts: 'ecommerce.orders.detail.summary.discounts',
    total: 'ecommerce.orders.totals.total',
  };
  const totalsNote = !canPrice
    ? null
    : pricing > 0
      ? { text: t('ecommerce.orders.quote.loading'), color: 'neutral500' }
      : pricingError
        ? { text: pricingError, color: 'danger600' }
        : !shownQuote
          ? { text: t('ecommerce.orders.totals.hint'), color: 'neutral500' }
          : shownQuote.totals.shippingTotal === null
            ? { text: t('ecommerce.orders.quote.awaitingShipping'), color: 'neutral500' }
            : null;

  const noticeTexts = [
    notices.droppedLines.length > 0 &&
      t('ecommerce.orders.new.duplicate.droppedLines', { names: notices.droppedLines.join(', ') }),
    notices.shipping && t(`ecommerce.orders.new.duplicate.${notices.shipping}`),
    notices.refusedCodes.length > 0 &&
      t('ecommerce.orders.new.duplicate.refusedCodes', { codes: notices.refusedCodes.join(', ') }),
    notices.missingGifts.length > 0 &&
      t('ecommerce.orders.new.duplicate.missingGifts', { names: notices.missingGifts.join(', ') }),
  ].filter((text): text is string => !!text);

  return (
    <Flex direction="column" alignItems="stretch" gap={6}>
      <Flex justifyContent="space-between" alignItems="center" gap={4}>
        <Flex gap={3} alignItems="center">
          {backButton}
          <Flex direction="column" alignItems="flex-start" gap={1}>
            <Typography variant="beta" tag="h1">
              {t('ecommerce.orders.new.title')}
            </Typography>
            {duplicate && (
              <Typography variant="pi" textColor="neutral600">
                {t('ecommerce.orders.new.duplicate.subtitle', { reference: duplicate.reference })}
              </Typography>
            )}
          </Flex>
        </Flex>
        <Button
          variant="secondary"
          onClick={submit}
          loading={submitting}
          disabled={permissionsLoading || loadingDuplicate}
        >
          {t('ecommerce.orders.create')}
        </Button>
      </Flex>

      {noticeTexts.length > 0 && (
        <Flex direction="column" alignItems="stretch" gap={3}>
          {noticeTexts.map((text) => (
            <NoticeBar key={text} text={text} wrap />
          ))}
        </Flex>
      )}

      <OrderSection title={t('ecommerce.orders.new.customer')}>
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
      </OrderSection>

      <OrderSection
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
      </OrderSection>

      <OrderSection title={t('ecommerce.orders.new.billingAddress')}>
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
      </OrderSection>

      <OrderSection title={t('ecommerce.orders.new.products')}>
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
          discountErrorFor={discountError}
          onQuantityChange={(index, quantity) =>
            updateLines((lines) => lines.map((l, i) => (i === index ? { ...l, quantity } : l)))
          }
          onDiscountChange={(index, discount) =>
            updateLines((lines) => lines.map((l, i) => (i === index ? { ...l, discount } : l)))
          }
          onRemove={(index) => updateLines((lines) => lines.filter((_, i) => i !== index))}
        />
      </OrderSection>

      <OrderSection
        title={t('ecommerce.orders.shipping.title')}
        actions={
          <Button size="S" variant="secondary" loading={quoting} disabled={disabled} onClick={getShippingOptions}>
            {t('ecommerce.orders.shipping.get')}
          </Button>
        }
      >
        <CreateShippingPanel
          quote={quote}
          selected={selectedOption}
          onSelect={selectShipping}
          error={translateCode(errors.shipping)}
          stores={stores}
          pickup={form.pickup ?? null}
          onPickup={(pickup) => {
            setForm((f) => ({ ...f, pickup }));
            clearErrors((p) => p === 'pickupPointId' || p === 'pickupPostalCode');
          }}
          postalCode={form.shippingAddress.postalCode}
          pickupError={pickupError(errors.pickupPointId ?? errors.pickupPostalCode, !!stores)}
          disabled={disabled}
        />
      </OrderSection>

      <OrderSection
        title={t('ecommerce.orders.detail.sections.promotions')}
        actions={
          <Button
            size="S"
            variant="secondary"
            disabled={disabled || manualDiscounts.length >= MAX_CREATE_MANUAL_DISCOUNTS}
            onClick={() => setAddingDiscount(true)}
          >
            {t('ecommerce.orders.discounts.add')}
          </Button>
        }
      >
        <PromotionCodesField
          codes={form.promotionCodes}
          onAddCode={addCode}
          onRemoveCode={removeCode}
          quote={shownQuote}
          disabled={disabled}
        />
        {hasDiscountRows ? (
          <DiscountsTable
            rows={appliedRows}
            manualRows={manualRows}
            lineRows={lineDiscountRows}
            total={shownQuote ? shownQuote.totals.totalDiscount : null}
            showActions={manualRows.length > 0}
          />
        ) : (
          <EmptyNote>{t('ecommerce.orders.new.promotionsEmpty')}</EmptyNote>
        )}
        {shownQuote && (
          <QuoteGifts
            quote={shownQuote}
            promotionName={promotionName}
            variantLabel={variantLabel}
            onGiftChoice={(promotionId, variantId) =>
              setGiftChoices((choices) => ({ ...choices, [promotionId]: variantId }))
            }
            disabled={disabled}
          />
        )}
      </OrderSection>

      <OrderSection title={t('ecommerce.orders.totals.title')}>
        <Tiles $columns={tiles.length}>
          {tiles.map((tile) => (
            <Tile key={tile.key}>
              <Typography variant="sigma" textColor="neutral600">
                {t(tileLabel[tile.key])}
              </Typography>
              <Typography variant="beta" tag="p" textColor="neutral800" style={{ whiteSpace: 'nowrap' }}>
                {tile.amount === null ? '—' : formatCents(tile.amount, uiLocale)}
              </Typography>
            </Tile>
          ))}
        </Tiles>
        {totalsNote && (
          <Typography variant="pi" textColor={totalsNote.color}>
            {totalsNote.text}
          </Typography>
        )}
      </OrderSection>

      {addingDiscount && (
        <CreateManualDiscountModal
          percentBase={shownQuote?.totals.subtotal ?? null}
          onClose={() => setAddingDiscount(false)}
          onAdd={addDiscount}
        />
      )}
    </Flex>
  );
};

export { OrderCreatePage };
