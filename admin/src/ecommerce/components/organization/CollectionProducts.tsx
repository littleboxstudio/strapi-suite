import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import { useIntl } from 'react-intl';
import { useNotification } from '@strapi/strapi/admin';
import {
  Box,
  Button,
  Flex,
  Loader,
  Popover,
  Table,
  Tbody,
  Td,
  TextInput,
  Th,
  Thead,
  Tr,
  Typography,
  VisuallyHidden,
} from '@strapi/design-system';
import { Drag, Search } from '@strapi/icons';
import { getTranslation } from '../../../core/utils/getTranslation';
import EmptyNote from '../orders/EmptyNote';
import FetchProducts from '../../usecases/fetchProducts';
import FetchCollectionProducts from '../../usecases/organization/fetchCollectionProducts';
import AddCollectionProducts from '../../usecases/organization/addCollectionProducts';
import RemoveCollectionProducts from '../../usecases/organization/removeCollectionProducts';
import ReorderCollectionProducts from '../../usecases/organization/reorderCollectionProducts';
import { organizationErrorMessage, organizationIssues } from '../../utils/organizationErrors';
import type { CollectionProductItem } from '../../organizationTypes';
import type { ProductListItem } from '../../types';

const SEARCH_DEBOUNCE_MS = 300;
/** Pages of members read at most (50 each): the whole list is needed to reorder it. */
const MAX_PAGES = 40;
const THUMB = 40;

type Member = Pick<CollectionProductItem, 'productId' | 'name' | 'thumbnailUrl'>;

/** Moves `id` to `index` (the gallery's drag rule: the dragged row takes the hovered row's place). */
const moveMember = (list: Member[], id: number, index: number): Member[] => {
  const from = list.findIndex((m) => m.productId === id);
  if (from < 0 || index < 0 || from === index) return list;
  const next = [...list];
  const [moved] = next.splice(from, 1);
  next.splice(index, 0, moved);
  return next;
};

const sameOrder = (a: Member[], b: Member[]) =>
  a.length === b.length && a.every((m, i) => m.productId === b[i].productId);

const Thumbnail = ({ url }: { url: string | null }) => (
  <Box
    hasRadius
    overflow="hidden"
    background="neutral150"
    style={{ width: THUMB, height: THUMB, flexShrink: 0 }}
  >
    {url && (
      <img
        src={url}
        alt=""
        width={THUMB}
        height={THUMB}
        draggable={false}
        style={{ objectFit: 'cover', display: 'block' }}
      />
    )}
  </Box>
);

type Props = {
  collectionId: number;
  /** Shown under the table when the storefront does not use the manual order. */
  manualSort: boolean;
  /** The member count changed (added / removed). */
  onCountChange?: (count: number) => void;
};

/**
 * A manual collection's products: a search (floating list) adds whole products, the table lists
 * them in their manual order (drag a row onto another to move it; saved at once) with Remove.
 */
const CollectionProducts = ({ collectionId, manualSort, onCountChange }: Props) => {
  const { formatMessage } = useIntl();
  const { toggleNotification } = useNotification();
  const t = (id: string, values?: Record<string, any>) => formatMessage({ id: getTranslation(id) }, values);
  const p = 'ecommerce.organization.collection.products';

  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Search
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<ProductListItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [searched, setSearched] = useState(false);
  const [open, setOpen] = useState(false);
  const requestId = useRef(0);
  const anchorRef = useRef<HTMLDivElement>(null);

  // Drag
  const [dragId, setDragId] = useState<number | null>(null);
  const [preview, setPreview] = useState<Member[] | null>(null);
  const shown = preview ?? members;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const all: CollectionProductItem[] = [];
      let page = 1;
      let pageCount = 1;
      do {
        const data = await new FetchCollectionProducts().execute(collectionId, { page });
        all.push(...(data.results ?? []));
        pageCount = data.pagination?.pageCount ?? 1;
        page += 1;
      } while (page <= pageCount && page <= MAX_PAGES);
      // The manual order, whatever the collection's sorting.
      const sorted = [...all].sort((a, b) => a.position - b.position);
      setMembers(sorted.map(({ productId, name, thumbnailUrl }) => ({ productId, name, thumbnailUrl })));
      setLoadError(false);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [collectionId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const q = term.trim();
    if (!q) {
      requestId.current++;
      setResults([]);
      setSearching(false);
      setSearched(false);
      setSearchError(false);
      return undefined;
    }
    const timer = setTimeout(() => {
      const current = ++requestId.current;
      setSearching(true);
      new FetchProducts()
        .execute({ page: 1, search: q })
        .then((data) => {
          if (current !== requestId.current) return;
          setResults(data.results ?? []);
          setSearchError(false);
          setSearched(true);
          setSearching(false);
        })
        .catch(() => {
          if (current !== requestId.current) return;
          setSearchError(true);
          setSearching(false);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [term]);

  const failure = (err: unknown, fallback: string) => {
    const message = organizationErrorMessage(err);
    const issue = organizationIssues(err)[0];
    if (message) setError(t(message.id, message.values));
    else if (issue?.code === 'not_permutation') setError(t('ecommerce.organization.errors.not_permutation'));
    else setError(t(fallback));
  };

  const memberIds = new Set(members.map((m) => m.productId));

  const add = async (product: ProductListItem) => {
    if (busy || memberIds.has(product.id)) return;
    setBusy(true);
    setError(null);
    try {
      await new AddCollectionProducts().execute(collectionId, [product.id]);
      // Added last (as the server does).
      const next = [...members, { productId: product.id, name: product.name, thumbnailUrl: product.thumbnailUrl }];
      setMembers(next);
      onCountChange?.(next.length);
      toggleNotification({ type: 'success', message: t(`${p}.added`) });
    } catch (err) {
      failure(err, `${p}.changeError`);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (member: Member) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await new RemoveCollectionProducts().execute(collectionId, [member.productId]);
      const next = members.filter((m) => m.productId !== member.productId);
      setMembers(next);
      onCountChange?.(next.length);
      toggleNotification({ type: 'success', message: t(`${p}.removed`) });
    } catch (err) {
      failure(err, `${p}.changeError`);
    } finally {
      setBusy(false);
    }
  };

  const saveOrder = async (next: Member[]) => {
    const previous = members;
    setMembers(next);
    setBusy(true);
    setError(null);
    try {
      await new ReorderCollectionProducts().execute(
        collectionId,
        next.map((m) => m.productId)
      );
    } catch (err) {
      setMembers(previous);
      failure(err, `${p}.reorderError`);
    } finally {
      setBusy(false);
    }
  };

  const endDrag = () => {
    setDragId(null);
    setPreview(null);
  };
  const onDragStart = (e: DragEvent, id: number) => {
    e.dataTransfer.effectAllowed = 'move';
    // Firefox starts a drag only with some data set.
    e.dataTransfer.setData('text/plain', String(id));
    setDragId(id);
    setPreview(members);
  };
  const onDragOver = (e: DragEvent, overId: number) => {
    if (dragId === null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (overId === dragId) return;
    const base = preview ?? members;
    setPreview(moveMember(base, dragId, base.findIndex((m) => m.productId === overId)));
  };
  const onDrop = (e: DragEvent) => {
    if (dragId === null) return;
    e.preventDefault();
    const next = preview;
    endDrag();
    if (next && !sameOrder(next, members)) void saveOrder(next);
  };

  const canDrag = members.length > 1 && !busy;
  const hasContent = searching || searchError || searched || results.length > 0;
  const popoverOpen = open && !!term.trim() && hasContent;

  return (
    <Flex direction="column" alignItems="stretch" gap={3}>
      <Popover.Root open={popoverOpen} onOpenChange={setOpen}>
        <Popover.Anchor ref={anchorRef}>
          <TextInput
            aria-label={t(`${p}.search`)}
            startAction={<Search />}
            placeholder={t(`${p}.placeholder`)}
            value={term}
            autoComplete="off"
            aria-haspopup="listbox"
            aria-expanded={popoverOpen}
            style={{ height: 38 }}
            onChange={(e: any) => {
              setTerm(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
          />
        </Popover.Anchor>
        <Popover.Content
          align="start"
          sideOffset={4}
          // Typing stays in the search field: the dropdown never takes the focus.
          onOpenAutoFocus={(e: Event) => e.preventDefault()}
          onInteractOutside={(e: any) => {
            if (anchorRef.current?.contains(e.target as Node)) e.preventDefault();
          }}
          style={{
            width: 'var(--radix-popover-trigger-width, var(--radix-popper-anchor-width))',
            minWidth: 320,
          }}
        >
          <Box style={{ maxHeight: 320, overflowY: 'auto' }} role="listbox">
            {searching && results.length === 0 && (
              <Flex justifyContent="center" padding={3}>
                <Loader small />
              </Flex>
            )}
            {searchError && (
              <Box padding={3}>
                <Typography textColor="danger600">{t(`${p}.searchError`)}</Typography>
              </Box>
            )}
            {!searching && searched && !searchError && results.length === 0 && (
              <Box padding={3}>
                <Typography variant="omega" textColor="neutral600">
                  {t(`${p}.noResults`)}
                </Typography>
              </Box>
            )}
            {results.map((r, i) => {
              const inCollection = memberIds.has(r.id);
              return (
                <Flex
                  key={r.id}
                  role="option"
                  aria-selected={inCollection}
                  justifyContent="space-between"
                  alignItems="center"
                  gap={3}
                  paddingTop={2}
                  paddingBottom={2}
                  paddingLeft={3}
                  paddingRight={3}
                  // Strapi's row divider: 1px in the theme's border colour (light and dark).
                  borderColor="neutral150"
                  style={{
                    opacity: searching ? 0.5 : 1,
                    borderStyle: 'solid',
                    borderWidth: i > 0 ? '1px 0 0 0' : 0,
                  }}
                >
                  <Flex gap={3} alignItems="center" style={{ minWidth: 0, flex: 1 }}>
                    <Thumbnail url={r.thumbnailUrl} />
                    <Flex direction="column" alignItems="flex-start" style={{ minWidth: 0 }}>
                      <Typography
                        textColor="neutral800"
                        fontWeight="semiBold"
                        style={{ whiteSpace: 'normal', wordBreak: 'break-word' }}
                      >
                        {r.name}
                      </Typography>
                      {r.skus?.length > 0 && (
                        <Typography variant="pi" textColor="neutral600">
                          {r.skus.join(', ')}
                        </Typography>
                      )}
                    </Flex>
                  </Flex>
                  <Button
                    size="S"
                    variant="secondary"
                    disabled={busy || inCollection}
                    onClick={() => add(r)}
                  >
                    {t(inCollection ? `${p}.inCollection` : `${p}.add`)}
                  </Button>
                </Flex>
              );
            })}
          </Box>
        </Popover.Content>
      </Popover.Root>

      {loading && (
        <Flex justifyContent="center" padding={4}>
          <Loader small />
        </Flex>
      )}
      {!loading && loadError && <Typography textColor="danger600">{t(`${p}.loadError`)}</Typography>}
      {!loading && !loadError && members.length === 0 && <EmptyNote>{t(`${p}.empty`)}</EmptyNote>}

      {!loading && !loadError && members.length > 0 && (
        <Table colCount={4} rowCount={shown.length + 1}>
          <Thead>
            <Tr>
              <Th style={{ width: 40 }}>
                <VisuallyHidden>{t(`${p}.columns.order`)}</VisuallyHidden>
              </Th>
              <Th style={{ width: THUMB + 16 }}>
                <VisuallyHidden>{t(`${p}.columns.image`)}</VisuallyHidden>
              </Th>
              <Th>
                <Typography variant="sigma">{t(`${p}.columns.name`)}</Typography>
              </Th>
              <Th>
                <Flex justifyContent="flex-end" style={{ width: '100%' }}>
                  <Typography variant="sigma">{t(`${p}.columns.actions`)}</Typography>
                </Flex>
              </Th>
            </Tr>
          </Thead>
          <Tbody>
            {shown.map((m) => (
              <Tr
                key={m.productId}
                draggable={canDrag}
                onDragStart={(e: DragEvent) => onDragStart(e, m.productId)}
                onDragOver={(e: DragEvent) => onDragOver(e, m.productId)}
                onDrop={onDrop}
                onDragEnd={endDrag}
                style={{ opacity: m.productId === dragId ? 0.5 : 1 }}
              >
                <Td>
                  <Box
                    aria-label={t(`${p}.drag`, { name: m.name })}
                    title={t(`${p}.drag`, { name: m.name })}
                    style={{ cursor: canDrag ? 'grab' : 'default', display: 'flex' }}
                  >
                    <Drag fill={canDrag ? 'neutral600' : 'neutral300'} />
                  </Box>
                </Td>
                <Td>
                  <Thumbnail url={m.thumbnailUrl} />
                </Td>
                <Td style={{ whiteSpace: 'normal' }}>
                  <Typography textColor="neutral800" style={{ wordBreak: 'break-word' }}>
                    {m.name || `#${m.productId}`}
                  </Typography>
                </Td>
                <Td>
                  <Flex justifyContent="flex-end">
                    <Button
                      size="S"
                      variant="danger-light"
                      disabled={busy}
                      aria-label={t(`${p}.removeLabel`, { name: m.name })}
                      onClick={() => remove(m)}
                    >
                      {t(`${p}.remove`)}
                    </Button>
                  </Flex>
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      )}

      {!loading && members.length > 1 && (
        <Typography variant="pi" textColor="neutral600">
          {t(`${p}.reorderHint`)}
          {!manualSort && ` ${t(`${p}.orderNotUsed`)}`}
        </Typography>
      )}
      {error && (
        <Typography variant="pi" textColor="danger600" role="alert">
          {error}
        </Typography>
      )}
    </Flex>
  );
};

export default CollectionProducts;
