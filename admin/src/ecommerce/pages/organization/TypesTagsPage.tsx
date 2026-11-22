import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useIntl } from 'react-intl';
import { useNotification } from '@strapi/strapi/admin';
import {
  Box,
  Button,
  Field,
  Flex,
  Grid,
  IconButton,
  Loader,
  Modal,
  Searchbar,
  SearchForm,
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
import { Pencil, Trash } from '@strapi/icons';
import { getTranslation } from '../../../core/utils/getTranslation';
import ConfirmModal from '../../../components/ConfirmModal';
import ListPagination from '../../components/ListPagination';
import SearchFieldHeight from '../../components/SearchFieldHeight';
import { LocaleSwitcher } from '../../components/LocaleSwitcher';
import EmptyNote from '../../components/orders/EmptyNote';
import NoticeBar from '../../components/orders/NoticeBar';
import FetchEcommerceLocales from '../../usecases/fetchEcommerceLocales';
import FetchProductTypes from '../../usecases/organization/fetchProductTypes';
import CreateProductType from '../../usecases/organization/createProductType';
import UpdateProductType from '../../usecases/organization/updateProductType';
import DeleteProductType from '../../usecases/organization/deleteProductType';
import FetchTags from '../../usecases/organization/fetchTags';
import CreateTag from '../../usecases/organization/createTag';
import UpdateTag from '../../usecases/organization/updateTag';
import DeleteTag from '../../usecases/organization/deleteTag';
import {
  organizationErrorMessage,
  organizationFieldErrors,
  organizationIssues,
} from '../../utils/organizationErrors';
import type { NamedInput, NamedListItem, NamedListParams, NamedPage } from '../../organizationTypes';

const SEARCH_DEBOUNCE_MS = 300;

type Kind = 'types' | 'tags';

/** The calls behind each section. */
const API: Record<
  Kind,
  {
    list: (params: NamedListParams) => Promise<NamedPage>;
    create: (input: NamedInput) => Promise<{ id: number }>;
    update: (id: number, input: NamedInput) => Promise<void>;
    remove: (id: number) => Promise<void>;
  }
> = {
  types: {
    list: (params) => new FetchProductTypes().execute(params),
    create: (input) => new CreateProductType().execute(input),
    update: (id, input) => new UpdateProductType().execute(id, input),
    remove: (id) => new DeleteProductType().execute(id),
  },
  tags: {
    list: (params) => new FetchTags().execute(params),
    create: (input) => new CreateTag().execute(input),
    update: (id, input) => new UpdateTag().execute(id, input),
    remove: (id) => new DeleteTag().execute(id),
  },
};

type Locales = { defaultLocale: string; locales: { code: string; name: string }[] };

/** Add / rename: one name per locale (the default locale's is required). */
const NameModal = ({
  kind,
  item,
  locales,
  onClose,
  onSaved,
}: {
  kind: Kind;
  /** Null to add. */
  item: NamedListItem | null;
  locales: Locales;
  onClose: () => void;
  onSaved: () => void;
}) => {
  const { formatMessage } = useIntl();
  const { toggleNotification } = useNotification();
  const t = (id: string, values?: Record<string, any>) => formatMessage({ id: getTranslation(id) }, values);
  const p = 'ecommerce.organization.typesTags';
  const { defaultLocale } = locales;

  const [names, setNames] = useState<Record<string, string>>(() =>
    Object.fromEntries(locales.locales.map((l) => [l.code, item?.translations?.[l.code]?.name ?? '']))
  );
  const [locale, setLocale] = useState(defaultLocale);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const path = `translations.${locale}.name`;
  const errorText = (key: string) => (errors[key] ? t(`ecommerce.organization.errors.${errors[key]}`) : undefined);

  const showErrors = (map: Record<string, string>) => {
    setErrors(map);
    const first = Object.keys(map).find((k) => k.startsWith('translations.'));
    if (first) setLocale(first.split('.')[1]);
  };

  const save = async () => {
    if (saving) return;
    if (!names[defaultLocale]?.trim()) {
      showErrors({ [`translations.${defaultLocale}.name`]: 'required' });
      return;
    }
    setSaving(true);
    try {
      const input: NamedInput = {
        translations: Object.fromEntries(Object.entries(names).map(([code, name]) => [code, { name }])),
      };
      if (item) await API[kind].update(item.id, input);
      else await API[kind].create(input);
      toggleNotification({ type: 'success', message: t(`${p}.${kind}.saved`) });
      onSaved();
    } catch (err) {
      const issues = organizationIssues(err);
      const message = organizationErrorMessage(err);
      if (issues.length) showErrors(organizationFieldErrors(issues));
      else toggleNotification({ type: 'danger', message: message ? t(message.id, message.values) : t(`${p}.saveError`) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal.Root open onOpenChange={(next: boolean) => !next && onClose()}>
      <Modal.Content>
        <Modal.Header>
          <Modal.Title>{t(item ? `${p}.${kind}.renameTitle` : `${p}.${kind}.addTitle`)}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <form
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              save();
            }}
          >
            <Flex direction="column" alignItems="stretch" gap={4}>
              <LocaleSwitcher
                locales={locales.locales}
                defaultLocale={defaultLocale}
                value={locale}
                onChange={setLocale}
                isFilled={(code) => !!names[code]?.trim()}
                label={t('ecommerce.organization.locale')}
              />
              <Field.Root
                name={path}
                required={locale === defaultLocale}
                error={errorText(path) ?? errorText(`translations.${locale}`)}
                hint={
                  locale === defaultLocale
                    ? undefined
                    : t('ecommerce.organization.fallbackHint', { locale: defaultLocale })
                }
              >
                <Field.Label>{t(`${p}.name`)}</Field.Label>
                <TextInput
                  value={names[locale] ?? ''}
                  onChange={(e: any) => {
                    const value = e.target.value;
                    setNames((n) => ({ ...n, [locale]: value }));
                    setErrors((map) => {
                      const next = { ...map };
                      delete next[path];
                      return next;
                    });
                  }}
                />
                <Field.Error />
                <Field.Hint />
              </Field.Root>
            </Flex>
          </form>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="tertiary" onClick={onClose}>
            {t('ecommerce.organization.cancel')}
          </Button>
          <Button variant="secondary" onClick={save} loading={saving}>
            {t(`${p}.confirm`)}
          </Button>
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
};

/** One searchable, paginated table (product types or tags) in its own section. */
const NamedSection = ({ kind, locales }: { kind: Kind; locales: Locales }) => {
  const { formatMessage } = useIntl();
  const { toggleNotification } = useNotification();
  const t = (id: string, values?: Record<string, any>) => formatMessage({ id: getTranslation(id) }, values);
  const p = 'ecommerce.organization.typesTags';

  const [items, setItems] = useState<NamedListItem[]>([]);
  const [pagination, setPagination] = useState({ page: 1, pageCount: 1 });
  const [page, setPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  /** Null: closed; 'new': add; an item: rename. */
  const [editing, setEditing] = useState<NamedListItem | 'new' | null>(null);
  const [toDelete, setToDelete] = useState<NamedListItem | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
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
    API[kind]
      .list({ page, search: search.trim() || undefined })
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
  }, [kind, page, search, reloadKey]);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  const remove = async () => {
    const item = toDelete;
    setToDelete(null);
    if (!item || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      await API[kind].remove(item.id);
      toggleNotification({ type: 'success', message: t(`${p}.${kind}.deleted`) });
      // The last row of a page: back one page.
      if (items.length === 1 && page > 1) setPage(page - 1);
      else reload();
    } catch (err) {
      const message = organizationErrorMessage(err);
      if (message) setNotice(t(message.id, message.values));
      else toggleNotification({ type: 'danger', message: t(`${p}.deleteError`) });
    } finally {
      setBusy(false);
    }
  };

  const isEmpty = !loading && !error && items.length === 0;
  const noSearch = search === '' && searchTerm === '';

  return (
    <Box background="neutral0" shadow="tableShadow" hasRadius padding={6} style={{ height: '100%' }}>
      <Flex direction="column" alignItems="stretch" gap={5}>
        <Flex justifyContent="space-between" alignItems="center" gap={3} wrap="wrap">
          <Typography variant="delta" tag="h2">
            {t(`${p}.${kind}.title`)}
          </Typography>
          <Button size="S" variant="secondary" onClick={() => setEditing('new')}>
            {t(`${p}.${kind}.add`)}
          </Button>
        </Flex>

        {notice && (
          <NoticeBar
            wrap
            text={notice}
            actions={
              <Button variant="tertiary" size="S" onClick={() => setNotice(null)}>
                {t('ecommerce.organization.close')}
              </Button>
            }
          />
        )}

        <SearchFieldHeight>
          <SearchForm onSubmit={(e: FormEvent) => e.preventDefault()}>
            <Searchbar
              name={`search-${kind}`}
              value={searchTerm}
              onClear={() => {
                setSearchTerm('');
                setSearch('');
                setPage(1);
              }}
              onChange={(e: any) => setSearchTerm(e.target.value)}
              clearLabel={t(`${p}.search.clear`)}
              placeholder={t(`${p}.${kind}.search`)}
            >
              {t(`${p}.${kind}.search`)}
            </Searchbar>
          </SearchForm>
        </SearchFieldHeight>

        {error && <Typography textColor="danger600">{t('ecommerce.organization.loadError')}</Typography>}

        {loading && items.length === 0 && !error && (
          <Flex justifyContent="center" padding={6}>
            <Loader small />
          </Flex>
        )}

        {isEmpty && <EmptyNote>{t(noSearch ? `${p}.${kind}.empty` : `${p}.noResults`)}</EmptyNote>}

        {items.length > 0 && (
          <>
            <Table colCount={3} rowCount={items.length}>
              <Thead>
                <Tr>
                  <Th>
                    <Typography variant="sigma">{t(`${p}.table.name`)}</Typography>
                  </Th>
                  <Th>
                    <Typography variant="sigma">{t(`${p}.table.products`)}</Typography>
                  </Th>
                  <Th>
                    <VisuallyHidden>{t(`${p}.table.actions`)}</VisuallyHidden>
                  </Th>
                </Tr>
              </Thead>
              <Tbody>
                {items.map((item) => (
                  <Tr key={item.id} style={{ opacity: loading || busy ? 0.5 : 1 }}>
                    <Td>
                      <Typography textColor="neutral800">{item.name || `#${item.id}`}</Typography>
                    </Td>
                    <Td>
                      <Typography textColor="neutral800">{item.productCount}</Typography>
                    </Td>
                    <Td>
                      <Flex gap={1} justifyContent="flex-end">
                        <IconButton label={t(`${p}.rename`)} variant="ghost" onClick={() => setEditing(item)}>
                          <Pencil />
                        </IconButton>
                        <IconButton
                          label={t(`${p}.delete`)}
                          variant="ghost"
                          disabled={busy}
                          onClick={() => setToDelete(item)}
                        >
                          <Trash />
                        </IconButton>
                      </Flex>
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
            <ListPagination page={pagination.page} pageCount={pagination.pageCount} onChange={setPage} />
          </>
        )}
      </Flex>

      {editing && (
        <NameModal
          kind={kind}
          item={editing === 'new' ? null : editing}
          locales={locales}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}

      <ConfirmModal
        open={!!toDelete}
        title={t(`${p}.${kind}.deleteTitle`)}
        text={t(`${p}.${kind}.deleteText`, { name: toDelete?.name ?? '' })}
        confirm={{ variant: 'danger-light', button: t(`${p}.delete`), action: remove }}
        cancel={{ button: t('ecommerce.organization.cancel'), action: () => setToDelete(null) }}
      />
    </Box>
  );
};

const TypesTagsPage = () => {
  const { formatMessage } = useIntl();
  const [locales, setLocales] = useState<Locales | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    new FetchEcommerceLocales()
      .execute()
      .then((ctx) => {
        if (!cancelled) setLocales({ defaultLocale: ctx.defaultLocale, locales: ctx.locales });
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <Typography textColor="danger600">
        {formatMessage({ id: getTranslation('ecommerce.organization.loadError') })}
      </Typography>
    );
  }
  if (!locales) {
    return (
      <Flex justifyContent="center" padding={8}>
        <Loader />
      </Flex>
    );
  }

  // Side by side, half each (one under the other on narrow screens).
  return (
    <Grid.Root gap={6}>
      <Grid.Item col={6} s={12} direction="column" alignItems="stretch">
        <NamedSection kind="types" locales={locales} />
      </Grid.Item>
      <Grid.Item col={6} s={12} direction="column" alignItems="stretch">
        <NamedSection kind="tags" locales={locales} />
      </Grid.Item>
    </Grid.Root>
  );
};

export { TypesTagsPage };
