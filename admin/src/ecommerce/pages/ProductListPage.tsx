import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useIntl } from 'react-intl';
import { useNavigate } from 'react-router-dom';
import {
  Badge,
  Box,
  Button,
  Dots,
  Flex,
  Loader,
  NextLink,
  PageLink,
  Pagination,
  PreviousLink,
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
import config from '../../core/config';
import { getTranslation } from '../../core/utils/getTranslation';
import FetchProducts from '../usecases/fetchProducts';
import FetchEcommerceLocales from '../usecases/fetchEcommerceLocales';
import EmptyProducts from '../illustrations/EmptyProducts';
import { formatCents } from '../utils/money';
import { pageWindow } from '../utils/pagination';
import type { ProductListItem } from '../types';

const SEARCH_DEBOUNCE_MS = 300;
const THUMBNAIL_SIZE = 36;

type PageInfo = { page: number; pageCount: number };

const ProductListPage = () => {
  const { formatMessage, locale: uiLocale } = useIntl();
  const navigate = useNavigate();
  const basePath = `/plugins/${config.pluginId}/ecommerce/products`;
  const t = (id: string) => formatMessage({ id: getTranslation(id) });

  const [items, setItems] = useState<ProductListItem[]>([]);
  const [pagination, setPagination] = useState<PageInfo>({ page: 1, pageCount: 1 });
  const [page, setPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');
  const [search, setSearch] = useState('');
  const [defaultLocale, setDefaultLocale] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const requestId = useRef(0);

  useEffect(() => {
    new FetchEcommerceLocales()
      .execute()
      .then((data) => setDefaultLocale(data.defaultLocale))
      .catch(() => setError(true));
  }, []);

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
    if (!defaultLocale) return;
    const current = ++requestId.current;
    setLoading(true);
    new FetchProducts()
      .execute({ page, search: search || undefined, locale: defaultLocale })
      .then((data) => {
        if (current !== requestId.current) return;
        setItems(data.results);
        setPagination({
          page: data.pagination.page ?? page,
          pageCount: data.pagination.pageCount ?? 1,
        });
        setError(false);
        setLoading(false);
      })
      .catch(() => {
        if (current !== requestId.current) return;
        setError(true);
        setLoading(false);
      });
  }, [defaultLocale, page, search]);

  const goToCreate = () => navigate(`${basePath}/new`);
  const goToEdit = (id: number) => navigate(`${basePath}/${id}`);
  const isEmpty = !loading && !error && items.length === 0;
  const noSearch = search === '' && searchTerm === '';

  const createButton = (label: string) => (
    <Button size="S" startIcon={<Plus />} onClick={goToCreate}>
      {label}
    </Button>
  );

  const priceLabel = (item: ProductListItem) =>
    item.priceMin === item.priceMax
      ? formatCents(item.priceMin, uiLocale)
      : `${formatCents(item.priceMin, uiLocale)} – ${formatCents(item.priceMax, uiLocale)}`;

  const skuLabel = (item: ProductListItem) =>
    item.skus.length > 1 ? `${item.skus[0]} +${item.skus.length - 1}` : (item.skus[0] ?? '');

  const pageLinkProps = (target: number) => ({
    href: '#',
    onClick: (e: React.MouseEvent) => {
      e.preventDefault();
      setPage(target);
    },
  });

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
              clearLabel={t('ecommerce.products.search.clear')}
              placeholder={t('ecommerce.products.search.placeholder')}
            >
              {t('ecommerce.products.search.label')}
            </Searchbar>
          </SearchForm>
        </Box>
        {createButton(t('ecommerce.products.create'))}
      </Flex>

      {error && <Typography textColor="danger600">{t('ecommerce.products.error')}</Typography>}

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
          <EmptyProducts />
          <Typography variant="omega" textColor="neutral600">
            {t('ecommerce.products.empty')}
          </Typography>
          <Button startIcon={<Plus />} onClick={goToCreate}>
            {t('ecommerce.products.createFirst')}
          </Button>
        </Flex>
      )}

      {isEmpty && !noSearch && (
        <Flex justifyContent="center" padding={8} background="neutral0" hasRadius>
          <Typography variant="omega" textColor="neutral600">
            {t('ecommerce.products.noResults')}
          </Typography>
        </Flex>
      )}

      {items.length > 0 && (
        <>
          <Table colCount={6} rowCount={items.length}>
            <Thead>
              <Tr>
                <Th>
                  <VisuallyHidden>{t('ecommerce.products.table.image')}</VisuallyHidden>
                </Th>
                <Th>
                  <Typography variant="sigma">{t('ecommerce.products.table.name')}</Typography>
                </Th>
                <Th>
                  <Typography variant="sigma">{t('ecommerce.products.table.sku')}</Typography>
                </Th>
                <Th>
                  <Typography variant="sigma">{t('ecommerce.products.table.price')}</Typography>
                </Th>
                <Th>
                  <Typography variant="sigma">{t('ecommerce.products.table.stock')}</Typography>
                </Th>
                <Th>
                  <VisuallyHidden>{t('ecommerce.products.table.actions')}</VisuallyHidden>
                </Th>
              </Tr>
            </Thead>
            <Tbody>
              {items.map((item) => (
                <Tr key={item.id} style={{ opacity: loading ? 0.5 : 1 }}>
                  <Td>
                    {item.thumbnailUrl ? (
                      <img
                        src={item.thumbnailUrl}
                        alt=""
                        width={THUMBNAIL_SIZE}
                        height={THUMBNAIL_SIZE}
                        style={{ objectFit: 'cover', borderRadius: '4px', display: 'block' }}
                      />
                    ) : (
                      <Box
                        background="neutral150"
                        hasRadius
                        style={{ width: THUMBNAIL_SIZE, height: THUMBNAIL_SIZE }}
                      />
                    )}
                  </Td>
                  <Td>
                    <Typography textColor="neutral800">{item.name}</Typography>
                  </Td>
                  <Td>
                    <Typography textColor="neutral800">{skuLabel(item)}</Typography>
                  </Td>
                  <Td>
                    <Typography textColor="neutral800">{priceLabel(item)}</Typography>
                  </Td>
                  <Td>
                    <Flex gap={2}>
                      <Typography textColor="neutral800">{item.stockTotal}</Typography>
                      {item.hasNegativeStock && (
                        <Badge backgroundColor="danger100" textColor="danger700">
                          {t('ecommerce.products.negativeStock')}
                        </Badge>
                      )}
                    </Flex>
                  </Td>
                  <Td>
                    <Flex justifyContent="flex-end">
                      <Button variant="tertiary" size="S" onClick={() => goToEdit(item.id)}>
                        {t('ecommerce.products.edit')}
                      </Button>
                    </Flex>
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>

          {pagination.pageCount > 1 && (
            <Flex justifyContent="flex-end">
              <Pagination activePage={pagination.page} pageCount={pagination.pageCount}>
                <PreviousLink {...pageLinkProps(Math.max(1, pagination.page - 1))}>
                  {t('ecommerce.products.pagination.previous')}
                </PreviousLink>
                {pageWindow(pagination.page, pagination.pageCount).map((p, i) =>
                  p === null ? (
                    <Dots key={`dots-${i}`} />
                  ) : (
                    <PageLink key={p} number={p} {...pageLinkProps(p)}>
                      {formatMessage(
                        { id: getTranslation('ecommerce.products.pagination.goTo') },
                        { page: p }
                      )}
                    </PageLink>
                  )
                )}
                <NextLink {...pageLinkProps(Math.min(pagination.pageCount, pagination.page + 1))}>
                  {t('ecommerce.products.pagination.next')}
                </NextLink>
              </Pagination>
            </Flex>
          )}
        </>
      )}
    </Flex>
  );
};

export { ProductListPage };
