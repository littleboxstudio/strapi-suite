import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useIntl } from 'react-intl';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Button,
  Flex,
  Loader,
  Searchbar,
  SearchForm,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  Typography,
  VisuallyHidden,
} from '@strapi/design-system';
import { Plus } from '@strapi/icons';
import config from '../../../core/config';
import { getTranslation } from '../../../core/utils/getTranslation';
import FetchCustomerOrders from '../../usecases/orders/fetchCustomerOrders';
import EmptyCustomerOrders from '../../illustrations/EmptyCustomerOrders';
import ListPagination from '../../components/ListPagination';
import {
  FulfillmentStatusBadge,
  OrderStatusBadge,
  PaymentStatusBadge,
} from '../../components/orders/StatusBadges';
import { formatCents } from '../../utils/money';
import type { CustomerOrderListItem } from '../../orderTypes';

const SEARCH_DEBOUNCE_MS = 300;

type PageInfo = { page: number; pageCount: number };

type Props = { customerId: number; canCreateOrder: boolean };

/** The customer's order history: 50 per page, searchable by reference. */
const CustomerOrdersSection = ({ customerId, canCreateOrder }: Props) => {
  const { formatMessage, formatDate, locale: uiLocale } = useIntl();
  const navigate = useNavigate();
  const ordersPath = `/plugins/${config.pluginId}/ecommerce/orders`;
  const t = (id: string) => formatMessage({ id: getTranslation(id) });

  const [items, setItems] = useState<CustomerOrderListItem[]>([]);
  const [pagination, setPagination] = useState<PageInfo>({ page: 1, pageCount: 1 });
  const [page, setPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const requestId = useRef(0);

  useEffect(() => {
    if (searchTerm === search) return undefined;
    const timer = setTimeout(() => {
      setSearch(searchTerm);
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchTerm, search]);

  useEffect(() => {
    const current = ++requestId.current;
    setLoading(true);
    new FetchCustomerOrders()
      .execute(customerId, { page, search: search.trim() || undefined })
      .then((data) => {
        if (current !== requestId.current) return;
        setItems(data.results);
        setPagination({
          page: data.pagination?.page ?? page,
          pageCount: data.pagination?.pageCount ?? 1,
        });
        setError(false);
        setLoading(false);
      })
      .catch(() => {
        if (current !== requestId.current) return;
        setError(true);
        setLoading(false);
      });
  }, [customerId, page, search]);

  const isEmpty = !loading && !error && items.length === 0;
  const noSearch = search === '' && searchTerm === '';
  const createOrder = () => navigate(`${ordersPath}/new?customerId=${customerId}`);

  return (
    <Box background="neutral0" shadow="tableShadow" hasRadius padding={6}>
      <Flex direction="column" alignItems="stretch" gap={5}>
        <Flex justifyContent="space-between" alignItems="center" gap={4}>
          <Typography variant="delta" tag="h2">
            {t('ecommerce.customers.orders.title')}
          </Typography>
          {canCreateOrder && (
            <Button size="S" startIcon={<Plus />} onClick={createOrder}>
              {t('ecommerce.customers.orders.create')}
            </Button>
          )}
        </Flex>

        <SearchForm onSubmit={(e: FormEvent) => e.preventDefault()}>
          <Searchbar
            name="orders-search"
            value={searchTerm}
            onClear={() => {
              setSearchTerm('');
              setSearch('');
              setPage(1);
            }}
            onChange={(e: any) => setSearchTerm(e.target.value)}
            clearLabel={t('ecommerce.customers.orders.search.clear')}
            placeholder={t('ecommerce.customers.orders.search.placeholder')}
          >
            {t('ecommerce.customers.orders.search.label')}
          </Searchbar>
        </SearchForm>

        {error && (
          <Typography textColor="danger600">{t('ecommerce.customers.orders.error')}</Typography>
        )}

        {loading && items.length === 0 && !error && (
          <Flex justifyContent="center" padding={6}>
            <Loader small />
          </Flex>
        )}

        {isEmpty && noSearch && (
          <Flex direction="column" alignItems="center" gap={3} padding={6}>
            <EmptyCustomerOrders />
            <Typography variant="omega" textColor="neutral600">
              {t('ecommerce.customers.orders.empty')}
            </Typography>
          </Flex>
        )}

        {isEmpty && !noSearch && (
          <Flex justifyContent="center" padding={6}>
            <Typography variant="omega" textColor="neutral600">
              {t('ecommerce.customers.noResults')}
            </Typography>
          </Flex>
        )}

        {items.length > 0 && (
          <>
            <Table colCount={7} rowCount={items.length}>
              <Thead>
                <Tr>
                  <Th>
                    <Typography variant="sigma">
                      {t('ecommerce.customers.orders.table.reference')}
                    </Typography>
                  </Th>
                  <Th>
                    <Typography variant="sigma">{t('ecommerce.customers.orders.table.date')}</Typography>
                  </Th>
                  <Th>
                    <Typography variant="sigma">{t('ecommerce.customers.orders.table.total')}</Typography>
                  </Th>
                  <Th>
                    <Typography variant="sigma">
                      {t('ecommerce.customers.orders.table.orderStatus')}
                    </Typography>
                  </Th>
                  <Th>
                    <Typography variant="sigma">
                      {t('ecommerce.customers.orders.table.paymentStatus')}
                    </Typography>
                  </Th>
                  <Th>
                    <Typography variant="sigma">
                      {t('ecommerce.customers.orders.table.fulfillmentStatus')}
                    </Typography>
                  </Th>
                  <Th>
                    <VisuallyHidden>{t('ecommerce.customers.table.actions')}</VisuallyHidden>
                  </Th>
                </Tr>
              </Thead>
              <Tbody>
                {items.map((order) => (
                  <Tr key={order.id} style={{ opacity: loading ? 0.5 : 1 }}>
                    <Td>
                      <Typography textColor="neutral800" fontWeight="semiBold">
                        #{order.reference}
                      </Typography>
                    </Td>
                    <Td>
                      <Typography textColor="neutral800">
                        {formatDate(order.createdAt, { dateStyle: 'medium', timeStyle: 'short' })}
                      </Typography>
                    </Td>
                    <Td>
                      <Typography textColor="neutral800">
                        {formatCents(order.total, uiLocale)}
                      </Typography>
                    </Td>
                    <Td>
                      <OrderStatusBadge status={order.orderStatus} />
                    </Td>
                    <Td>
                      <PaymentStatusBadge status={order.paymentStatus} />
                    </Td>
                    <Td>
                      <FulfillmentStatusBadge status={order.fulfillmentStatus} />
                    </Td>
                    <Td>
                      <Box style={{ textAlign: 'right' }}>
                        <Button
                          variant="tertiary"
                          size="S"
                          onClick={() => navigate(`${ordersPath}/${order.id}`)}
                        >
                          {t('ecommerce.customers.orders.view')}
                        </Button>
                      </Box>
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>

            <ListPagination
              page={pagination.page}
              pageCount={pagination.pageCount}
              onChange={setPage}
            />
          </>
        )}
      </Flex>
    </Box>
  );
};

export default CustomerOrdersSection;
