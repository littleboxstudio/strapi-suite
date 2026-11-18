import { useEffect, useMemo, useRef, useState } from 'react';
import { useIntl } from 'react-intl';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useNotification } from '@strapi/strapi/admin';
import { Button, Flex, IconButton, Typography } from '@strapi/design-system';
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
import FetchApplicablePromotions from '../../usecases/orders/fetchApplicablePromotions';
import VariantPicker from '../../components/orders/VariantPicker';
import OrderLinesEditor from '../../components/orders/OrderLinesEditor';
import OrderSection from '../../components/orders/OrderSection';
import NoticeBar from '../../components/orders/NoticeBar';
import QuoteGifts from '../../components/orders/QuoteGifts';
import TotalsBar from '../../components/orders/create/TotalsBar';
import CustomerSection from '../../components/orders/create/CustomerSection';
import AddressSection from '../../components/orders/create/AddressSection';
import ShippingSection from '../../components/orders/create/ShippingSection';
import CreatePromotionsSection from '../../components/orders/create/CreatePromotionsSection';
import SectionError from '../../components/orders/create/SectionError';
import { extractFieldErrors } from '../../utils/productForm';
import { mintUuid } from '../../utils/variantDraft';
import { formatCents } from '../../utils/money';
import { pickupErrorId } from '../../utils/pickupPoints';
import { useOrderPermissions } from '../../hooks/useOrderPermissions';
import {
  apiErrorCode,
  apiErrorMessageId,
  linePromotionNames,
  promotionDisplayName,
  promotionRows,
  type PromotionRow,
} from '../../utils/orderDetail';
import { manualLineDiscountRows } from '../../utils/orderEditing';
import {
  dropUnavailableLines,
  duplicateDraft,
  duplicateQuoteNotices,
  restoreDuplicateShipping,
  type ShippingRef,
} from '../../utils/duplicateOrder';
import {
  addPromotionCodes,
  applicablePromotionsInput,
  applyCustomerAddresses,
  hasAddress,
  isQuoteErrorPath,
  keptPromotionIds,
  sectionError,
  shippingLineFromOption,
  unappliedCodes,
} from '../../utils/createOrder';
import {
  addLine,
  buildCreateOrderInput,
  buildQuoteInput,
  copyAddress,
  createOrderConflict,
  createTotalsTiles,
  emptyAddressForm,
  emptyOrderForm,
  giftChoicesFromQuote,
  manualDiscountEntryError,
  MAX_CREATE_MANUAL_DISCOUNTS,
  pruneGiftChoices,
  refreshLinesFromQuote,
  shippingOptionsInput,
  sumPreviewTotals,
  toOrderErrorMap,
  validateOrderForm,
  type AddressForm,
  type DraftShippingLine,
  type OrderErrorMap,
  type OrderForm,
} from '../../utils/orderForm';
import type {
  FieldError,
  ManualDiscountInput,
  OrderLocales,
  OrderQuote,
  PickupSelection,
  ShippingQuote,
  VariantSearchResult,
} from '../../orderTypes';

/** Typing pause before the cart is priced again. */
const QUOTE_DELAY_MS = 400;

/**
 * A duplicated order being settled: `LINES` until the first quote (unavailable products are
 * dropped), `SHIPPING` while its method is restored, then `DONE`.
 */
type Duplicate = {
  reference: number;
  codes: string[];
  giftChoices: Record<number, number>;
  giftNames: Record<number, string>;
  promotionNames: Record<number, string>;
  shipping: ShippingRef | null;
  pickup: PickupSelection | null;
  phase: 'LINES' | 'SHIPPING' | 'DONE';
};

/** What a duplicate could not keep, shown as notices. */
type DuplicateNotices = {
  droppedLines: string[];
  refusedCodes: string[];
  missingGifts: string[];
  /** Pre-selected promotions the cart no longer gets. */
  droppedPromotions: string[];
  shipping: 'METHOD_GONE' | 'PICKUP_GONE' | null;
  /** Products whose lines had different percents (only the first percent's units were copied). */
  discountConflicts: string[];
};

const NO_NOTICES: DuplicateNotices = {
  droppedLines: [],
  refusedCodes: [],
  missingGifts: [],
  droppedPromotions: [],
  shipping: null,
  discountConflicts: [],
};

const EMPTY_CUSTOMER: OrderForm['customer'] = { firstName: '', lastName: '', email: '', phone: '' };

const positiveId = (raw: string | null) => {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/**
 * Create order (spec 2026-11-18-create-order-redesign-design): the totals stay at the top, and
 * each section is a table filled through modals, like the order detail.
 */
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
  // Latest form and duplicate, read by the async handlers.
  const formRef = useRef(form);
  formRef.current = form;
  const duplicateRef = useRef(duplicate);
  duplicateRef.current = duplicate;

  const clearErrors = (match: (path: string) => boolean) =>
    setErrors((map) => {
      const keys = Object.keys(map).filter(match);
      if (!keys.length) return map;
      const next = { ...map };
      keys.forEach((k) => delete next[k]);
      return next;
    });
  const under = (prefix: string) => (p: string) => p === prefix || p.startsWith(`${prefix}.`);

  // The last addresses request in flight: a newer customer (or none) makes an older answer void.
  const addressRequest = useRef(0);
  const cancelAddressFill = () => {
    addressRequest.current += 1;
  };

  /** An existing customer was chosen: their last addresses fill the address tables. */
  const fillLastAddresses = async (id: number) => {
    const request = ++addressRequest.current;
    try {
      const last = await new FetchCustomerLastAddresses().execute(id);
      if (request !== addressRequest.current) return;
      setForm((f) => applyCustomerAddresses(f, last));
      clearErrors((p) => under('shippingAddress')(p) || under('billingAddress')(p));
    } catch {
      if (request !== addressRequest.current) return;
      toggleNotification({ type: 'warning', message: t('ecommerce.orders.new.lastAddressesError') });
    }
  };

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

  // The customer page's New order: that customer, with their last addresses.
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
        fillLastAddresses(customerId);
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
        setNotices({ ...NO_NOTICES, discountConflicts: draft.discountConflicts });
        setDuplicate({
          reference: order.reference,
          codes: draft.form.promotionCodes,
          giftChoices: draft.giftChoices,
          giftNames: draft.giftNames,
          promotionNames: draft.promotionNames,
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
      // The manual discounts, shipping lines and promotions were accepted.
      clearErrors(isQuoteErrorPath);
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
        // A manual discount's, shipping line's or promotion's error is shown on its row or section.
        const owned = fieldErrors.filter((e) => isQuoteErrorPath(e.path));
        if (owned.length) {
          setErrors((map) => {
            const kept = Object.fromEntries(Object.entries(map).filter(([k]) => !isQuoteErrorPath(k)));
            return { ...kept, ...toOrderErrorMap(owned, false) };
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
    clearErrors(under('lines'));
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
  const freshQuoteRef = useRef(freshQuote);
  freshQuoteRef.current = freshQuote;
  const pricedRef = useRef<OrderQuote | null>(null);
  pricedRef.current = priced?.quote ?? null;

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

  const translateCode = (code: string | undefined) =>
    code
      ? formatMessage({
          id: getTranslation(`ecommerce.orders.errors.${code}`),
          defaultMessage: t('ecommerce.orders.errors.invalid'),
        })
      : undefined;
  const codeText = (code: string) => translateCode(code) as string;

  /** A pickup picker's error, worded for a store with Store pickup. */
  const pickupErrorText = (code: string, store: boolean) =>
    formatMessage({
      id: getTranslation(pickupErrorId(code, store)),
      defaultMessage: t('ecommerce.orders.errors.invalid'),
    });

  const updateLines = (fn: (lines: OrderForm['lines']) => OrderForm['lines']) => {
    setForm((f) => ({ ...f, lines: fn(f.lines) }));
    // Line errors are keyed by index, which a change may shift.
    clearErrors(under('lines'));
  };

  const addVariant = (v: VariantSearchResult) => updateLines((lines) => addLine(lines, v));

  // --- Customer and addresses ---------------------------------------------------------------

  const saveCustomer = (customer: OrderForm['customer'], pickedId: number | null) => {
    setForm((f) => ({ ...f, customer }));
    clearErrors(under('customer'));
    if (pickedId) fillLastAddresses(pickedId);
    else cancelAddressFill();
  };

  const saveAddress = (which: 'shippingAddress' | 'billingAddress', address: AddressForm) => {
    setForm((f) => ({ ...f, [which]: address, billingSameAsShipping: false }));
    clearErrors(under(which));
  };

  const removeAddress = (which: 'shippingAddress' | 'billingAddress') => {
    setForm((f) => ({ ...f, [which]: emptyAddressForm(), billingSameAsShipping: false }));
    clearErrors(under(which));
  };

  /** Billing same as shipping: a copy in the billing table (company and NIF kept), editable. */
  const copyShippingToBilling = () => {
    setForm((f) => ({
      ...f,
      billingAddress: copyAddress(f.shippingAddress, f.billingAddress),
      billingSameAsShipping: false,
    }));
    clearErrors(under('billingAddress'));
  };

  // --- Shipping ------------------------------------------------------------------------------

  const canQuoteShipping = () => {
    if (!formRef.current.shippingAddress.country || !formRef.current.lines.length) {
      toggleNotification({ type: 'warning', message: t('ecommerce.orders.shipping.needInput') });
      return false;
    }
    return true;
  };

  /** The methods quoted for the cart as the order quote prices it (gifts included). */
  const loadShippingOptions = (): Promise<ShippingQuote> =>
    new QuoteOrderShipping().execute(shippingOptionsInput(formRef.current, freshQuoteRef.current));

  const clearShippingErrors = () => clearErrors((p) => under('shippingLines')(p) || under('destination')(p));

  const saveShippingLine = (line: Omit<DraftShippingLine, 'key'>, index: number | null) => {
    setForm((f) => ({
      ...f,
      shippingLines:
        index === null
          ? [...f.shippingLines, { ...line, key: mintUuid() }]
          : f.shippingLines.map((l, i) => (i === index ? { ...line, key: l.key } : l)),
    }));
    clearShippingErrors();
  };

  const removeShippingLine = (index: number) => {
    // The next line becomes the delivery method.
    setForm((f) => ({ ...f, shippingLines: f.shippingLines.filter((_, i) => i !== index) }));
    clearShippingErrors();
  };

  /** A duplicate's DPD point is kept only when a search of its postal code still finds it. */
  const checkDuplicatePoint = async (pickup: PickupSelection) => {
    try {
      const found = (await new SearchPickupPoints().execute(pickup.postalCode)).find((p) => p.id === pickup.point.id);
      setForm((f) => {
        const first = f.shippingLines[0];
        if (first?.pickup?.point.id !== pickup.point.id) return f;
        const kept = found ? { point: found, postalCode: pickup.postalCode } : null;
        return { ...f, shippingLines: [{ ...first, pickup: kept }, ...f.shippingLines.slice(1)] };
      });
      if (!found) setNotices((n) => ({ ...n, shipping: 'PICKUP_GONE' }));
    } catch {
      // The search failed: the point stays, and creating the order confirms it.
    }
  };

  /**
   * A duplicate's pre-selected promotions: only those the cart still gets stay selected; the others
   * are named in a notice. A failed check keeps them (the quote reports what it rejects).
   */
  const checkDuplicatePromotions = async (dup: Duplicate, shippingLines: DraftShippingLine[]) => {
    const f = formRef.current;
    if (!f.promotionIds.length || !f.lines.length) return;
    try {
      const { promotions } = await new FetchApplicablePromotions().execute(
        applicablePromotionsInput({ ...f, shippingLines }, giftChoices)
      );
      const { dropped } = keptPromotionIds(f.promotionIds, promotions);
      if (!dropped.length) return;
      setForm((cur) => ({ ...cur, promotionIds: cur.promotionIds.filter((id) => !dropped.includes(id)) }));
      setNotices((n) => ({ ...n, droppedPromotions: dropped.map((id) => dup.promotionNames[id] ?? `#${id}`) }));
    } catch {
      // Kept: the quote names a selected promotion it no longer applies.
    }
  };

  // A duplicate's shipping: once its products are settled, quote the options as the order (its
  // gifts included) and restore its method as the first line at today's price for it; then check
  // its pre-selected promotions.
  useEffect(() => {
    const dup = duplicate;
    if (dup?.phase !== 'SHIPPING') return;
    setDuplicatePhase('DONE');
    if (!form.shippingAddress.country || !form.lines.length) {
      checkDuplicatePromotions(dup, formRef.current.shippingLines);
      return;
    }
    (async () => {
      let restoredLines = formRef.current.shippingLines;
      try {
        // A quote of the current cart: its gift lines weigh in the price (a pruned gift choice
        // makes the earlier one stale, and the cart lines alone would price without the gifts).
        const quote = freshQuoteRef.current ?? (await runPriceQuote()).quote ?? pricedRef.current;
        const result = await new QuoteOrderShipping().execute(shippingOptionsInput(formRef.current, quote));
        const restored = restoreDuplicateShipping(dup.shipping, dup.pickup, result.options);
        const option = restored.shipping
          ? result.options.find(
              (o) => o.providerId === restored.shipping?.providerId && o.serviceId === restored.shipping?.serviceId
            )
          : undefined;
        if (option && !restoredLines.length) {
          const line = shippingLineFromOption(option, option.price, restored.pickup, mintUuid());
          restoredLines = [line];
          setForm((f) => (f.shippingLines.length ? f : { ...f, shippingLines: [line] }));
        }
        if (restored.notice) setNotices((n) => ({ ...n, shipping: restored.notice }));
        if (restored.checkPoint && restored.pickup) checkDuplicatePoint(restored.pickup);
      } catch {
        toggleNotification({ type: 'danger', message: t('ecommerce.orders.shipping.error') });
      }
      await checkDuplicatePromotions(dup, restoredLines);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duplicate?.phase]);

  // --- Promotions and discounts ----------------------------------------------------------------

  // Manual discounts are indexed by the server: any change clears their errors.
  const addDiscount = (input: ManualDiscountInput) => {
    setForm((f) => ({ ...f, manualDiscounts: [...(f.manualDiscounts ?? []), { ...input, key: mintUuid() }] }));
    clearErrors(under('manualDiscounts'));
  };

  const removeDiscount = (key: string) => {
    setForm((f) => ({ ...f, manualDiscounts: (f.manualDiscounts ?? []).filter((m) => m.key !== key) }));
    clearErrors(under('manualDiscounts'));
  };

  const applyPromotionIds = (ids: number[]) => {
    setForm((f) => ({ ...f, promotionIds: ids }));
    clearErrors(under('promotionIds'));
  };

  const addCodes = (picked: string[]) => {
    const result = addPromotionCodes(formRef.current.promotionCodes, picked);
    setForm((f) => ({ ...f, promotionCodes: result.codes }));
    clearErrors(under('promotionCodes'));
    if (result.refused.length) {
      toggleNotification({
        type: 'warning',
        message: result.refused
          .map((r) => `${r.code}: ${t(`ecommerce.orders.quote.codeErrors.${r.error}`)}`)
          .join(' '),
      });
    }
  };

  const removeCode = (code: string) => {
    setForm((f) => ({ ...f, promotionCodes: f.promotionCodes.filter((c) => c !== code) }));
    clearErrors(under('promotionCodes'));
  };

  const removePromotion = (row: PromotionRow) => {
    if (row.code) removeCode(row.code);
    else applyPromotionIds(formRef.current.promotionIds.filter((id) => id !== row.promotionId));
  };

  // --- Create --------------------------------------------------------------------------------

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
        const result = await runPriceQuote();
        if (!result.quote) {
          // Never create without a confirmed total: show why the cart could not be priced.
          const fieldErrors = extractFieldErrors(result.cause);
          if (fieldErrors?.length) showErrors(fieldErrors);
          else
            toggleNotification({
              type: 'danger',
              message: result.error ?? t('ecommerce.orders.quote.error'),
            });
          return;
        }
        quote = result.quote;
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
  const promotionLocales = { locale: form.locale, defaultLocale };

  // Products: the quote's gift lines follow the cart's, named by the promotions that gave them.
  const giftLines = shownQuote?.lines.filter((l) => l.isGift) ?? [];
  const giftLabel = (line: OrderQuote['lines'][number]) => {
    const names = linePromotionNames(
      line.refs.map((r) => r.promotionId),
      shownQuote?.promotions ?? [],
      promotionLocales
    );
    return names.length ? names.join(', ') : null;
  };

  // Promotions and discounts: the quote's promotions, the draft's manual discounts (their amounts
  // come from a quote of the current cart only) and the manual line discounts.
  const manualDiscounts = form.manualDiscounts ?? [];
  const quotedDiscounts = freshQuote?.manualDiscounts ?? null;
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
  const promotionsError =
    translateCode(errors.manualDiscounts) ??
    translateCode((sectionError(errors, 'promotionIds') ?? sectionError(errors, 'promotionCodes'))?.code);
  const promotionName = (p: OrderQuote['promotions'][number]) =>
    promotionDisplayName(p, form.locale, defaultLocale) ?? t('ecommerce.orders.promotions.fallbackName');

  // Shipping: the section's own errors (none chosen, the destination); a line's sit on its row.
  const shippingError = translateCode(
    errors.shippingLines ?? sectionError(errors, 'destination')?.code ?? errors.shipping
  );

  // Outdated (being priced again, or the last quote failed): the amounts are unknown until a quote
  // of the current cart, so the tiles and the discounts total never disagree with each other.
  const stale = !!shownQuote && !freshQuote;
  const shippingSum = form.shippingLines.reduce((sum, l) => sum + l.amount, 0);
  const tiles = createTotalsTiles(
    freshQuote?.totals ?? null,
    stale ? null : sumPreviewTotals(form.lines, shippingSum),
    form.shippingLines.length > 0
  );
  const totalsNote = !canPrice
    ? null
    : pricing > 0
      ? { text: t('ecommerce.orders.quote.loading'), color: 'neutral500' }
      : pricingError
        ? { text: pricingError, color: 'danger600' }
        : stale
          ? { text: t('ecommerce.orders.quote.loading'), color: 'neutral500' }
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
    notices.droppedPromotions.length > 0 &&
      t('ecommerce.orders.new.duplicate.droppedPromotions', { names: notices.droppedPromotions.join(', ') }),
    notices.missingGifts.length > 0 &&
      t('ecommerce.orders.new.duplicate.missingGifts', { names: notices.missingGifts.join(', ') }),
    notices.discountConflicts.length > 0 &&
      t('ecommerce.orders.new.duplicate.discountConflicts', { names: notices.discountConflicts.join(', ') }),
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

      <TotalsBar tiles={tiles} note={totalsNote} />

      <CustomerSection
        customer={form.customer}
        locale={form.locale}
        locales={locales}
        errors={errors}
        codeText={codeText}
        disabled={disabled}
        onSave={saveCustomer}
        onRemove={() => {
          cancelAddressFill();
          setForm((f) => ({ ...f, customer: EMPTY_CUSTOMER }));
          clearErrors(under('customer'));
        }}
        onLocale={(locale) => {
          setForm((f) => ({ ...f, locale }));
          clearErrors((p) => p === 'locale');
        }}
      />

      <AddressSection
        name="shippingAddress"
        title={t('ecommerce.orders.new.shippingAddress')}
        addLabel={t('ecommerce.orders.new.shippingAddressAdd')}
        value={form.shippingAddress}
        errors={errors}
        codeText={codeText}
        disabled={disabled}
        onSave={(address) => saveAddress('shippingAddress', address)}
        onRemove={() => removeAddress('shippingAddress')}
      />

      <AddressSection
        name="billingAddress"
        title={t('ecommerce.orders.new.billingAddress')}
        addLabel={t('ecommerce.orders.new.billingAddressAdd')}
        value={form.billingAddress}
        errors={errors}
        codeText={codeText}
        disabled={disabled}
        onSave={(address) => saveAddress('billingAddress', address)}
        onRemove={() => removeAddress('billingAddress')}
        extraActions={
          <Button
            size="S"
            variant="tertiary"
            disabled={disabled || !hasAddress(form.shippingAddress)}
            onClick={copyShippingToBilling}
          >
            {t('ecommerce.orders.new.billingSame')}
          </Button>
        }
      />

      <OrderSection title={t('ecommerce.orders.new.products')}>
        <SectionError text={translateCode(errors.lines)} />
        <VariantPicker locale={form.locale || undefined} onAdd={addVariant} disabled={disabled} showLabel={false} />
        <OrderLinesEditor
          lines={form.lines}
          gifts={giftLines}
          giftLabel={giftLabel}
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

      <ShippingSection
        lines={form.shippingLines}
        errors={errors}
        error={shippingError}
        codeText={codeText}
        pickupErrorText={pickupErrorText}
        loadOptions={loadShippingOptions}
        canQuote={canQuoteShipping}
        postalCode={form.shippingAddress.postalCode}
        disabled={disabled}
        onSave={saveShippingLine}
        onRemove={removeShippingLine}
      />

      <CreatePromotionsSection
        rows={appliedRows}
        manualRows={manualRows}
        lineRows={lineDiscountRows}
        total={freshQuote ? freshQuote.totals.totalDiscount : null}
        staleNote={
          stale
            ? {
                text: pricingError ?? t('ecommerce.orders.quote.loading'),
                color: pricingError ? 'danger600' : 'neutral500',
              }
            : null
        }
        error={promotionsError}
        unapplied={unappliedCodes(form.promotionCodes, shownQuote)}
        codes={form.promotionCodes}
        selectedIds={form.promotionIds}
        known={shownQuote?.promotions ?? []}
        locales={promotionLocales}
        disabled={disabled}
        canAddDiscount={manualDiscounts.length < MAX_CREATE_MANUAL_DISCOUNTS}
        canApply={canPrice}
        percentBase={shownQuote?.totals.subtotal ?? null}
        applicableInput={() => applicablePromotionsInput(formRef.current, giftChoices)}
        onAddDiscount={addDiscount}
        onApplyIds={applyPromotionIds}
        onAddCodes={addCodes}
        onRemovePromotion={removePromotion}
        onRemoveCode={removeCode}
      />
    </Flex>
  );
};

export { OrderCreatePage };
