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
  SingleSelect,
  SingleSelectOption,
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
import FetchOrders from '../../usecases/orders/fetchOrders';
import EmptyOrders from '../../illustrations/EmptyOrders';
import ListPagination from '../../components/ListPagination';
import {
  FulfillmentStatusBadge,
  OrderStatusBadge,
  PaymentStatusBadge,
} from '../../components/orders/StatusBadges';
import {
  FULFILLMENT_STATUS_BADGES,
  ORDER_STATUS_BADGES,
  PAYMENT_STATUS_BADGES,
} from '../../utils/statusBadges';
import { formatCents } from '../../utils/money';
import { useOrderPermissions } from '../../hooks/useOrderPermissions';
import type {
  FulfillmentStatus,
  OrderListItem,
  OrderStatus,
  PaymentStatus,
} from '../../orderTypes';

const SEARCH_DEBOUNCE_MS = 300;

const ORDER_STATUSES = Object.keys(ORDER_STATUS_BADGES) as OrderStatus[];
const PAYMENT_STATUSES = Object.keys(PAYMENT_STATUS_BADGES) as PaymentStatus[];
const FULFILLMENT_STATUSES = Object.keys(FULFILLMENT_STATUS_BADGES) as FulfillmentStatus[];

type PageInfo = { page: number; pageCount: number };

type Filters = {
  orderStatus: OrderStatus | null;
  paymentStatus: PaymentStatus | null;
  fulfillmentStatus: FulfillmentStatus | null;
};

const NO_FILTERS: Filters = { orderStatus: null, paymentStatus: null, fulfillmentStatus: null };

const OrderListPage = () => {
  const { formatMessage, formatDate, locale: uiLocale } = useIntl();
  const navigate = useNavigate();
  const basePath = `/plugins/${config.pluginId}/ecommerce/orders`;
  const t = (id: string) => formatMessage({ id: getTranslation(id) });
  const { canManage } = useOrderPermissions();

  const [items, setItems] = useState<OrderListItem[]>([]);
  const [pagination, setPagination] = useState<PageInfo>({ page: 1, pageCount: 1 });
  const [page, setPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const requestId = useRef(0);

  // Debounced: a new search term always goes back to the first page.
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
    new FetchOrders()
      .execute({
        page,
        search: search.trim() || undefined,
        orderStatus: filters.orderStatus ?? undefined,
        paymentStatus: filters.paymentStatus ?? undefined,
        fulfillmentStatus: filters.fulfillmentStatus ?? undefined,
      })
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
  }, [page, search, filters]);

  const setFilter = <K extends keyof Filters>(key: K, value: Filters[K]) => {
    setFilters((f) => ({ ...f, [key]: value }));
    setPage(1);
  };

  const goToCreate = () => navigate(`${basePath}/new`);
  const isEmpty = !loading && !error && items.length === 0;
  const noFilters =
    search === '' &&
    searchTerm === '' &&
    !filters.orderStatus &&
    !filters.paymentStatus &&
    !filters.fulfillmentStatus;

  const filterSelect = <K extends keyof Filters>(
    key: K,
    group: 'order' | 'payment' | 'fulfillment',
    statuses: NonNullable<Filters[K]>[]
  ) => (
    <Box style={{ minWidth: 200 }}>
      <SingleSelect
        size="S"
        aria-label={t(`ecommerce.orders.filters.${group}`)}
        placeholder={t(`ecommerce.orders.filters.${group}`)}
        value={filters[key]}
        clearLabel={t('ecommerce.orders.filters.clear')}
        onClear={() => setFilter(key, null as Filters[K])}
        onChange={(value: string | number) => setFilter(key, String(value) as Filters[K])}
      >
        {statuses.map((status) => (
          <SingleSelectOption key={status} value={status}>
            {t(`ecommerce.orders.status.${group}.${status}`)}
          </SingleSelectOption>
        ))}
      </SingleSelect>
    </Box>
  );

  return (
    <Flex direction="column" alignItems="stretch" gap={4}>
      <Flex justifyContent="space-between" alignItems="center" gap={4}>
        <Box style={{ flex: 1 }}>
          <SearchForm onSubmit={(e: FormEvent) => e.preventDefault()}>
            <Searchbar
              name="searchbar"
              value={searchTerm}
              onClear={() => {
                setSearchTerm('');
                setSearch('');
                setPage(1);
              }}
              onChange={(e: any) => setSearchTerm(e.target.value)}
              clearLabel={t('ecommerce.orders.search.clear')}
              placeholder={t('ecommerce.orders.search.placeholder')}
            >
              {t('ecommerce.orders.search.label')}
            </Searchbar>
          </SearchForm>
        </Box>
        {canManage && (
          <Button size="S" startIcon={<Plus />} onClick={goToCreate}>
            {t('ecommerce.orders.create')}
          </Button>
        )}
      </Flex>

      <Flex gap={3} wrap="wrap">
        {filterSelect('orderStatus', 'order', ORDER_STATUSES)}
        {filterSelect('paymentStatus', 'payment', PAYMENT_STATUSES)}
        {filterSelect('fulfillmentStatus', 'fulfillment', FULFILLMENT_STATUSES)}
      </Flex>

      {error && <Typography textColor="danger600">{t('ecommerce.orders.error')}</Typography>}

      {loading && items.length === 0 && !error && (
        <Flex justifyContent="center" padding={8}>
          <Loader />
        </Flex>
      )}

      {isEmpty && noFilters && (
        <Flex
          direction="column"
          alignItems="center"
          gap={3}
          padding={10}
          background="neutral0"
          shadow="tableShadow"
          hasRadius
        >
          <EmptyOrders />
          <Typography variant="omega" textColor="neutral600">
            {t('ecommerce.orders.empty')}
          </Typography>
          {canManage && (
            <Button startIcon={<Plus />} onClick={goToCreate}>
              {t('ecommerce.orders.create')}
            </Button>
          )}
        </Flex>
      )}

      {isEmpty && !noFilters && (
        <Flex justifyContent="center" padding={8} background="neutral0" hasRadius>
          <Typography variant="omega" textColor="neutral600">
            {t('ecommerce.orders.noResults')}
          </Typography>
        </Flex>
      )}

      {items.length > 0 && (
        <>
          <Table colCount={8} rowCount={items.length}>
            <Thead>
              <Tr>
                {(
                  [
                    'reference',
                    'customer',
                    'date',
                    'total',
                    'orderStatus',
                    'paymentStatus',
                    'fulfillmentStatus',
                  ] as const
                ).map((column) => (
                  <Th key={column}>
                    <Typography variant="sigma">{t(`ecommerce.orders.table.${column}`)}</Typography>
                  </Th>
                ))}
                <Th>
                  <VisuallyHidden>{t('ecommerce.orders.table.actions')}</VisuallyHidden>
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
                    <Typography textColor="neutral800">{order.customerName}</Typography>
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
                        onClick={() => navigate(`${basePath}/${order.id}`)}
                      >
                        {t('ecommerce.orders.view')}
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
  );
};

export { OrderListPage };
