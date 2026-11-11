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
import config from '../../../core/config';
import { getTranslation } from '../../../core/utils/getTranslation';
import FetchCustomers from '../../usecases/orders/fetchCustomers';
import EmptyCustomers from '../../illustrations/EmptyCustomers';
import ListPagination from '../../components/ListPagination';
import { customerName } from '../../utils/customerForm';
import type { CustomerListItem } from '../../orderTypes';

const SEARCH_DEBOUNCE_MS = 300;

type PageInfo = { page: number; pageCount: number };

const CustomerListPage = () => {
  const { formatMessage } = useIntl();
  const navigate = useNavigate();
  const basePath = `/plugins/${config.pluginId}/ecommerce/customers`;
  const t = (id: string) => formatMessage({ id: getTranslation(id) });

  const [items, setItems] = useState<CustomerListItem[]>([]);
  const [pagination, setPagination] = useState<PageInfo>({ page: 1, pageCount: 1 });
  const [page, setPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');
  const [search, setSearch] = useState('');
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
    new FetchCustomers()
      .execute({ page, search: search.trim() || undefined })
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
  }, [page, search]);

  const goToEdit = (id: number) => navigate(`${basePath}/${id}`);
  const isEmpty = !loading && !error && items.length === 0;
  const noSearch = search === '' && searchTerm === '';

  return (
    <Flex direction="column" alignItems="stretch" gap={4}>
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
          clearLabel={t('ecommerce.customers.search.clear')}
          placeholder={t('ecommerce.customers.search.placeholder')}
        >
          {t('ecommerce.customers.search.label')}
        </Searchbar>
      </SearchForm>

      {error && <Typography textColor="danger600">{t('ecommerce.customers.error')}</Typography>}

      {loading && items.length === 0 && !error && (
        <Flex justifyContent="center" padding={8}>
          <Loader />
        </Flex>
      )}

      {isEmpty && noSearch && (
        <Flex
          direction="column"
          alignItems="center"
          gap={3}
          padding={10}
          background="neutral0"
          shadow="tableShadow"
          hasRadius
        >
          <EmptyCustomers />
          <Typography variant="omega" textColor="neutral600">
            {t('ecommerce.customers.empty')}
          </Typography>
        </Flex>
      )}

      {isEmpty && !noSearch && (
        <Flex justifyContent="center" padding={8} background="neutral0" hasRadius>
          <Typography variant="omega" textColor="neutral600">
            {t('ecommerce.customers.noResults')}
          </Typography>
        </Flex>
      )}

      {items.length > 0 && (
        <>
          <Table colCount={3} rowCount={items.length}>
            <Thead>
              <Tr>
                <Th>
                  <Typography variant="sigma">{t('ecommerce.customers.table.name')}</Typography>
                </Th>
                <Th>
                  <Typography variant="sigma">{t('ecommerce.customers.table.email')}</Typography>
                </Th>
                <Th>
                  <VisuallyHidden>{t('ecommerce.customers.table.actions')}</VisuallyHidden>
                </Th>
              </Tr>
            </Thead>
            <Tbody>
              {items.map((item) => (
                <Tr key={item.id} style={{ opacity: loading ? 0.5 : 1 }}>
                  <Td>
                    <Typography textColor="neutral800">{customerName(item)}</Typography>
                  </Td>
                  <Td>
                    <Typography textColor="neutral800">{item.email}</Typography>
                  </Td>
                  <Td>
                    <Box style={{ textAlign: 'right' }}>
                      <Button variant="tertiary" size="S" onClick={() => goToEdit(item.id)}>
                        {t('ecommerce.customers.edit')}
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

export { CustomerListPage };
