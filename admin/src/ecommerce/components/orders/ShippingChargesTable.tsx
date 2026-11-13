import { useIntl } from 'react-intl';
import { Box, Button, Flex, Table, Tbody, Td, Th, Thead, Tr, Typography } from '@strapi/design-system';
import { getTranslation } from '../../../core/utils/getTranslation';
import { formatCents } from '../../utils/money';
import { hasRowActions, shippingLineAmount, type ShippingLineRow } from '../../utils/orderEditing';
import type { BadgeVariant } from '../../utils/statusBadges';
import type { ShippingLineView } from '../../orderTypes';
import ColumnLabel from '../ColumnLabel';
import EmptyNote from './EmptyNote';
import { ToneBadge } from './StatusBadges';

const BADGE_VARIANT: Record<ShippingLineRow['badges'][number], BadgeVariant> = {
  PAID: 'success',
  INVOICED: 'secondary',
  SPENT: 'neutral',
};

type Props = {
  rows: ShippingLineRow[];
  /** Called by a row's Edit button (rows without actions have none). */
  onEdit?: (line: ShippingLineView) => void;
};

/** The order's shipping charges, one row per line (spec 6.3). */
const ShippingChargesTable = ({ rows, onEdit }: Props) => {
  const { formatMessage, formatDate, locale } = useIntl();
  const t = (id: string, values?: Record<string, any>, defaultMessage?: string) =>
    formatMessage({ id: getTranslation(id), defaultMessage }, values);
  const money = (cents: number) => formatCents(cents, locale);
  const columns = ['method', 'date', 'amount', 'status', ...(hasRowActions(rows) ? ['actions'] : [])];

  if (!rows.length) return <EmptyNote>{t('ecommerce.orders.shippingCharges.empty')}</EmptyNote>;

  return (
    <Box style={{ overflowX: 'auto' }}>
      <Table colCount={columns.length} rowCount={rows.length + 1}>
        <Thead>
          <Tr>
            {columns.map((c) => (
              <Th key={c}>
                <ColumnLabel column={c}>{t(`ecommerce.orders.shippingCharges.columns.${c}`)}</ColumnLabel>
              </Th>
            ))}
          </Tr>
        </Thead>
        <Tbody>
          {rows.map(({ line, badges, actions }) => {
            const amount = shippingLineAmount(line);
            return (
              <Tr key={line.id}>
                <Td>
                  <Flex direction="column" alignItems="flex-start">
                    <Typography textColor="neutral800">{line.name}</Typography>
                    <Typography variant="pi" textColor="neutral600">
                      {t(`ecommerce.orders.shippingCharges.origin.${line.origin}`, undefined, line.origin)}
                    </Typography>
                  </Flex>
                </Td>
                <Td>
                  <Typography textColor="neutral800">
                    {line.createdAt ? formatDate(line.createdAt, { dateStyle: 'medium', timeStyle: 'short' }) : '—'}
                  </Typography>
                </Td>
                <Td>
                  <Flex direction="column" alignItems="flex-start">
                    <Typography textColor={amount < 0 ? 'success700' : 'neutral800'} fontWeight="semiBold">
                      {money(amount)}
                    </Typography>
                    {amount !== line.amount && (
                      <Typography variant="pi" textColor="neutral600">
                        {t('ecommerce.orders.shippingCharges.corrected', { amount: money(line.amount) })}
                      </Typography>
                    )}
                  </Flex>
                </Td>
                <Td>
                  <Flex gap={1} wrap="wrap">
                    {badges.length
                      ? badges.map((b) => (
                          <ToneBadge key={b} variant={BADGE_VARIANT[b]}>
                            {t(`ecommerce.orders.shippingCharges.badge.${b}`)}
                          </ToneBadge>
                        ))
                      : <Typography textColor="neutral600">—</Typography>}
                  </Flex>
                </Td>
                {columns.includes('actions') && (
                  <Td>
                    <Flex justifyContent="flex-end">
                      {actions.includes('EDIT') && onEdit && (
                        <Button size="S" variant="tertiary" onClick={() => onEdit(line)}>
                          {t('ecommerce.orders.shippingCharges.edit')}
                        </Button>
                      )}
                    </Flex>
                  </Td>
                )}
              </Tr>
            );
          })}
        </Tbody>
      </Table>
    </Box>
  );
};

export default ShippingChargesTable;
