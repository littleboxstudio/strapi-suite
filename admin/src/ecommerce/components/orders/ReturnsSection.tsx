import { useIntl } from 'react-intl';
import { Flex, Table, Tbody, Td, Th, Thead, Tr, Typography } from '@strapi/design-system';
import { getTranslation } from '../../../core/utils/getTranslation';
import EmptyNote from './EmptyNote';
import { formatCents } from '../../utils/money';
import type { ReturnView } from '../../orderTypes';
import OrderSection from './OrderSection';

const COLUMNS = ['date', 'items', 'reason', 'value'] as const;

/** Read-only list of the order's returns (oldest first, as the API sends them). */
const ReturnsSection = ({ title, returns }: { title: string; returns: ReturnView[] }) => {
  const { formatMessage, formatDate, locale: uiLocale } = useIntl();
  const t = (id: string, values?: Record<string, any>) => formatMessage({ id: getTranslation(id) }, values);
  const money = (cents: number) => formatCents(cents, uiLocale);

  return (
    <OrderSection title={title}>
      {returns.length === 0 ? (
        <EmptyNote>{t('ecommerce.orders.returns.list.empty')}</EmptyNote>
      ) : (
        <Table colCount={COLUMNS.length} rowCount={returns.length + 1}>
          <Thead>
            <Tr>
              {COLUMNS.map((c) => (
                <Th key={c}>
                  <Typography variant="sigma">{t(`ecommerce.orders.returns.list.columns.${c}`)}</Typography>
                </Th>
              ))}
            </Tr>
          </Thead>
          <Tbody>
            {returns.map((r) => (
              <Tr key={r.id}>
                <Td>
                  <Flex direction="column" alignItems="flex-start">
                    <Typography textColor="neutral800" fontWeight="semiBold">
                      #{r.id}
                    </Typography>
                    <Typography variant="pi" textColor="neutral600">
                      {r.createdAt ? formatDate(r.createdAt, { dateStyle: 'medium', timeStyle: 'short' }) : '—'}
                    </Typography>
                  </Flex>
                </Td>
                <Td style={{ maxWidth: 280 }}>
                  <Flex direction="column" alignItems="flex-start">
                    {r.items.map((i) => (
                      <Typography key={i.orderLineId} variant="pi" textColor="neutral800" ellipsis>
                        {i.quantity} × {i.name}
                        {i.option ? ` (${i.option})` : ''} ·{' '}
                        {t(i.restock ? 'ecommerce.orders.returns.restocked' : 'ecommerce.orders.returns.notRestocked')}
                      </Typography>
                    ))}
                  </Flex>
                </Td>
                <Td style={{ maxWidth: 260 }}>
                  <Flex direction="column" alignItems="flex-start">
                    <Typography textColor="neutral800">{r.reason || '—'}</Typography>
                    {r.notes && (
                      <Typography variant="pi" textColor="neutral600" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                        {r.notes}
                      </Typography>
                    )}
                  </Flex>
                </Td>
                <Td>
                  <Typography textColor="neutral800" fontWeight="semiBold">
                    {money(r.refundableValue)}
                  </Typography>
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      )}
    </OrderSection>
  );
};

export default ReturnsSection;
