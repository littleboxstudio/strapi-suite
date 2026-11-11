import { useIntl } from 'react-intl';
import { Divider, Flex, Typography } from '@strapi/design-system';
import { getTranslation } from '../../../core/utils/getTranslation';
import { formatCents } from '../../utils/money';
import { financialSummaryRows } from '../../utils/orderDetail';
import type { FinancialSummary as Summary, OrderTotals } from '../../orderTypes';

/** Rows after which a divider separates the amounts from the payments. */
const DIVIDER_AFTER = new Set(['total']);

/** The amounts recorded on the order; zero discounts and refunds are hidden. */
const FinancialSummary = ({ totals, summary }: { totals: OrderTotals; summary: Summary }) => {
  const { formatMessage, locale: uiLocale } = useIntl();
  const rows = financialSummaryRows(totals, summary);

  return (
    <Flex direction="column" alignItems="stretch" gap={3}>
      {rows.map((row) => (
        <Flex key={row.key} direction="column" alignItems="stretch" gap={3}>
          <Flex justifyContent="space-between" gap={4}>
            <Typography
              textColor={row.strong ? 'neutral800' : 'neutral600'}
              fontWeight={row.strong ? 'bold' : undefined}
            >
              {formatMessage({ id: getTranslation(`ecommerce.orders.detail.summary.${row.key}`) })}
            </Typography>
            <Typography
              textColor={row.key === 'excess' ? 'success600' : 'neutral800'}
              fontWeight={row.strong ? 'bold' : undefined}
              style={{ whiteSpace: 'nowrap' }}
            >
              {formatCents(row.amount, uiLocale)}
            </Typography>
          </Flex>
          {DIVIDER_AFTER.has(row.key) && <Divider />}
        </Flex>
      ))}
    </Flex>
  );
};

export default FinancialSummary;
