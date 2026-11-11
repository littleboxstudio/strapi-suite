import { useEffect, useRef, useState } from 'react';
import { useIntl } from 'react-intl';
import { Link as RouterLink } from 'react-router-dom';
import { Badge, Flex, Link, Loader, Table, Tbody, Td, Th, Thead, Tr, Typography } from '@strapi/design-system';
import config from '../../../core/config';
import { getTranslation } from '../../../core/utils/getTranslation';
import FetchPromotionRedemptions from '../../usecases/promotions/fetchPromotionRedemptions';
import ListPagination from '../ListPagination';
import { formatCents } from '../../utils/money';
import type { PromotionRedemption } from '../../promotionTypes';

const COLUMNS = ['order', 'customer', 'amount', 'status', 'date'] as const;

/** Orders that used the promotion: order link, masked e-mail (link to the customer), amount, state, date. */
const RedemptionsTable = ({ promotionId }: { promotionId: number }) => {
  const { formatMessage, formatDate, locale } = useIntl();
  const t = (id: string, values?: Record<string, any>) => formatMessage({ id: getTranslation(id) }, values);
  const base = `/plugins/${config.pluginId}/ecommerce`;
  const p = 'ecommerce.promotions.form.usage';

  const [items, setItems] = useState<PromotionRedemption[]>([]);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const requestId = useRef(0);

  useEffect(() => {
    const current = ++requestId.current;
    setLoading(true);
    new FetchPromotionRedemptions()
      .execute(promotionId, page)
      .then((data) => {
        if (current !== requestId.current) return;
        setItems(data.results);
        setPageCount(data.pagination?.pageCount ?? 1);
        setError(false);
        setLoading(false);
      })
      .catch(() => {
        if (current !== requestId.current) return;
        setError(true);
        setLoading(false);
      });
  }, [promotionId, page]);

  if (error) return <Typography textColor="danger600">{t(`${p}.error`)}</Typography>;
  if (loading && items.length === 0) {
    return (
      <Flex justifyContent="center" padding={4}>
        <Loader small />
      </Flex>
    );
  }
  if (items.length === 0) {
    return (
      <Typography variant="omega" textColor="neutral600">
        {t(`${p}.empty`)}
      </Typography>
    );
  }

  return (
    <Flex direction="column" alignItems="stretch" gap={3}>
      <Table colCount={COLUMNS.length} rowCount={items.length}>
        <Thead>
          <Tr>
            {COLUMNS.map((c) => (
              <Th key={c}>
                <Typography variant="sigma">{t(`${p}.columns.${c}`)}</Typography>
              </Th>
            ))}
          </Tr>
        </Thead>
        <Tbody>
          {items.map((r) => (
            <Tr key={r.id} style={{ opacity: loading ? 0.5 : 1 }}>
              <Td>
                {r.orderId ? (
                  <Link tag={RouterLink} to={`${base}/orders/${r.orderId}`}>
                    {t(`${p}.order`, { reference: r.orderReference ?? r.orderId })}
                  </Link>
                ) : (
                  <Typography textColor="neutral800">—</Typography>
                )}
              </Td>
              <Td>
                {r.customerId ? (
                  <Link tag={RouterLink} to={`${base}/customers/${r.customerId}`}>
                    {r.maskedEmail ?? `#${r.customerId}`}
                  </Link>
                ) : (
                  <Typography textColor="neutral800">{r.maskedEmail ?? '—'}</Typography>
                )}
              </Td>
              <Td>
                <Typography textColor="neutral800">{formatCents(r.amount, locale)}</Typography>
              </Td>
              <Td>
                <Badge variant={r.status === 'RESERVED' ? 'success' : 'neutral'} size="S">
                  {t(`${p}.statuses.${r.status}`)}
                </Badge>
              </Td>
              <Td>
                <Typography textColor="neutral800">
                  {r.createdAt ? formatDate(r.createdAt, { dateStyle: 'medium', timeStyle: 'short' }) : '—'}
                </Typography>
              </Td>
            </Tr>
          ))}
        </Tbody>
      </Table>
      <ListPagination page={page} pageCount={pageCount} onChange={setPage} />
    </Flex>
  );
};

export default RedemptionsTable;
