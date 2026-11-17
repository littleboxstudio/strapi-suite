import { useState } from 'react';
import { useIntl } from 'react-intl';
import { Box, Button, Field, Flex, Tag, TextInput, Typography } from '@strapi/design-system';
import { Cross } from '@strapi/icons';
import { getTranslation } from '../../../core/utils/getTranslation';
import { codeStatusBadgeVariant } from '../../utils/orderDetail';
import type { PromotionCodeError } from '../../utils/orderForm';
import { MAX_PROMOTION_CODES, type OrderQuote } from '../../orderTypes';
import { ToneBadge } from './StatusBadges';

type Props = {
  codes: string[];
  /** Adds a typed code; returns why it was refused, or null. */
  onAddCode: (raw: string) => PromotionCodeError | null;
  onRemoveCode: (code: string) => void;
  /** The last quote: each code's status. */
  quote: OrderQuote | null;
  disabled?: boolean;
};

/** Create order's promotion codes: the input, then each code as a tag with the quote's status. */
const PromotionCodesField = ({ codes, onAddCode, onRemoveCode, quote, disabled }: Props) => {
  const { formatMessage } = useIntl();
  const t = (id: string, values?: Record<string, any>) =>
    formatMessage({ id: getTranslation(id) }, values);
  const [input, setInput] = useState('');
  const [codeError, setCodeError] = useState<PromotionCodeError | null>(null);
  const full = codes.length >= MAX_PROMOTION_CODES;

  const apply = () => {
    const refused = onAddCode(input);
    setCodeError(refused);
    if (!refused) setInput('');
  };

  const statusOf = (code: string) => quote?.codes.find((c) => c.code === code)?.status ?? null;

  return (
    <Flex direction="column" alignItems="stretch" gap={3}>
      <Flex direction="column" alignItems="stretch" gap={1}>
        <Flex gap={2} alignItems="flex-end">
          <Box flex="1">
            <Field.Root name="promotionCodes" error={codeError ? ' ' : undefined}>
              <Field.Label>{t('ecommerce.orders.quote.codes')}</Field.Label>
              <TextInput
                value={input}
                disabled={disabled || full}
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
          <Button variant="secondary" size="L" disabled={disabled || full} onClick={apply}>
            {t('ecommerce.orders.quote.apply')}
          </Button>
        </Flex>
        <Typography
          variant="pi"
          textColor={codeError ? 'danger600' : 'neutral600'}
          role={codeError ? 'alert' : undefined}
        >
          {codeError ? t(`ecommerce.orders.quote.codeErrors.${codeError}`) : t('ecommerce.orders.quote.codesHint')}
        </Typography>
      </Flex>

      {codes.length > 0 && (
        <Flex gap={3} alignItems="center" wrap="wrap">
          {codes.map((code) => {
            const status = statusOf(code);
            return (
              <Flex key={code} gap={2} alignItems="center">
                <Tag
                  icon={<Cross aria-hidden />}
                  label={t('ecommerce.orders.quote.removeCode', { code })}
                  disabled={disabled}
                  onClick={() => onRemoveCode(code)}
                >
                  {code}
                </Tag>
                {status && (
                  <ToneBadge variant={codeStatusBadgeVariant(status)}>
                    {t(`ecommerce.orders.promotions.codeStatus.${status}`)}
                  </ToneBadge>
                )}
              </Flex>
            );
          })}
        </Flex>
      )}
    </Flex>
  );
};

export default PromotionCodesField;
