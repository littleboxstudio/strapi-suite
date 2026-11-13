import { useIntl } from 'react-intl';
import { Badge, Flex, Table, Tbody, Td, Th, Thead, Tr, Typography } from '@strapi/design-system';
import { getTranslation } from '../../../core/utils/getTranslation';
import EmptyNote from './EmptyNote';
import { formatCents } from '../../utils/money';
import {
  codeStatusBadgeVariant,
  promotionRows,
  promotionsDiscountTotal,
  unappliedPromotionCodes,
  type PromotionLocales,
} from '../../utils/orderDetail';
import { describeBenefit } from '../../utils/promotionForm';
import type { OrderPromotion, OrderPromotionCode } from '../../orderTypes';
import OrderSection from './OrderSection';

const COLUMNS = ['promotion', 'method', 'type', 'benefit', 'amount'] as const;

type Props = {
  title: string;
  promotions: OrderPromotion[];
  /** Codes entered at checkout with their status; the ones that did not apply are listed. */
  promotionCodes?: OrderPromotionCode[];
  locales: PromotionLocales;
};

/**
 * The promotions the order recorded (promotions requirements 3.2, 3.7 and 3.8): one row per benefit,
 * read from the stored snapshot only; a cancelled order shows its redemptions as released.
 */
const PromotionsSection = ({ title, promotions, promotionCodes, locales }: Props) => {
  const { formatMessage, locale: uiLocale } = useIntl();
  const t = (id: string, values?: Record<string, any>) =>
    formatMessage({ id: getTranslation(id) }, values);
  const money = (cents: number) => formatCents(cents, uiLocale);
  const discount = (cents: number) => money(cents ? -cents : 0);
  const rows = promotionRows(promotions, locales);
  const unapplied = unappliedPromotionCodes(promotionCodes);

  const enteredCodes = unapplied.length > 0 && (
    <Flex direction="column" alignItems="stretch" gap={2}>
      <Typography variant="sigma" textColor="neutral600">
        {t('ecommerce.orders.promotions.enteredCodes')}
      </Typography>
      {unapplied.map((c) => (
        <Flex key={c.code} gap={2} alignItems="center" wrap="wrap">
          <Typography textColor="neutral800" fontWeight="semiBold">
            {c.code}
          </Typography>
          <Badge size="S" variant={codeStatusBadgeVariant(c.status)}>
            {formatMessage({
              id: getTranslation(`ecommerce.orders.promotions.codeStatus.${c.status}`),
              defaultMessage: c.status,
            })}
          </Badge>
        </Flex>
      ))}
    </Flex>
  );

  return (
    <OrderSection title={title}>
      {rows.length === 0 && !enteredCodes ? (
        <EmptyNote>{t('ecommerce.orders.promotions.empty')}</EmptyNote>
      ) : (
        <Flex direction="column" alignItems="stretch" gap={4}>
          {rows.length > 0 && (
            <>
              <Table colCount={COLUMNS.length} rowCount={rows.length + 2}>
                <Thead>
                  <Tr>
                    {COLUMNS.map((c) => (
                      <Th key={c}>
                        <Typography variant="sigma">
                          {t(`ecommerce.orders.promotions.columns.${c}`)}
                        </Typography>
                      </Th>
                    ))}
                  </Tr>
                </Thead>
                <Tbody>
                  {rows.map((row) => (
                    <Tr key={row.key}>
                      <Td style={{ maxWidth: 260 }}>
                        <Flex direction="column" alignItems="flex-start" gap={1}>
                          <Typography textColor="neutral800" fontWeight="semiBold" ellipsis>
                            {row.displayName ?? t('ecommerce.orders.promotions.fallbackName')}
                          </Typography>
                          <Typography variant="pi" textColor="neutral500" ellipsis>
                            {t('ecommerce.orders.promotions.internalName', { name: row.name })}
                          </Typography>
                          {row.released && (
                            <Badge size="S" title={t('ecommerce.orders.promotions.releasedHint')}>
                              {t('ecommerce.orders.promotions.released')}
                            </Badge>
                          )}
                        </Flex>
                      </Td>
                      <Td>
                        <Flex direction="column" alignItems="flex-start">
                          <Typography textColor="neutral800">
                            {t(`ecommerce.promotions.methods.${row.method}`)}
                          </Typography>
                          {row.code && (
                            <Typography variant="pi" textColor="neutral600" fontWeight="semiBold">
                              {row.code}
                            </Typography>
                          )}
                        </Flex>
                      </Td>
                      <Td>
                        <Typography textColor="neutral800">
                          {t(`ecommerce.orders.promotions.classes.${row.discountClass}`)}
                        </Typography>
                      </Td>
                      <Td style={{ maxWidth: 320 }}>
                        <Typography textColor="neutral800">
                          {describeBenefit(row.benefit, money, t)}
                        </Typography>
                      </Td>
                      <Td>
                        <Typography textColor="neutral800" style={{ whiteSpace: 'nowrap' }}>
                          {discount(row.amount)}
                        </Typography>
                      </Td>
                    </Tr>
                  ))}
                  {/* The total: one cell across the first columns, the amount under Amount. */}
                  <Tr>
                    <Td colSpan={COLUMNS.length - 1} style={{ textAlign: 'right', paddingRight: 15 }}>
                      <Typography fontWeight="bold" textColor="neutral800">
                        {t('ecommerce.orders.promotions.total')}
                      </Typography>
                    </Td>
                    <Td>
                      <Typography fontWeight="bold" textColor="neutral800" style={{ whiteSpace: 'nowrap' }}>
                        {discount(promotionsDiscountTotal(promotions))}
                      </Typography>
                    </Td>
                  </Tr>
                </Tbody>
              </Table>
            </>
          )}
          {enteredCodes}
        </Flex>
      )}
    </OrderSection>
  );
};

export default PromotionsSection;
