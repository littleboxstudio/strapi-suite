import { useIntl } from 'react-intl';
import { Badge, Box, Table, Tbody, Td, Th, Thead, Tr, Typography } from '@strapi/design-system';
import { getTranslation } from '../../../core/utils/getTranslation';
import { formatCents } from '../../utils/money';
import type { OrderPayment } from '../../orderTypes';
import ColumnLabel from '../ColumnLabel';

const COLUMNS = ['method', 'amount', 'reference', 'status', 'date'] as const;

const STATUS_VARIANT: Record<string, 'warning' | 'success' | 'neutral' | 'danger'> = {
  PENDING: 'warning',
  COMPLETED: 'success',
  CANCELLED: 'neutral',
  FAILED: 'danger',
};

type Props = { payments: OrderPayment[] };

/** The order's individual payments (requirement 7.2). */
const PaymentsTable = ({ payments }: Props) => {
  const { formatMessage, formatDate, locale: uiLocale } = useIntl();
  const t = (id: string, defaultMessage?: string) =>
    formatMessage({ id: getTranslation(id), defaultMessage });

  if (!payments.length) {
    return (
      <Box padding={4} background="neutral100" hasRadius>
        <Typography variant="omega" textColor="neutral600">
          {t('ecommerce.orders.detail.payments.empty')}
        </Typography>
      </Box>
    );
  }

  return (
    <Table colCount={COLUMNS.length} rowCount={payments.length + 1}>
      <Thead>
        <Tr>
          {COLUMNS.map((column) => (
            <Th key={column}>
              <ColumnLabel column={column}>{t(`ecommerce.orders.detail.payments.${column}`)}</ColumnLabel>
            </Th>
          ))}
        </Tr>
      </Thead>
      <Tbody>
        {payments.map((p) => {
          const date = p.completedAt ?? p.createdAt;
          return (
            <Tr key={p.id}>
              <Td>
                <Typography textColor="neutral800">
                  {p.methodLabel || t(`ecommerce.orders.detail.payments.methods.${p.method}`, p.method)}
                </Typography>
              </Td>
              <Td>
                <Typography textColor="neutral800">{formatCents(p.amount, uiLocale)}</Typography>
              </Td>
              <Td style={{ maxWidth: 220 }}>
                <Typography textColor="neutral800" ellipsis>
                  {p.reference || p.externalId || '—'}
                </Typography>
              </Td>
              <Td>
                <Badge variant={STATUS_VARIANT[p.status] ?? 'neutral'} size="S">
                  {t(`ecommerce.orders.detail.payments.statuses.${p.status}`, p.status)}
                </Badge>
              </Td>
              <Td>
                <Typography textColor="neutral800">
                  {date ? formatDate(date, { dateStyle: 'medium', timeStyle: 'short' }) : '—'}
                </Typography>
              </Td>
            </Tr>
          );
        })}
      </Tbody>
    </Table>
  );
};

export default PaymentsTable;
