import type { ReactNode } from 'react';
import { useIntl } from 'react-intl';
import { Flex, Table, Tbody, Td, Th, Thead, Tr, Typography } from '@strapi/design-system';
import { getTranslation } from '../../../core/utils/getTranslation';
import { formatCents } from '../../utils/money';
import type { PromotionRow } from '../../utils/orderDetail';
import type { ManualLineDiscountRow } from '../../utils/orderEditing';
import { describeBenefit } from '../../utils/promotionForm';
import ColumnLabel from '../ColumnLabel';
import { ToneBadge } from './StatusBadges';

/** Long texts (a product name in a benefit) wrap inside their cell instead of running over the next. */
const WRAP = { whiteSpace: 'normal', overflowWrap: 'anywhere' } as const;

const COLUMNS = ['promotion', 'method', 'type', 'benefit', 'amount', 'actions'] as const;

/** A manual order discount: its reason, the percent detail, the amount (null: not priced yet). */
export type ManualDiscountTableRow = {
  key: string;
  reason: string;
  detail: string | null;
  amount: number | null;
  /** A translated error of this discount. */
  error?: string;
  /** Its button (Remove), in the Actions column. */
  action?: ReactNode;
};

type Props = {
  rows: PromotionRow[];
  manualRows: ManualDiscountTableRow[];
  lineRows: ManualLineDiscountRow[];
  /** The total discount; null: not priced yet. */
  total: number | null;
  /** Shows the Actions column. */
  showActions: boolean;
  /** A promotion row's button (Create order: Remove), in the Actions column. */
  rowAction?: (row: PromotionRow) => ReactNode;
  /** The Total discount row (default); Create order shows the total in its tiles instead. */
  showTotal?: boolean;
};

/**
 * The promotions and discounts table of the order screen and Create order: one row per promotion
 * benefit, the manual discounts ("Manual" rows), the manual line discounts and the total.
 */
const DiscountsTable = ({ rows, manualRows, lineRows, total, showActions, rowAction, showTotal = true }: Props) => {
  const { formatMessage, locale: uiLocale } = useIntl();
  const t = (id: string, values?: Record<string, any>) =>
    formatMessage({ id: getTranslation(id) }, values);
  const money = (cents: number) => formatCents(cents, uiLocale);
  const discount = (cents: number) => money(cents ? -cents : 0);
  const columns = showActions ? COLUMNS : COLUMNS.filter((c) => c !== 'actions');
  // Without the Actions column, Amount is the last one: its values (and the total) sit on the right.
  const amountCell = showActions ? undefined : ({ textAlign: 'right' } as const);

  return (
    <Table
      colCount={columns.length}
      rowCount={rows.length + manualRows.length + lineRows.length + (showTotal ? 2 : 1)}
    >
      <Thead>
        <Tr>
          {columns.map((c) => (
            <Th key={c}>
              {c === 'amount' && amountCell ? (
                <Flex justifyContent="flex-end" style={{ width: '100%' }}>
                  <ColumnLabel column={c}>{t(`ecommerce.orders.promotions.columns.${c}`)}</ColumnLabel>
                </Flex>
              ) : (
                <ColumnLabel column={c}>{t(`ecommerce.orders.promotions.columns.${c}`)}</ColumnLabel>
              )}
            </Th>
          ))}
        </Tr>
      </Thead>
      <Tbody>
        {rows.map((row) => (
          <Tr key={row.key}>
            <Td style={{ maxWidth: 260, ...WRAP }}>
              <Flex direction="column" alignItems="flex-start" gap={1}>
                <Typography textColor="neutral800" fontWeight="semiBold" ellipsis>
                  {row.displayName ?? t('ecommerce.orders.promotions.fallbackName')}
                </Typography>
                <Typography variant="pi" textColor="neutral500" ellipsis>
                  {t('ecommerce.orders.promotions.internalName', { name: row.name })}
                </Typography>
                {row.released && (
                  <ToneBadge title={t('ecommerce.orders.promotions.releasedHint')}>
                    {t('ecommerce.orders.promotions.released')}
                  </ToneBadge>
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
            <Td style={{ maxWidth: 320, ...WRAP }}>
              <Typography textColor="neutral800" style={WRAP}>{describeBenefit(row.benefit, money, t)}</Typography>
            </Td>
            <Td>
              <Typography textColor="neutral800" style={{ whiteSpace: 'nowrap', display: 'block', ...amountCell }}>
                {discount(row.amount)}
              </Typography>
            </Td>
            {showActions && (
              <Td>
                <Flex justifyContent="flex-end">{rowAction?.(row)}</Flex>
              </Td>
            )}
          </Tr>
        ))}
        {manualRows.map((m) => (
          <Tr key={m.key}>
            <Td style={{ maxWidth: 260, ...WRAP }}>
              <Typography textColor="neutral800" fontWeight="semiBold">
                {t('ecommerce.orders.discounts.manualName')}
              </Typography>
            </Td>
            <Td>
              <Typography textColor="neutral800">{t('ecommerce.orders.discounts.manual')}</Typography>
            </Td>
            <Td>
              <Typography textColor="neutral800">
                {t('ecommerce.orders.promotions.classes.ORDER_DISCOUNT')}
              </Typography>
            </Td>
            <Td style={{ maxWidth: 320, ...WRAP }}>
              <Flex direction="column" alignItems="flex-start" gap={1}>
                <Typography textColor="neutral800" style={WRAP}>
                  {m.reason}
                </Typography>
                {m.detail && (
                  <Typography variant="pi" textColor="neutral600">
                    {m.detail}
                  </Typography>
                )}
                {m.error && (
                  <Typography variant="pi" textColor="danger600" role="alert">
                    {m.error}
                  </Typography>
                )}
              </Flex>
            </Td>
            <Td>
              <Typography textColor="neutral800" style={{ whiteSpace: 'nowrap', display: 'block', ...amountCell }}>
                {m.amount === null ? '—' : discount(m.amount)}
              </Typography>
            </Td>
            {showActions && (
              <Td>
                <Flex justifyContent="flex-end">{m.action}</Flex>
              </Td>
            )}
          </Tr>
        ))}
        {lineRows.map((r) => (
          <Tr key={r.key}>
            <Td style={{ maxWidth: 260, ...WRAP }}>
              <Typography textColor="neutral800" fontWeight="semiBold">
                {t('ecommerce.orders.discounts.manualLineName')}
              </Typography>
            </Td>
            <Td>
              <Typography textColor="neutral800">{t('ecommerce.orders.discounts.manual')}</Typography>
            </Td>
            <Td>
              <Typography textColor="neutral800">
                {t('ecommerce.orders.promotions.classes.PRODUCT_DISCOUNT')}
              </Typography>
            </Td>
            <Td style={{ maxWidth: 320, ...WRAP }}>
              <Typography textColor="neutral800" style={WRAP}>
                {r.label}
              </Typography>
            </Td>
            <Td>
              <Typography textColor="neutral800" style={{ whiteSpace: 'nowrap', display: 'block', ...amountCell }}>
                {discount(r.amount)}
              </Typography>
            </Td>
            {showActions && <Td />}
          </Tr>
        ))}
        {/* The total: label and amount in one cell, on the right (under Amount). */}
        {showTotal && (
          <Tr>
            <Td colSpan={columns.length - (showActions ? 1 : 0)}>
              {/* The rows' own height (52px): 16px above and below the 20px line. The spanning
                  cell has 4px on the right, the others 16px: 12px more aligns the amount. */}
              <Flex justifyContent="flex-end" gap={2} paddingTop={4} paddingBottom={4} paddingRight={3}>
                <Typography fontWeight="bold" textColor="neutral800">
                  {t('ecommerce.orders.promotions.total')}
                </Typography>
                <Typography fontWeight="bold" textColor="neutral800" style={{ whiteSpace: 'nowrap' }}>
                  {total === null ? '—' : discount(total)}
                </Typography>
              </Flex>
            </Td>
            {showActions && <Td />}
          </Tr>
        )}
      </Tbody>
    </Table>
  );
};

export default DiscountsTable;
