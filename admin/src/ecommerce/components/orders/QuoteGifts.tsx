import { useIntl } from 'react-intl';
import { Field, Flex, SingleSelect, SingleSelectOption, Typography } from '@strapi/design-system';
import { getTranslation } from '../../../core/utils/getTranslation';
import { giftSelectors } from '../../utils/orderForm';
import type { OrderQuote } from '../../orderTypes';

type Props = {
  quote: OrderQuote;
  /** A promotion's display name. */
  promotionName: (promotion: OrderQuote['promotions'][number]) => string;
  /** Labels of gift variants (`#<id>` when unknown). */
  variantLabel: (variantId: number) => string;
  onGiftChoice: (promotionId: number, variantId: number) => void;
  disabled?: boolean;
};

/**
 * For a promotion offering several gifts, the choice of variant (the gift lines themselves are in
 * the products table).
 */
const QuoteGifts = ({ quote, promotionName, variantLabel, onGiftChoice, disabled }: Props) => {
  const { formatMessage } = useIntl();
  const t = (id: string, values?: Record<string, any>) =>
    formatMessage({ id: getTranslation(id) }, values);
  const selectors = giftSelectors(quote);
  if (!selectors.length && quote.exhaustive) return null;

  return (
    <Flex direction="column" alignItems="stretch" gap={2}>
      {selectors.map((s) => {
        const promotion = quote.promotions.find((p) => p.promotionId === s.promotionId);
        return (
          <Field.Root key={`${s.promotionId}:${s.benefitIndex}`} name={`giftChoices.${s.promotionId}.${s.benefitIndex}`}>
            <Field.Label>
              {t('ecommerce.orders.quote.giftChoice', { name: promotion ? promotionName(promotion) : '' })}
            </Field.Label>
            <SingleSelect
              value={s.selected !== null ? String(s.selected) : null}
              disabled={disabled}
              onChange={(value: string | number) => onGiftChoice(s.promotionId, Number(value))}
            >
              {s.variants.map((v) => (
                // The engine skips an unavailable gift (inactive or short of stock).
                <SingleSelectOption key={v.variantId} value={String(v.variantId)} disabled={!v.available}>
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
  );
};

export default QuoteGifts;
