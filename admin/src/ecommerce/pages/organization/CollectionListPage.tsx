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
import EmptySection from '../../illustrations/EmptySection';
import ListPagination from '../../components/ListPagination';
import SearchFieldHeight from '../../components/SearchFieldHeight';
import { HeaderActions } from '../../components/HeaderActions';
import { ToneBadge } from '../../components/orders/StatusBadges';
import FetchCollections from '../../usecases/organization/fetchCollections';
import type { CollectionListItem } from '../../organizationTypes';

const SEARCH_DEBOUNCE_MS = 300;

type PageInfo = { page: number; pageCount: number };

/** The collections: search, title, type, product count, status; Create collection in the header. */
const CollectionListPage = () => {
  const { formatMessage } = useIntl();
  const navigate = useNavigate();
  const basePath = `/plugins/${config.pluginId}/ecommerce/collections`;
  const t = (id: string, values?: Record<string, any>) => formatMessage({ id: getTranslation(id) }, values);
  const p = 'ecommerce.organization.collections';

  const [items, setItems] = useState<CollectionListItem[]>([]);
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
    new FetchCollections()
      .execute({ page, search: search.trim() || undefined })
      .then((data) => {
        if (current !== requestId.current) return;
        setItems(data.results ?? []);
        setPagination({ page: data.pagination?.page ?? page, pageCount: data.pagination?.pageCount ?? 1 });
        setError(false);
        setLoading(false);
      })
      .catch(() => {
        if (current !== requestId.current) return;
        setError(true);
        setLoading(false);
      });
  }, [page, search]);

  const isEmpty = !loading && !error && items.length === 0;
  const noSearch = search === '' && searchTerm === '';
  const create = () => navigate(`${basePath}/new`);

  return (
    <Flex direction="column" alignItems="stretch" gap={4}>
      <HeaderActions>
        <Button variant="secondary" onClick={create}>
          {t(`${p}.create`)}
        </Button>
      </HeaderActions>

      <SearchFieldHeight>
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
            clearLabel={t(`${p}.search.clear`)}
            placeholder={t(`${p}.search.placeholder`)}
          >
            {t(`${p}.search.label`)}
          </Searchbar>
        </SearchForm>
      </SearchFieldHeight>

      {error && <Typography textColor="danger600">{t(`${p}.error`)}</Typography>}

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
          <EmptySection />
          <Typography variant="omega" textColor="neutral600">
            {t(`${p}.empty`)}
          </Typography>
          <Button variant="secondary" onClick={create}>
            {t(`${p}.create`)}
          </Button>
        </Flex>
      )}

      {isEmpty && !noSearch && (
        <Flex justifyContent="center" padding={8} background="neutral0" hasRadius>
          <Typography variant="omega" textColor="neutral600">
            {t(`${p}.noResults`)}
          </Typography>
        </Flex>
      )}

      {items.length > 0 && (
        <>
          <Table colCount={5} rowCount={items.length + 1}>
            <Thead>
              <Tr>
                {(['title', 'type', 'products', 'status'] as const).map((column) => (
                  <Th key={column}>
                    <Typography variant="sigma">{t(`${p}.table.${column}`)}</Typography>
                  </Th>
                ))}
                <Th>
                  <VisuallyHidden>{t(`${p}.table.actions`)}</VisuallyHidden>
                </Th>
              </Tr>
            </Thead>
            <Tbody>
              {items.map((item) => (
                <Tr
                  key={item.id}
                  style={{ opacity: loading ? 0.5 : 1, cursor: 'pointer' }}
                  onClick={() => navigate(`${basePath}/${item.id}`)}
                >
                  <Td style={{ whiteSpace: 'normal' }}>
                    <Typography textColor="neutral800" fontWeight="semiBold" style={{ wordBreak: 'break-word' }}>
                      {item.title || `#${item.id}`}
                    </Typography>
                  </Td>
                  <Td>
                    <ToneBadge variant={item.type === 'AUTOMATED' ? 'primary' : undefined}>
                      {t(`${p}.type.${item.type}`)}
                    </ToneBadge>
                  </Td>
                  <Td>
                    <Typography textColor="neutral800">{item.productCount}</Typography>
                  </Td>
                  <Td>
                    {item.active ? (
                      <ToneBadge variant="success">{t(`${p}.status.active`)}</ToneBadge>
                    ) : (
                      <ToneBadge>{t(`${p}.status.inactive`)}</ToneBadge>
                    )}
                  </Td>
                  <Td onClick={(e: any) => e.stopPropagation()}>
                    <Box style={{ textAlign: 'right' }}>
                      <Button variant="tertiary" size="S" onClick={() => navigate(`${basePath}/${item.id}`)}>
                        {t(`${p}.edit`)}
                      </Button>
                    </Box>
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>

          <ListPagination page={pagination.page} pageCount={pagination.pageCount} onChange={setPage} />
        </>
      )}
    </Flex>
  );
};

export { CollectionListPage };
