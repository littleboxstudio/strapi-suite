import { type ReactNode, useState } from 'react';
import { useIntl } from 'react-intl';
import {
  Badge,
  Box,
  Button,
  Divider,
  Field,
  Flex,
  SingleSelect,
  SingleSelectOption,
  Tag,
  TextInput,
  Typography,
} from '@strapi/design-system';
import { Cross } from '@strapi/icons';
import { getTranslation } from '../../../core/utils/getTranslation';
import { formatCents } from '../../utils/money';
import { codeStatusBadgeVariant, promotionDisplayName } from '../../utils/orderDetail';
import { giftSelectors, type PromotionCodeError } from '../../utils/orderForm';
import { MAX_PROMOTION_CODES, type OrderQuote } from '../../orderTypes';
import OrderSection from './OrderSection';

type Props = {
  codes: string[];
  /** Adds a typed code; returns why it was refused, or null. */
  onAddCode: (raw: string) => PromotionCodeError | null;
  onRemoveCode: (code: string) => void;
  /** The last quote (it may be stale while `loading`). */
  quote: OrderQuote | null;
  loading: boolean;
  /** Translated reason the last quote failed. */
  error: string | null;
  /** The order's locale, then the store default: promotion display names. */
  locale: string;
  defaultLocale?: string | null;
  /** Labels of gift variants (`#<id>` when unknown). */
  variantLabel: (variantId: number) => string;
  onGiftChoice: (promotionId: number, variantId: number) => void;
  disabled?: boolean;
  /** Shown in the totals card while there is no quote (the local preview). */
  fallbackTotals: ReactNode;
};

/**
 * Promotion codes, the promotions and gifts the server's quote applied, and its totals
 * (`POST orders/quote`). The quote is computed by the server; nothing here is priced locally.
 */
const OrderQuotePanel = ({
  codes,
  onAddCode,
  onRemoveCode,
  quote,
  loading,
  error,
  locale,
  defaultLocale,
  variantLabel,
  onGiftChoice,
  disabled,
  fallbackTotals,
}: Props) => {
  const { formatMessage, locale: uiLocale } = useIntl();
  const t = (id: string, values?: Record<string, any>) =>
    formatMessage({ id: getTranslation(id) }, values);
  const money = (cents: number) => formatCents(cents, uiLocale);
  const discount = (cents: number) => money(cents ? -cents : 0);

  const [input, setInput] = useState('');
  const [codeError, setCodeError] = useState<PromotionCodeError | null>(null);

  const apply = () => {
    const refused = onAddCode(input);
    setCodeError(refused);
    if (!refused) setInput('');
  };

  const statusOf = (code: string) => quote?.codes.find((c) => c.code === code)?.status ?? null;
  // Same chain as the order page: order locale → default locale → neutral label.
  const promotionName = (p: OrderQuote['promotions'][number]) =>
    promotionDisplayName(p, locale, defaultLocale) ?? t('ecommerce.orders.promotions.fallbackName');
  const selectors = quote ? giftSelectors(quote) : [];
  const gifts = quote ? quote.lines.filter((l) => l.isGift) : [];

  const row = (label: string, value: string, strong = false) => (
    <Flex justifyContent="space-between" gap={4}>
      <Typography
        textColor={strong ? 'neutral800' : 'neutral600'}
        fontWeight={strong ? 'bold' : undefined}
      >
        {label}
      </Typography>
      <Typography
        textColor="neutral800"
        fontWeight={strong ? 'bold' : undefined}
        style={{ whiteSpace: 'nowrap' }}
      >
        {value}
      </Typography>
    </Flex>
  );

  const totals = quote?.totals;
  const summary = (key: string) => t(`ecommerce.orders.detail.summary.${key}`);

  return (
    <Flex direction="column" alignItems="stretch" gap={6}>
      <OrderSection title={t('ecommerce.orders.quote.title')}>
        <Flex direction="column" alignItems="stretch" gap={4}>
          <Flex direction="column" alignItems="stretch" gap={1}>
            <Flex gap={2} alignItems="flex-end">
              <Box flex="1">
                <Field.Root name="promotionCodes" error={codeError ? ' ' : undefined}>
                  <Field.Label>{t('ecommerce.orders.quote.codes')}</Field.Label>
                  <TextInput
                    value={input}
                    disabled={disabled || codes.length >= MAX_PROMOTION_CODES}
                    onChange={(e: any) => {
                      setInput(e.target.value);
                      setCodeError(null);
                    }}
                    onKeyDown={(e: any) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        apply();
                      }
                    }}
                  />
                </Field.Root>
              </Box>
              <Button
                variant="secondary"
                size="L"
                disabled={disabled || codes.length >= MAX_PROMOTION_CODES}
                onClick={apply}
              >
                {t('ecommerce.orders.quote.apply')}
              </Button>
            </Flex>
            <Typography
              variant="pi"
              textColor={codeError ? 'danger600' : 'neutral600'}
              role={codeError ? 'alert' : undefined}
            >
              {codeError
                ? t(`ecommerce.orders.quote.codeErrors.${codeError}`)
                : t('ecommerce.orders.quote.codesHint')}
            </Typography>
          </Flex>

          {codes.length > 0 && (
            <Flex direction="column" alignItems="stretch" gap={2}>
              {codes.map((code) => {
                const status = statusOf(code);
                return (
                  <Flex key={code} gap={2} alignItems="center" wrap="wrap">
                    <Tag
                      icon={<Cross aria-hidden />}
                      label={t('ecommerce.orders.quote.removeCode', { code })}
                      disabled={disabled}
                      onClick={() => onRemoveCode(code)}
                    >
                      {code}
                    </Tag>
                    {status && (
                      <Badge size="S" variant={codeStatusBadgeVariant(status)}>
                        {t(`ecommerce.orders.promotions.codeStatus.${status}`)}
                      </Badge>
                    )}
                  </Flex>
                );
              })}
            </Flex>
          )}

          {loading && (
            <Typography variant="pi" textColor="neutral500">
              {t('ecommerce.orders.quote.loading')}
            </Typography>
          )}
          {error && (
            <Typography variant="pi" textColor="danger600">
              {error}
            </Typography>
          )}

          {quote && (
            <Flex direction="column" alignItems="stretch" gap={2}>
              <Typography variant="sigma" textColor="neutral600">
                {t('ecommerce.orders.quote.applied')}
              </Typography>
              {quote.promotions.length === 0 ? (
                <Typography variant="pi" textColor="neutral600">
                  {t('ecommerce.orders.quote.noPromotions')}
                </Typography>
              ) : (
                quote.promotions.map((p) => (
                  <Flex key={p.promotionId} justifyContent="space-between" gap={4}>
                    <Flex direction="column" alignItems="flex-start">
                      <Typography textColor="neutral800">{promotionName(p)}</Typography>
                      {p.code && (
                        <Typography variant="pi" textColor="neutral600">
                          {p.code}
                        </Typography>
                      )}
                    </Flex>
                    <Typography textColor="neutral800" style={{ whiteSpace: 'nowrap' }}>
                      {discount(p.amount)}
                    </Typography>
                  </Flex>
                ))
              )}
              {gifts.map((g) => (
                <Flex key={`gift-${g.variantId}`} gap={2} alignItems="center">
                  <Badge size="S" variant="success">
                    {t('ecommerce.orders.quote.gift')}
                  </Badge>
                  <Typography variant="pi" textColor="neutral800">
                    {g.quantity} × {g.name}
                    {g.option ? ` (${g.option})` : ''}
                  </Typography>
                </Flex>
              ))}
              {selectors.map((s) => {
                const promotion = quote.promotions.find((p) => p.promotionId === s.promotionId);
                return (
                  <Field.Root
                    key={`${s.promotionId}:${s.benefitIndex}`}
                    name={`giftChoices.${s.promotionId}.${s.benefitIndex}`}
                  >
                    <Field.Label>
                      {t('ecommerce.orders.quote.giftChoice', {
                        name: promotion ? promotionName(promotion) : '',
                      })}
                    </Field.Label>
                    <SingleSelect
                      value={s.selected !== null ? String(s.selected) : null}
                      disabled={disabled}
                      onChange={(value: string | number) =>
                        onGiftChoice(s.promotionId, Number(value))
                      }
                    >
                      {s.variants.map((v) => (
                        // The engine skips an unavailable gift (inactive or short of stock).
                        <SingleSelectOption
                          key={v.variantId}
                          value={String(v.variantId)}
                          disabled={!v.available}
                        >
                          {v.available
                            ? variantLabel(v.variantId)
                            : t('ecommerce.orders.quote.giftUnavailable', { name: variantLabel(v.variantId) })}
                        </SingleSelectOption>
                      ))}
                    </SingleSelect>
                  </Field.Root>
                );
              })}
              {!quote.exhaustive && (
                <Typography variant="pi" textColor="neutral500">
                  {t('ecommerce.orders.quote.nonExhaustive')}
                </Typography>
              )}
            </Flex>
          )}
        </Flex>
      </OrderSection>

      <OrderSection title={t('ecommerce.orders.totals.title')}>
        {totals ? (
          <Flex direction="column" alignItems="stretch" gap={3}>
            {row(summary('itemsOriginal'), money(totals.itemsOriginal))}
            {totals.productDiscount > 0 &&
              row(summary('productDiscount'), discount(totals.productDiscount))}
            {totals.orderDiscount > 0 &&
              row(summary('orderDiscount'), discount(totals.orderDiscount))}
            {row(summary('subtotal'), money(totals.subtotal - totals.orderDiscount))}
            {row(
              summary('shippingOriginal'),
              totals.shippingOriginal === null ? '—' : money(totals.shippingOriginal)
            )}
            {totals.shippingDiscount > 0 &&
              row(summary('shippingDiscount'), discount(totals.shippingDiscount))}
            {totals.totalDiscount > 0 &&
              row(summary('totalDiscount'), discount(totals.totalDiscount))}
            <Divider />
            {row(summary('total'), money(totals.total), true)}
            {totals.shippingTotal === null && (
              <Typography variant="pi" textColor="neutral500">
                {t('ecommerce.orders.quote.awaitingShipping')}
              </Typography>
            )}
          </Flex>
        ) : (
          fallbackTotals
        )}
      </OrderSection>
    </Flex>
  );
};

export default OrderQuotePanel;
