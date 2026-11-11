import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useIntl } from 'react-intl';
import { useNavigate } from 'react-router-dom';
import {
  Badge,
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
import FetchPromotions from '../../usecases/promotions/fetchPromotions';
import EmptySection from '../../illustrations/EmptySection';
import ListPagination from '../../components/ListPagination';
import PromotionTabs from '../../components/promotions/PromotionTabs';
import { usePromotionPermissions } from '../../hooks/usePromotionPermissions';
import { statusTone, usageLabel, validityLabel } from '../../utils/promotionList';
import type { PromotionListItem } from '../../promotionTypes';

const SEARCH_DEBOUNCE_MS = 300;

type PageInfo = { page: number; pageCount: number };

const PromotionListPage = () => {
  const { formatMessage, locale } = useIntl();
  const navigate = useNavigate();
  const { canManage } = usePromotionPermissions();
  const basePath = `/plugins/${config.pluginId}/ecommerce/promotions`;
  const t = (id: string) => formatMessage({ id: getTranslation(id) });

  const [items, setItems] = useState<PromotionListItem[]>([]);
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
    new FetchPromotions()
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

  const isEmpty = !loading && !error && items.length === 0;
  const noSearch = search === '' && searchTerm === '';
  const create = () => navigate(`${basePath}/new`);

  return (
    <Flex direction="column" alignItems="stretch" gap={4}>
      <PromotionTabs />

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
              clearLabel={t('ecommerce.promotions.search.clear')}
              placeholder={t('ecommerce.promotions.search.placeholder')}
            >
              {t('ecommerce.promotions.search.label')}
            </Searchbar>
          </SearchForm>
        </Box>
        {canManage && (
          <Button startIcon={<Plus />} onClick={create}>
            {t('ecommerce.promotions.create')}
          </Button>
        )}
      </Flex>

      {error && <Typography textColor="danger600">{t('ecommerce.promotions.error')}</Typography>}

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
            {t('ecommerce.promotions.empty')}
          </Typography>
          {canManage && <Button onClick={create}>{t('ecommerce.promotions.create')}</Button>}
        </Flex>
      )}

      {isEmpty && !noSearch && (
        <Flex justifyContent="center" padding={8} background="neutral0" hasRadius>
          <Typography variant="omega" textColor="neutral600">
            {t('ecommerce.promotions.noResults')}
          </Typography>
        </Flex>
      )}

      {items.length > 0 && (
        <>
          <Table colCount={7} rowCount={items.length}>
            <Thead>
              <Tr>
                {(['name', 'code', 'method', 'status', 'validity', 'usage'] as const).map((column) => (
                  <Th key={column}>
                    <Typography variant="sigma">{t(`ecommerce.promotions.table.${column}`)}</Typography>
                  </Th>
                ))}
                <Th>
                  <VisuallyHidden>{t('ecommerce.promotions.table.actions')}</VisuallyHidden>
                </Th>
              </Tr>
            </Thead>
            <Tbody>
              {items.map((item) => (
                <Tr key={item.id} style={{ opacity: loading ? 0.5 : 1 }}>
                  <Td>
                    <Typography textColor="neutral800" fontWeight="semiBold">
                      {item.name}
                    </Typography>
                  </Td>
                  <Td>
                    <Typography textColor="neutral800" style={{ fontFamily: 'monospace' }}>
                      {item.code ?? '—'}
                    </Typography>
                  </Td>
                  <Td>
                    <Typography textColor="neutral800">
                      {t(`ecommerce.promotions.methods.${item.method}`)}
                    </Typography>
                  </Td>
                  <Td>
                    <Badge variant={statusTone(item.status)} size="S">
                      {t(`ecommerce.promotions.statuses.${item.status}`)}
                    </Badge>
                  </Td>
                  <Td>
                    <Typography textColor="neutral800">{validityLabel(item, locale)}</Typography>
                  </Td>
                  <Td>
                    <Typography textColor="neutral800">{usageLabel(item)}</Typography>
                  </Td>
                  <Td>
                    <Box style={{ textAlign: 'right' }}>
                      <Button
                        variant="tertiary"
                        size="S"
                        onClick={() => navigate(`${basePath}/${item.id}`)}
                      >
                        {t('ecommerce.promotions.edit')}
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

export { PromotionListPage };
