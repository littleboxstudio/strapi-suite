import { useEffect, useRef, useState } from 'react';
import { useIntl } from 'react-intl';
import { Box, Flex, Loader, Table, Tbody, Td, Th, Thead, Tr, Typography, VisuallyHidden } from '@strapi/design-system';
import { getTranslation } from '../../../core/utils/getTranslation';
import EmptyNote from '../orders/EmptyNote';
import ListPagination from '../ListPagination';
import PreviewCollection from '../../usecases/organization/previewCollection';
import type { CollectionCondition, CollectionMatch, CollectionPreviewItem } from '../../organizationTypes';

const PREVIEW_DEBOUNCE_MS = 400;
const THUMB = 40;

type Props = {
  /** The parsed conditions, or null while they are not valid. */
  input: { match: CollectionMatch; conditions: CollectionCondition[] } | null;
};

/** The products the conditions select right now (nothing is stored), paginated, with the count. */
const CollectionPreview = ({ input }: Props) => {
  const { formatMessage } = useIntl();
  const t = (id: string, values?: Record<string, any>) => formatMessage({ id: getTranslation(id) }, values);
  const p = 'ecommerce.organization.collection.preview';

  const key = input ? JSON.stringify(input) : '';
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<CollectionPreviewItem[]>([]);
  const [total, setTotal] = useState(0);
  const [pageCount, setPageCount] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const requestId = useRef(0);
  const lastKey = useRef(key);
  /** The conditions changed since the last request: wait for the typing to settle. */
  const debounce = useRef(true);

  useEffect(() => {
    if (!key) {
      requestId.current++;
      setLoading(false);
      return undefined;
    }
    // New conditions start from the first page.
    const changed = lastKey.current !== key;
    lastKey.current = key;
    if (changed) debounce.current = true;
    if (changed && page !== 1) {
      requestId.current++;
      setPage(1);
      return undefined;
    }
    const timer = setTimeout(
      () => {
        debounce.current = false;
        const current = ++requestId.current;
        setLoading(true);
        new PreviewCollection()
          .execute({ ...(JSON.parse(key) as NonNullable<Props['input']>), page })
          .then((data) => {
            if (current !== requestId.current) return;
            setItems(data.results ?? []);
            setTotal(data.pagination?.total ?? 0);
            setPageCount(data.pagination?.pageCount ?? 1);
            setError(false);
            setLoaded(true);
            setLoading(false);
          })
          .catch(() => {
            if (current !== requestId.current) return;
            setError(true);
            setLoading(false);
          });
      },
      debounce.current ? PREVIEW_DEBOUNCE_MS : 0
    );
    return () => {
      clearTimeout(timer);
      // An answer for these conditions / this page arriving later is ignored.
      requestId.current++;
    };
  }, [key, page]);

  return (
    <Flex direction="column" alignItems="stretch" gap={3}>
      <Flex justifyContent="space-between" alignItems="center" gap={3}>
        <Typography variant="sigma" textColor="neutral600">
          {t(`${p}.title`)}
        </Typography>
        {input && loaded && !error && (
          <Flex gap={2} alignItems="center">
            {loading && <Loader small />}
            <Typography variant="pi" fontWeight="bold" textColor="neutral800">
              {t(`${p}.count`, { count: total })}
            </Typography>
          </Flex>
        )}
      </Flex>

      {!input && <EmptyNote>{t(`${p}.invalid`)}</EmptyNote>}
      {input && error && <Typography textColor="danger600">{t(`${p}.error`)}</Typography>}
      {input && !error && !loaded && (
        <Flex justifyContent="center" padding={4}>
          <Loader small />
        </Flex>
      )}
      {input && !error && loaded && items.length === 0 && <EmptyNote>{t(`${p}.empty`)}</EmptyNote>}
      {input && !error && loaded && items.length > 0 && (
        <>
          <Table colCount={2} rowCount={items.length + 1}>
            <Thead>
              <Tr>
                <Th style={{ width: THUMB + 16 }}>
                  <VisuallyHidden>{t('ecommerce.organization.collection.products.columns.image')}</VisuallyHidden>
                </Th>
                <Th>
                  <Typography variant="sigma">{t('ecommerce.organization.collection.products.columns.name')}</Typography>
                </Th>
              </Tr>
            </Thead>
            <Tbody>
              {items.map((item) => (
                <Tr key={item.productId} style={{ opacity: loading ? 0.5 : 1 }}>
                  <Td>
                    <Box
                      hasRadius
                      overflow="hidden"
                      background="neutral150"
                      style={{ width: THUMB, height: THUMB }}
                    >
                      {item.thumbnailUrl && (
                        <img
                          src={item.thumbnailUrl}
                          alt=""
                          width={THUMB}
                          height={THUMB}
                          style={{ objectFit: 'cover', display: 'block' }}
                        />
                      )}
                    </Box>
                  </Td>
                  <Td style={{ whiteSpace: 'normal' }}>
                    <Typography textColor="neutral800" style={{ wordBreak: 'break-word' }}>
                      {item.name || `#${item.productId}`}
                    </Typography>
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
          <ListPagination page={page} pageCount={pageCount} onChange={setPage} />
        </>
      )}
    </Flex>
  );
};

export default CollectionPreview;
