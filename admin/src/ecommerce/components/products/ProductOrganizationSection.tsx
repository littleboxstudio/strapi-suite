import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useIntl } from 'react-intl';
import {
  Box,
  Button,
  Field,
  Flex,
  Grid,
  Loader,
  Popover,
  Tag,
  TextInput,
  Typography,
} from '@strapi/design-system';
import { Cross, Search } from '@strapi/icons';
import { getTranslation } from '../../../core/utils/getTranslation';
import FetchCategoryTree from '../../usecases/organization/fetchCategoryTree';
import FetchProductTypes from '../../usecases/organization/fetchProductTypes';
import FetchTags from '../../usecases/organization/fetchTags';
import FetchCollections from '../../usecases/organization/fetchCollections';
import { flattenTree, pathLabel } from '../../utils/categoryTree';
import { addTag, type OrganizationField, type ProductOrganization } from '../../utils/productForm';
import type { CategoryTreeNode } from '../../organizationTypes';
import { ToneBadge } from '../orders/StatusBadges';
import EmptyNote from '../orders/EmptyNote';

const SEARCH_DEBOUNCE_MS = 300;
const P = 'ecommerce.product.organization';

type Props = {
  value: ProductOrganization;
  onChange: (next: ProductOrganization) => void;
  /** Translated error per field (from the server or the client checks). */
  errors: Partial<Record<OrganizationField, string>>;
  /** A field was edited: its error can be cleared. */
  onFieldEdit: (field: OrganizationField) => void;
  /** Names of categories and types are shown in the default locale (as the product detail). */
  defaultLocale: string;
  /** New product: automated collections are only known after the first save. */
  isNew: boolean;
  disabled?: boolean;
};

// ------------------------------------------------------------------ shared search plumbing

type RemoteState<T> = { results: T[]; loading: boolean; error: boolean; searched: boolean };

/**
 * Debounced search while `enabled` (the dropdown is open); the latest request wins. An empty term
 * lists the first results.
 */
function useRemoteOptions<T>(
  enabled: boolean,
  term: string,
  load: (search: string) => Promise<T[]>
): RemoteState<T> {
  const [state, setState] = useState<RemoteState<T>>({
    results: [],
    loading: false,
    error: false,
    searched: false,
  });
  const requestId = useRef(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    if (!enabled) {
      requestId.current++;
      return undefined;
    }
    const timer = setTimeout(() => {
      const current = ++requestId.current;
      setState((s) => ({ ...s, loading: true }));
      loadRef
        .current(term.trim())
        .then((results) => {
          if (current !== requestId.current) return;
          setState({ results, loading: false, error: false, searched: true });
        })
        .catch(() => {
          if (current !== requestId.current) return;
          setState((s) => ({ ...s, loading: false, error: true }));
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [enabled, term]);

  return state;
}

type OptionRow = { key: string; content: ReactNode; onPick: () => void };

/** Arrow keys move the highlight; Enter picks it (or calls `onEnter` when nothing is highlighted). */
function useHighlight(rows: OptionRow[]) {
  const [active, setActive] = useState(-1);
  useEffect(() => {
    if (active >= rows.length) setActive(rows.length - 1);
  }, [rows.length, active]);
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>, onEnter?: () => void) => {
    if (e.key === 'ArrowDown' && rows.length) {
      e.preventDefault();
      setActive((i) => (i + 1) % rows.length);
    } else if (e.key === 'ArrowUp' && rows.length) {
      e.preventDefault();
      setActive((i) => (i <= 0 ? rows.length - 1 : i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (active >= 0 && rows[active]) rows[active].onPick();
      else onEnter?.();
      setActive(-1);
    }
  };
  return { active, setActive, onKeyDown };
}

/**
 * The floating list under a search input (as the promotions' product picker): `neutral150` row
 * separators; rows keep the focus in the input (mousedown is cancelled) so typing continues.
 */
const OptionsPopover = ({
  open,
  onClose,
  anchor,
  rows,
  active,
  loading,
  error,
  emptyText,
}: {
  open: boolean;
  onClose: () => void;
  anchor: ReactNode;
  rows: OptionRow[];
  active: number;
  loading: boolean;
  error: boolean;
  /** Shown when the search answered with nothing to pick (none: the list stays closed). */
  emptyText?: string;
}) => {
  const { formatMessage } = useIntl();
  const anchorRef = useRef<HTMLDivElement>(null);
  const showEmpty = !loading && !error && rows.length === 0 && !!emptyText;
  const hasContent = rows.length > 0 || loading || error || showEmpty;
  return (
    <Popover.Root open={open && hasContent} onOpenChange={(next: boolean) => !next && onClose()}>
      <Popover.Anchor ref={anchorRef}>{anchor}</Popover.Anchor>
      <Popover.Content
        align="start"
        sideOffset={4}
        onOpenAutoFocus={(e: Event) => e.preventDefault()}
        onInteractOutside={(e: any) => {
          if (anchorRef.current?.contains(e.target as Node)) e.preventDefault();
        }}
        style={{
          width: 'var(--radix-popover-trigger-width, var(--radix-popper-anchor-width))',
          minWidth: 240,
        }}
      >
        <Box style={{ maxHeight: 280, overflowY: 'auto' }} role="listbox">
          {loading && rows.length === 0 && (
            <Flex justifyContent="center" padding={3}>
              <Loader small />
            </Flex>
          )}
          {error && (
            <Box padding={3}>
              <Typography textColor="danger600">
                {formatMessage({ id: getTranslation('ecommerce.organization.loadError') })}
              </Typography>
            </Box>
          )}
          {showEmpty && (
            <Box padding={3}>
              <Typography variant="omega" textColor="neutral600">
                {emptyText}
              </Typography>
            </Box>
          )}
          {rows.map((row, i) => (
            <Box
              key={row.key}
              role="option"
              aria-selected={i === active}
              paddingTop={2}
              paddingBottom={2}
              paddingLeft={3}
              paddingRight={3}
              background={i === active ? 'primary100' : undefined}
              borderColor="neutral150"
              onMouseDown={(e: any) => e.preventDefault()}
              onClick={row.onPick}
              style={{
                cursor: 'pointer',
                opacity: loading ? 0.6 : 1,
                borderStyle: 'solid',
                borderWidth: i > 0 ? '1px 0 0 0' : 0,
              }}
            >
              {row.content}
            </Box>
          ))}
        </Box>
      </Popover.Content>
    </Popover.Root>
  );
};

const RowText = ({ children, sub }: { children: ReactNode; sub?: ReactNode }) => (
  <Flex direction="column" alignItems="flex-start">
    <Typography textColor="neutral800" style={{ whiteSpace: 'normal', wordBreak: 'break-word' }}>
      {children}
    </Typography>
    {sub && (
      <Typography variant="pi" textColor="neutral600">
        {sub}
      </Typography>
    )}
  </Flex>
);

const sameName = (a: string, b: string) =>
  a.trim().replace(/\s+/g, ' ').toLowerCase() === b.trim().replace(/\s+/g, ' ').toLowerCase();

// ------------------------------------------------------------------ category

const CategoryField = ({
  value,
  onChange,
  error,
  defaultLocale,
  disabled,
}: {
  value: ProductOrganization['category'];
  onChange: (category: ProductOrganization['category']) => void;
  error?: string;
  defaultLocale: string;
  disabled?: boolean;
}) => {
  const { formatMessage } = useIntl();
  const t = (id: string, values?: Record<string, any>) =>
    formatMessage({ id: getTranslation(id) }, values);
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const [tree, setTree] = useState<CategoryTreeNode[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const load = () => {
    if (loading) return;
    setLoading(true);
    setLoadError(false);
    new FetchCategoryTree()
      .execute(defaultLocale)
      .then(setTree)
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  };

  const openPicker = (next: boolean) => {
    setOpen(next);
    if (next) {
      setTerm('');
      // Always fresh: categories may have been edited in another tab.
      load();
    }
  };

  const rows = useMemo(() => {
    if (!tree) return [];
    const flat = flattenTree(tree);
    const q = term.trim().toLowerCase();
    if (!q) return flat.map((r) => ({ node: r.node, depth: r.depth, label: r.node.name }));
    return flat
      .filter((r) => r.node.name.toLowerCase().includes(q))
      .map((r) => ({ node: r.node, depth: 0, label: pathLabel(tree, r.node.id) }));
  }, [tree, term]);

  const choose = (node: CategoryTreeNode) => {
    onChange({ id: node.id, path: tree ? pathLabel(tree, node.id) : node.name });
    setOpen(false);
  };

  return (
    <Field.Root name="category" error={error}>
      <Field.Label>{t(`${P}.category`)}</Field.Label>
      <Flex
        gap={2}
        alignItems="center"
        justifyContent="space-between"
        paddingLeft={4}
        paddingRight={2}
        hasRadius
        borderColor={error ? 'danger600' : 'neutral200'}
        background="neutral0"
        style={{ minHeight: 40, borderStyle: 'solid', borderWidth: 1 }}
      >
        <Typography
          textColor={value ? 'neutral800' : 'neutral500'}
          style={{ minWidth: 0, wordBreak: 'break-word', paddingTop: 6, paddingBottom: 6 }}
        >
          {value ? value.path || `#${value.id}` : t(`${P}.category.none`)}
        </Typography>
        <Flex gap={1} shrink={0}>
          <Popover.Root open={open} onOpenChange={openPicker}>
            <Popover.Trigger>
              <Button size="S" variant="tertiary" disabled={disabled}>
                {t(value ? `${P}.category.change` : `${P}.category.choose`)}
              </Button>
            </Popover.Trigger>
            <Popover.Content align="end" sideOffset={4} style={{ width: 360, maxWidth: '90vw' }}>
              <Box padding={2}>
                <TextInput
                  aria-label={t(`${P}.category.search`)}
                  placeholder={t(`${P}.category.search`)}
                  startAction={<Search />}
                  value={term}
                  autoComplete="off"
                  autoFocus
                  style={{ height: 38 }}
                  onChange={(e: any) => setTerm(e.target.value)}
                  onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
                    // Enter picks the only match.
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      if (term.trim() && rows.length === 1) choose(rows[0].node);
                    }
                  }}
                />
              </Box>
              <Box style={{ maxHeight: 320, overflowY: 'auto' }} role="listbox">
                {loading && !tree && (
                  <Flex justifyContent="center" padding={3}>
                    <Loader small />
                  </Flex>
                )}
                {loadError && (
                  <Box padding={3}>
                    <Typography textColor="danger600">
                      {t('ecommerce.organization.loadError')}
                    </Typography>
                  </Box>
                )}
                {tree && rows.length === 0 && (
                  <Box padding={3}>
                    <Typography variant="omega" textColor="neutral600">
                      {t(tree.length === 0 ? `${P}.category.empty` : `${P}.noResults`)}
                    </Typography>
                  </Box>
                )}
                {rows.map((row, i) => (
                  <Box
                    key={row.node.id}
                    role="option"
                    aria-selected={row.node.id === value?.id}
                    paddingTop={2}
                    paddingBottom={2}
                    paddingRight={3}
                    paddingLeft={3}
                    background={row.node.id === value?.id ? 'primary100' : undefined}
                    borderColor="neutral150"
                    onClick={() => choose(row.node)}
                    style={{
                      cursor: 'pointer',
                      borderStyle: 'solid',
                      borderWidth: i > 0 ? '1px 0 0 0' : 0,
                    }}
                  >
                    <Flex gap={2} style={{ paddingLeft: row.depth * 20 }}>
                      <Typography
                        textColor="neutral800"
                        fontWeight={row.depth === 0 && !term.trim() ? 'semiBold' : undefined}
                        style={{ whiteSpace: 'normal', wordBreak: 'break-word' }}
                      >
                        {row.label}
                      </Typography>
                      {!row.node.active && (
                        <ToneBadge>{t(`${P}.category.inactive`)}</ToneBadge>
                      )}
                    </Flex>
                  </Box>
                ))}
              </Box>
            </Popover.Content>
          </Popover.Root>
          {value && (
            <Button
              size="S"
              variant="danger-light"
              disabled={disabled}
              onClick={() => onChange(null)}
            >
              {t(`${P}.remove`)}
            </Button>
          )}
        </Flex>
      </Flex>
      <Field.Error />
    </Field.Root>
  );
};

// ------------------------------------------------------------------ product type

const ProductTypeField = ({
  value,
  onChange,
  error,
  defaultLocale,
  disabled,
}: {
  value: ProductOrganization['productType'];
  onChange: (type: ProductOrganization['productType']) => void;
  error?: string;
  defaultLocale: string;
  disabled?: boolean;
}) => {
  const { formatMessage } = useIntl();
  const t = (id: string, values?: Record<string, any>) =>
    formatMessage({ id: getTranslation(id) }, values);
  const [term, setTerm] = useState(value?.name ?? '');
  const [open, setOpen] = useState(false);

  // The page reloads the product after a save: show the stored name.
  useEffect(() => setTerm(value?.name ?? ''), [value?.id, value?.name]);

  const search = useRemoteOptions(open, term === value?.name ? '' : term, (q) =>
    new FetchProductTypes()
      .execute({ search: q || undefined, locale: defaultLocale })
      .then((page) => page.results.map(({ id, name }) => ({ id, name })))
  );

  const pick = (type: ProductOrganization['productType']) => {
    onChange(type);
    setTerm(type?.name ?? '');
    setOpen(false);
  };

  const typed = term.trim().replace(/\s+/g, ' ');
  const exact = search.results.find((r) => sameName(r.name, typed));
  const rows: OptionRow[] = search.results.map((r) => ({
    key: `t-${r.id}`,
    content: <RowText>{r.name}</RowText>,
    onPick: () => pick({ id: r.id, name: r.name }),
  }));
  if (typed && !exact && !search.loading && typed !== value?.name) {
    rows.push({
      key: 'create',
      content: <RowText>{t(`${P}.productType.create`, { name: typed })}</RowText>,
      onPick: () => pick({ name: typed }),
    });
  }
  const highlight = useHighlight(rows);

  const close = () => {
    setOpen(false);
    // Leaving without picking keeps the chosen type.
    setTerm(value?.name ?? '');
  };

  const isNewType = !!value && value.id === undefined;

  return (
    <Field.Root
      name="productType"
      error={error}
      hint={isNewType ? t(`${P}.productType.new`) : undefined}
    >
      <Field.Label>{t(`${P}.productType`)}</Field.Label>
      <OptionsPopover
        open={open}
        onClose={close}
        rows={rows}
        active={highlight.active}
        loading={search.loading}
        error={search.error}
        emptyText={search.searched ? t(`${P}.productType.empty`) : undefined}
        anchor={
          <TextInput
            value={term}
            placeholder={t(`${P}.productType.placeholder`)}
            autoComplete="off"
            disabled={disabled}
            aria-haspopup="listbox"
            aria-expanded={open}
            onChange={(e: any) => {
              setTerm(e.target.value);
              setOpen(true);
              highlight.setActive(-1);
            }}
            onFocus={() => setOpen(true)}
            onBlur={close}
            onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
              if (e.key === 'Escape') close();
              else
                highlight.onKeyDown(e, () => {
                  if (!typed) pick(null);
                  else if (exact) pick(exact);
                  else if (typed !== value?.name) pick({ name: typed });
                });
            }}
            endAction={
              value ? (
                <Field.Action
                  label={t(`${P}.productType.clear`)}
                  onClick={() => pick(null)}
                  disabled={disabled}
                >
                  <Cross />
                </Field.Action>
              ) : undefined
            }
          />
        }
      />
      <Field.Error />
      <Field.Hint />
    </Field.Root>
  );
};

// ------------------------------------------------------------------ collections

const CollectionsField = ({
  value,
  automated,
  onChange,
  error,
  defaultLocale,
  isNew,
  disabled,
}: {
  value: ProductOrganization['collections'];
  automated: ProductOrganization['automatedCollections'];
  onChange: (collections: ProductOrganization['collections']) => void;
  error?: string;
  defaultLocale: string;
  isNew: boolean;
  disabled?: boolean;
}) => {
  const { formatMessage } = useIntl();
  const t = (id: string, values?: Record<string, any>) =>
    formatMessage({ id: getTranslation(id) }, values);
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);
  const search = useRemoteOptions(open, term, (q) =>
    new FetchCollections()
      .execute({ search: q || undefined, locale: defaultLocale })
      .then((page) => page.results.filter((c) => c.type === 'MANUAL'))
  );
  const chosen = new Set(value.map((c) => c.id));
  const rows: OptionRow[] = search.results
    .filter((c) => !chosen.has(c.id))
    .map((c) => ({
      key: `c-${c.id}`,
      content: <RowText sub={c.handle}>{c.title}</RowText>,
      onPick: () => {
        onChange([...value, { id: c.id, title: c.title }]);
        setTerm('');
      },
    }));
  const highlight = useHighlight(rows);

  return (
    <Field.Root name="collections" error={error}>
      <Field.Label>{t(`${P}.collections`)}</Field.Label>
      <Flex direction="column" alignItems="stretch" gap={2}>
        <OptionsPopover
          open={open}
          onClose={() => setOpen(false)}
          rows={rows}
          active={highlight.active}
          loading={search.loading}
          error={search.error}
          emptyText={search.searched ? t(`${P}.collections.noResults`) : undefined}
          anchor={
            <TextInput
              aria-label={t(`${P}.collections.search`)}
              placeholder={t(`${P}.collections.search`)}
              startAction={<Search />}
              value={term}
              autoComplete="off"
              disabled={disabled}
              aria-haspopup="listbox"
              aria-expanded={open}
              style={{ height: 38 }}
              onChange={(e: any) => {
                setTerm(e.target.value);
                setOpen(true);
                highlight.setActive(-1);
              }}
              onFocus={() => setOpen(true)}
              onBlur={() => setOpen(false)}
              onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
                if (e.key === 'Escape') setOpen(false);
                else highlight.onKeyDown(e);
              }}
            />
          }
        />
        {value.length === 0 && automated.length === 0 ? (
          <EmptyNote>{t(`${P}.collections.none`)}</EmptyNote>
        ) : (
          <Flex gap={2} wrap="wrap">
            {value.map((c) => (
              <Tag
                key={c.id}
                icon={<Cross />}
                disabled={disabled}
                label={t(`${P}.collections.remove`, { title: c.title })}
                onClick={() => onChange(value.filter((x) => x.id !== c.id))}
              >
                {c.title}
              </Tag>
            ))}
            {automated.map((c) => (
              <Flex
                key={`a-${c.id}`}
                gap={2}
                alignItems="center"
                paddingLeft={3}
                paddingRight={2}
                hasRadius
                background="neutral100"
                style={{ minHeight: 32 }}
              >
                <Typography variant="pi" fontWeight="bold" textColor="neutral700">
                  {c.title}
                </Typography>
                <ToneBadge>{t('ecommerce.organization.collections.type.AUTOMATED')}</ToneBadge>
              </Flex>
            ))}
          </Flex>
        )}
        <Typography variant="pi" textColor="neutral600">
          {t(isNew ? `${P}.collections.automatedNew` : `${P}.collections.automatedHint`)}
        </Typography>
      </Flex>
      <Field.Error />
    </Field.Root>
  );
};

// ------------------------------------------------------------------ tags

const TagsField = ({
  value,
  onChange,
  error,
  defaultLocale,
  disabled,
}: {
  value: ProductOrganization['tags'];
  onChange: (tags: ProductOrganization['tags']) => void;
  error?: string;
  defaultLocale: string;
  disabled?: boolean;
}) => {
  const { formatMessage } = useIntl();
  const t = (id: string, values?: Record<string, any>) =>
    formatMessage({ id: getTranslation(id) }, values);
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);
  const search = useRemoteOptions(open, term, (q) =>
    new FetchTags()
      .execute({ search: q || undefined, locale: defaultLocale })
      .then((page) => page.results.map(({ id, name }) => ({ id, name })))
  );
  const rows: OptionRow[] = search.results
    .filter((s) => !value.some((tag) => tag.id === s.id || sameName(tag.name, s.name)))
    .map((s) => ({
      key: `g-${s.id}`,
      content: <RowText>{s.name}</RowText>,
      onPick: () => {
        onChange(addTag(value, s, search.results));
        setTerm('');
      },
    }));
  const highlight = useHighlight(rows);

  /** Adds every typed name (comma separated); the text after the last comma stays typed. */
  const addTyped = (text: string, keepLast: boolean) => {
    const parts = text.split(',');
    const rest = keepLast ? (parts.pop() ?? '') : '';
    let next = value;
    parts.forEach((part) => {
      next = addTag(next, part, search.results);
    });
    if (next !== value) onChange(next);
    setTerm(rest);
  };

  return (
    <Field.Root name="tags" error={error} hint={t(`${P}.tags.hint`)}>
      <Field.Label>{t(`${P}.tags`)}</Field.Label>
      <Flex direction="column" alignItems="stretch" gap={2}>
        <OptionsPopover
          open={open}
          onClose={() => setOpen(false)}
          rows={rows}
          active={highlight.active}
          loading={search.loading}
          error={search.error}
          anchor={
            <TextInput
              aria-label={t(`${P}.tags`)}
              placeholder={t(`${P}.tags.placeholder`)}
              value={term}
              autoComplete="off"
              disabled={disabled}
              aria-haspopup="listbox"
              aria-expanded={open}
              onChange={(e: any) => {
                const text: string = e.target.value;
                if (text.includes(',')) addTyped(text, true);
                else setTerm(text);
                setOpen(true);
                highlight.setActive(-1);
              }}
              onFocus={() => setOpen(true)}
              onBlur={() => {
                setOpen(false);
                // A typed tag is not lost when leaving the field.
                if (term.trim()) addTyped(term, false);
              }}
              onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
                if (e.key === 'Escape') setOpen(false);
                else if (e.key === 'Backspace' && term === '' && value.length) {
                  onChange(value.slice(0, -1));
                } else highlight.onKeyDown(e, () => addTyped(term, false));
              }}
            />
          }
        />
        {value.length > 0 && (
          <Flex gap={2} wrap="wrap">
            {value.map((tag) => (
              <Tag
                key={tag.id !== undefined ? `id-${tag.id}` : `new-${tag.name}`}
                icon={<Cross />}
                disabled={disabled}
                label={t(`${P}.tags.remove`, { name: tag.name })}
                onClick={() => onChange(value.filter((x) => x !== tag))}
              >
                {tag.id === undefined ? `${tag.name} (${t(`${P}.tags.new`)})` : tag.name}
              </Tag>
            ))}
          </Flex>
        )}
      </Flex>
      <Field.Error />
      <Field.Hint />
    </Field.Root>
  );
};

// ------------------------------------------------------------------ section body

/**
 * The fields of "Product organization": category and type on the left; collections and
 * tags on the right (one column on small screens).
 */
const ProductOrganizationSection = ({
  value,
  onChange,
  errors,
  onFieldEdit,
  defaultLocale,
  isNew,
  disabled,
}: Props) => {
  const set = <K extends keyof ProductOrganization>(
    field: OrganizationField,
    key: K,
    next: ProductOrganization[K]
  ) => {
    onChange({ ...value, [key]: next });
    onFieldEdit(field);
  };

  return (
    <Grid.Root gap={6}>
      <Grid.Item col={6} s={12} direction="column" alignItems="stretch">
        <Flex direction="column" alignItems="stretch" gap={5}>
          <CategoryField
            value={value.category}
            onChange={(next) => set('category', 'category', next)}
            error={errors.category}
            defaultLocale={defaultLocale}
            disabled={disabled}
          />
          <ProductTypeField
            value={value.productType}
            onChange={(next) => set('productType', 'productType', next)}
            error={errors.productType}
            defaultLocale={defaultLocale}
            disabled={disabled}
          />
        </Flex>
      </Grid.Item>
      <Grid.Item col={6} s={12} direction="column" alignItems="stretch">
        <Flex direction="column" alignItems="stretch" gap={5}>
          <CollectionsField
            value={value.collections}
            automated={value.automatedCollections}
            onChange={(next) => set('collections', 'collections', next)}
            error={errors.collections}
            defaultLocale={defaultLocale}
            isNew={isNew}
            disabled={disabled}
          />
          <TagsField
            value={value.tags}
            onChange={(next) => set('tags', 'tags', next)}
            error={errors.tags}
            defaultLocale={defaultLocale}
            disabled={disabled}
          />
        </Flex>
      </Grid.Item>
    </Grid.Root>
  );
};

export { ProductOrganizationSection };
