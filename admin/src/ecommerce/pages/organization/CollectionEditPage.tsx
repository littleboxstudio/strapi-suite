import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useIntl } from 'react-intl';
import { useNavigate, useParams } from 'react-router-dom';
import { useNotification } from '@strapi/strapi/admin';
import {
  Box,
  Button,
  Field,
  Flex,
  IconButton,
  Loader,
  Radio,
  SingleSelect,
  SingleSelectOption,
  Textarea,
  TextInput,
  Typography,
} from '@strapi/design-system';
import { ArrowLeft } from '@strapi/icons';
import config from '../../../core/config';
import { getTranslation } from '../../../core/utils/getTranslation';
import ConfirmModal from '../../../components/ConfirmModal';
import { HeaderActions } from '../../components/HeaderActions';
import { LocaleSwitcher } from '../../components/LocaleSwitcher';
import EmptyNote from '../../components/orders/EmptyNote';
import NoticeBar from '../../components/orders/NoticeBar';
import { ToneBadge } from '../../components/orders/StatusBadges';
import CollectionConditionsEditor, {
  type ConditionOptions,
} from '../../components/organization/CollectionConditionsEditor';
import CollectionPreview from '../../components/organization/CollectionPreview';
import CollectionProducts from '../../components/organization/CollectionProducts';
import FetchEcommerceLocales from '../../usecases/fetchEcommerceLocales';
import FetchCollection from '../../usecases/organization/fetchCollection';
import SaveCollection from '../../usecases/organization/saveCollection';
import DeleteCollection from '../../usecases/organization/deleteCollection';
import RecalculateCollection from '../../usecases/organization/recalculateCollection';
import FetchCategoryTree from '../../usecases/organization/fetchCategoryTree';
import FetchProductTypes from '../../usecases/organization/fetchProductTypes';
import FetchTags from '../../usecases/organization/fetchTags';
import { parentOptions } from '../../utils/categoryTree';
import { formatCents } from '../../utils/money';
import {
  buildCollectionInput,
  collectionFormFromDetail,
  emptyCollectionCondition,
  emptyCollectionForm,
  emptyCollectionText,
  MAX_COLLECTION_CONDITIONS,
  previewInput,
  setCollectionType,
  sortOptions,
  validateCollectionForm,
  type CollectionForm,
  type CollectionTextForm,
} from '../../utils/collectionForm';
import { followNameSlug } from '../../utils/slug';
import {
  organizationErrorMessage,
  organizationFieldErrors,
  organizationIssues,
} from '../../utils/organizationErrors';
import type { CollectionDetail, CollectionType, NamedPage } from '../../organizationTypes';

const Section = ({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) => (
  <Box background="neutral0" shadow="tableShadow" hasRadius padding={6}>
    <Flex direction="column" alignItems="stretch" gap={5}>
      <Flex justifyContent="space-between" alignItems="center" gap={3} wrap="wrap">
        <Typography variant="delta" tag="h2">
          {title}
        </Typography>
        {actions}
      </Flex>
      {children}
    </Flex>
  </Box>
);

/** Pages of product types / tags read for the pickers (50 each). */
const MAX_NAME_PAGES = 20;

/** Every product type or tag (id + name in the admin's language), for the condition pickers. */
async function allNames(fetchPage: (page: number) => Promise<NamedPage>): Promise<{ id: number; label: string }[]> {
  const out: { id: number; label: string }[] = [];
  let page = 1;
  let pageCount = 1;
  do {
    const data = await fetchPage(page);
    out.push(...(data.results ?? []).map((r) => ({ id: r.id, label: r.name })));
    pageCount = data.pagination?.pageCount ?? 1;
    page += 1;
  } while (page <= pageCount && page <= MAX_NAME_PAGES);
  return out;
}

const COLLECTION_TYPES: CollectionType[] = ['MANUAL', 'AUTOMATED'];

type LoadState = 'loading' | 'ready' | 'error' | 'notFound';

/** Sets one text; the slug follows the title until it is edited by hand. */
const withText = (tr: CollectionTextForm, field: keyof CollectionTextForm, value: string): CollectionTextForm =>
  field === 'title'
    ? { ...tr, title: value, slug: followNameSlug(tr.title, tr.slug, value) }
    : { ...tr, [field]: value };

const CollectionEditPage = () => {
  const { formatMessage, locale } = useIntl();
  const navigate = useNavigate();
  const { toggleNotification } = useNotification();
  const params = useParams<{ id: string }>();
  const collectionId = params.id && /^\d+$/.test(params.id) ? Number(params.id) : undefined;
  const isNew = params.id === undefined || params.id === 'new';
  const basePath = `/plugins/${config.pluginId}/ecommerce/collections`;
  const t = (id: string, values?: Record<string, any>) => formatMessage({ id: getTranslation(id) }, values);
  const p = 'ecommerce.organization.collection';

  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [locales, setLocales] = useState<{ code: string; name: string }[]>([]);
  const [defaultLocale, setDefaultLocale] = useState('');
  const [activeLocale, setActiveLocale] = useState('');
  const [detail, setDetail] = useState<CollectionDetail | null>(null);
  const [form, setForm] = useState<CollectionForm | null>(null);
  const [options, setOptions] = useState<ConditionOptions>({ categories: [], productTypes: [], tags: [] });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [recalculating, setRecalculating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [scrollTarget, setScrollTarget] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadState('loading');
    setErrors({});
    setNotice(null);
    (async () => {
      try {
        if (!isNew && collectionId === undefined) {
          setLoadState('notFound');
          return;
        }
        const [ctx, found] = await Promise.all([
          new FetchEcommerceLocales().execute(),
          isNew ? Promise.resolve(null) : new FetchCollection().execute(collectionId as number),
        ]);
        if (cancelled) return;
        setLocales(ctx.locales);
        setDefaultLocale(ctx.defaultLocale);
        setActiveLocale((current) => current || ctx.defaultLocale);
        setDetail(found);
        const codes = ctx.locales.map((l) => l.code);
        setForm(found ? collectionFormFromDetail(found, codes, locale) : emptyCollectionForm(codes));
        setLoadState('ready');
      } catch (err) {
        if (cancelled) return;
        setLoadState((err as any)?.response?.status === 404 ? 'notFound' : 'error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isNew, collectionId, reloadKey]);

  // The condition pickers' lists (categories with their full path, types, tags); failures leave them empty.
  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([
      new FetchCategoryTree().execute(),
      allNames((page) => new FetchProductTypes().execute({ page })),
      allNames((page) => new FetchTags().execute({ page })),
    ]).then(([tree, types, tags]) => {
      if (cancelled) return;
      setOptions({
        categories:
          tree.status === 'fulfilled' && Array.isArray(tree.value) ? parentOptions(tree.value) : [],
        productTypes: types.status === 'fulfilled' ? types.value : [],
        tags: tags.status === 'fulfilled' ? tags.value : [],
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // A condition just added is scrolled into view once it is on the page.
  useEffect(() => {
    if (!scrollTarget) return;
    document.querySelector(`[data-scroll-id="${scrollTarget}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setScrollTarget(null);
  }, [scrollTarget]);

  const labels = useMemo(
    () => ({
      categories: Object.fromEntries(options.categories.map((o) => [o.id, o.label])),
      productTypes: Object.fromEntries(options.productTypes.map((o) => [o.id, o.label])),
      tags: Object.fromEntries(options.tags.map((o) => [o.id, o.label])),
      money: (cents: number) => formatCents(cents, locale),
    }),
    [options, locale]
  );

  const preview = useMemo(
    () => (form && form.type === 'AUTOMATED' ? previewInput(form) : null),
    [form]
  );

  if (loadState === 'loading') {
    return (
      <Flex justifyContent="center" padding={8}>
        <Loader />
      </Flex>
    );
  }
  if (loadState === 'notFound') {
    return <Typography textColor="neutral600">{t(`${p}.notFound`)}</Typography>;
  }
  if (loadState === 'error' || !form) {
    return <Typography textColor="danger600">{t('ecommerce.organization.loadError')}</Typography>;
  }

  const isDefault = activeLocale === defaultLocale;
  const current = form.translations[activeLocale] ?? emptyCollectionText();
  const errorText = (path: string) => (errors[path] ? t(`ecommerce.organization.errors.${errors[path]}`) : undefined);
  const clearErrors = (match: (path: string) => boolean) =>
    setErrors((map) => {
      const keys = Object.keys(map).filter(match);
      if (!keys.length) return map;
      const next = { ...map };
      for (const key of keys) delete next[key];
      return next;
    });

  const update = (patch: Partial<CollectionForm>, path?: string) => {
    setForm((f) => (f ? { ...f, ...patch } : f));
    if (path) clearErrors((k) => k === path);
  };

  const setText = (field: keyof CollectionTextForm, value: string) => {
    setForm((f) =>
      f
        ? {
            ...f,
            translations: {
              ...f.translations,
              [activeLocale]: withText(f.translations[activeLocale] ?? emptyCollectionText(), field, value),
            },
          }
        : f
    );
    clearErrors((k) => k === `translations.${activeLocale}.${field}`);
  };

  const showErrors = (map: Record<string, string>) => {
    setErrors(map);
    const localePath = Object.keys(map).find((k) => k.startsWith('translations.'));
    if (localePath) setActiveLocale(localePath.split('.')[1]);
    toggleNotification({ type: 'warning', message: t(`${p}.fix`) });
  };

  const save = async () => {
    if (saving) return;
    const local = validateCollectionForm(form, defaultLocale);
    if (Object.keys(local).length) {
      // The default locale's error first, so its tab is shown.
      const defaultPath = `translations.${defaultLocale}.title`;
      showErrors(local[defaultPath] ? { [defaultPath]: local[defaultPath], ...local } : local);
      return;
    }
    setSaving(true);
    setNotice(null);
    try {
      const { id } = await new SaveCollection().execute(buildCollectionInput(form), detail?.id);
      setErrors({});
      toggleNotification({ type: 'success', message: t(`${p}.saved`) });
      if (!detail) navigate(`${basePath}/${id}`, { replace: true });
      else setReloadKey((k) => k + 1);
    } catch (err) {
      const issues = organizationIssues(err);
      const message = organizationErrorMessage(err);
      if (message) setNotice(t(message.id, message.values));
      else if (issues.length) showErrors(organizationFieldErrors(issues));
      else toggleNotification({ type: 'danger', message: t(`${p}.saveError`) });
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setConfirmDelete(false);
    if (!detail || saving) return;
    setSaving(true);
    setNotice(null);
    try {
      await new DeleteCollection().execute(detail.id);
      toggleNotification({ type: 'success', message: t('ecommerce.organization.collections.deleted') });
      navigate(basePath);
    } catch (err) {
      const message = organizationErrorMessage(err);
      if (message) setNotice(t(message.id, message.values));
      else toggleNotification({ type: 'danger', message: t('ecommerce.organization.collections.deleteError') });
    } finally {
      setSaving(false);
    }
  };

  const recalculate = async () => {
    if (!detail || recalculating) return;
    setRecalculating(true);
    try {
      const result = await new RecalculateCollection().execute(detail.id);
      toggleNotification({
        type: 'success',
        message: t(`${p}.recalculated`, { added: result?.added ?? 0, removed: result?.removed ?? 0 }),
      });
    } catch {
      toggleNotification({ type: 'danger', message: t(`${p}.recalculateError`) });
    } finally {
      setRecalculating(false);
    }
  };

  const addCondition = () => {
    const added = emptyCollectionCondition();
    update({ conditions: [...form.conditions, added] }, 'conditions');
    setScrollTarget(`condition-${added.key}`);
  };

  const savedTitle = detail ? (detail.translations[defaultLocale]?.title ?? '') : '';
  const title = form.translations[defaultLocale]?.title.trim() || savedTitle || t(`${p}.new`);
  const fallbackHint = isDefault ? undefined : t('ecommerce.organization.fallbackHint', { locale: defaultLocale });
  const isAutomated = form.type === 'AUTOMATED';

  const textField = (
    field: Exclude<keyof CollectionTextForm, 'description'>,
    opts: { required?: boolean; hint?: string } = {}
  ) => {
    const path = `translations.${activeLocale}.${field}`;
    return (
      <Field.Root name={field} required={opts.required} error={errorText(path)} hint={opts.hint}>
        <Field.Label>{t(`${p}.${field}`)}</Field.Label>
        <TextInput value={current[field]} onChange={(e: any) => setText(field, e.target.value)} />
        <Field.Error />
        <Field.Hint />
      </Field.Root>
    );
  };

  /** The order of the collection's products (shown at the top of Products / Conditions). */
  const sortField = (
    <Field.Root name="sortOrder" error={errorText('sortOrder')} hint={t(`${p}.sorting.hint`)}>
      <Field.Label>{t(`${p}.sorting.label`)}</Field.Label>
      <SingleSelect
        value={form.sortOrder}
        hasError={!!errors.sortOrder}
        onChange={(value: string | number) => update({ sortOrder: String(value) as CollectionForm['sortOrder'] }, 'sortOrder')}
      >
        {sortOptions(form.type).map((sort) => (
          <SingleSelectOption key={sort} value={sort}>
            {t(`${p}.sorting.${sort}`)}
          </SingleSelectOption>
        ))}
      </SingleSelect>
      <Field.Error />
      <Field.Hint />
    </Field.Root>
  );

  const localeSwitcher = (
    <LocaleSwitcher
      locales={locales}
      defaultLocale={defaultLocale}
      value={activeLocale}
      onChange={setActiveLocale}
      isFilled={(code) => !!form.translations[code]?.title.trim()}
      label={t('ecommerce.organization.locale')}
    />
  );

  return (
    <Flex direction="column" alignItems="stretch" gap={6}>
      <Flex justifyContent="space-between" alignItems="center" gap={4}>
        <Flex gap={3} alignItems="center" style={{ minWidth: 0 }}>
          <IconButton label={t(`${p}.back`)} onClick={() => navigate(basePath)}>
            <ArrowLeft />
          </IconButton>
          <Typography variant="beta" tag="h1" ellipsis>
            {title}
          </Typography>
          {form.active ? (
            <ToneBadge variant="success">{t('ecommerce.organization.collections.status.active')}</ToneBadge>
          ) : (
            <ToneBadge>{t('ecommerce.organization.collections.status.inactive')}</ToneBadge>
          )}
        </Flex>
      </Flex>

      <HeaderActions>
        {detail && (
          <Button variant="danger-light" disabled={saving} onClick={() => setConfirmDelete(true)}>
            {t(`${p}.delete`)}
          </Button>
        )}
        {/* As the category's Enable / Disable: red to disable, green to enable (stored on Save). */}
        <Button
          variant={form.active ? 'danger-light' : 'success-light'}
          disabled={saving}
          onClick={() => update({ active: !form.active }, 'active')}
        >
          {t(form.active ? `${p}.disable` : `${p}.enable`)}
        </Button>
        <Button variant="secondary" onClick={save} loading={saving}>
          {t(`${p}.save`)}
        </Button>
      </HeaderActions>

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

      <Section title={t(`${p}.sections.general`)}>
        {localeSwitcher}
        {errors[`translations.${activeLocale}`] && (
          <Typography variant="pi" textColor="danger600" role="alert">
            {errorText(`translations.${activeLocale}`)}
          </Typography>
        )}
        {textField('title', { required: isDefault, hint: fallbackHint })}
        {textField('slug', { hint: t(`${p}.slug.hint`) })}
        <Field.Root name="description" error={errorText(`translations.${activeLocale}.description`)}>
          <Field.Label>{t(`${p}.description`)}</Field.Label>
          <Textarea value={current.description} onChange={(e: any) => setText('description', e.target.value)} />
          <Field.Error />
        </Field.Root>
        {textField('seoTitle')}
        {textField('seoDescription')}
        {errors.active && (
          <Typography variant="pi" textColor="danger600" role="alert">
            {errorText('active')}
          </Typography>
        )}
      </Section>

      <Section title={t(`${p}.sections.type`)}>
        {detail ? (
          <Flex direction="column" alignItems="flex-start" gap={2}>
            <ToneBadge variant={isAutomated ? 'primary' : undefined}>{t(`${p}.type.${form.type}`)}</ToneBadge>
            <Typography variant="pi" textColor="neutral600">
              {t(`${p}.type.${form.type}.hint`)} {t(`${p}.type.fixed`)}
            </Typography>
          </Flex>
        ) : (
          <Radio.Group
            value={form.type}
            disabled={saving}
            aria-label={t(`${p}.type.label`)}
            onValueChange={(value: string) => {
              setForm((f) => (f ? setCollectionType(f, value === 'AUTOMATED' ? 'AUTOMATED' : 'MANUAL') : f));
              clearErrors((k) => k === 'type' || k === 'sortOrder' || k.startsWith('conditions'));
            }}
          >
            <Flex direction="column" alignItems="stretch" gap={3}>
              {COLLECTION_TYPES.map((type) => (
                <Flex key={type} direction="column" alignItems="flex-start" gap={1}>
                  <Radio.Item value={type}>{t(`${p}.type.${type}`)}</Radio.Item>
                  <Box paddingLeft={6}>
                    <Typography variant="pi" textColor="neutral600">
                      {t(`${p}.type.${type}.hint`)}
                    </Typography>
                  </Box>
                </Flex>
              ))}
            </Flex>
          </Radio.Group>
        )}
        {errors.type && (
          <Typography variant="pi" textColor="danger600" role="alert">
            {errorText('type')}
          </Typography>
        )}
      </Section>

      {!isAutomated && (
        <Section title={t(`${p}.sections.products`)}>
          {sortField}
          {detail ? (
            <CollectionProducts collectionId={detail.id} manualSort={detail.sortOrder === 'MANUAL'} />
          ) : (
            <EmptyNote>{t(`${p}.products.saveFirst`)}</EmptyNote>
          )}
        </Section>
      )}

      {isAutomated && (
        <Section
          title={t(`${p}.sections.conditions`)}
          actions={
            <Flex gap={2}>
              {detail?.type === 'AUTOMATED' && (
                <Button size="S" variant="secondary" loading={recalculating} onClick={recalculate}>
                  {t(`${p}.recalculate`)}
                </Button>
              )}
              <Button
                size="S"
                variant="secondary"
                disabled={saving || form.conditions.length >= MAX_COLLECTION_CONDITIONS}
                onClick={addCondition}
              >
                {t(`${p}.conditions.add`)}
              </Button>
            </Flex>
          }
        >
          {sortField}
          <CollectionConditionsEditor
            match={form.match}
            conditions={form.conditions}
            errors={errors}
            options={options}
            labels={labels}
            disabled={saving}
            onChange={(patch) => {
              update(patch);
              // Row errors follow their index: any change clears them (Save checks again).
              clearErrors((k) => k === 'match' || k.startsWith('conditions'));
            }}
          />
          <CollectionPreview input={preview} />
        </Section>
      )}

      <ConfirmModal
        open={confirmDelete}
        title={t('ecommerce.organization.collections.deleteTitle')}
        text={t('ecommerce.organization.collections.deleteText', { name: savedTitle })}
        confirm={{
          variant: 'danger-light',
          button: t('ecommerce.organization.collections.delete'),
          action: remove,
        }}
        cancel={{ button: t('ecommerce.organization.cancel'), action: () => setConfirmDelete(false) }}
      />
    </Flex>
  );
};

export { CollectionEditPage };
