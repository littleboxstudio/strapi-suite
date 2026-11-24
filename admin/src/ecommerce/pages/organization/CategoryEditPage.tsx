import { useEffect, useState } from 'react';
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
import NoticeBar from '../../components/orders/NoticeBar';
import { ToneBadge } from '../../components/orders/StatusBadges';
import FetchEcommerceLocales from '../../usecases/fetchEcommerceLocales';
import FetchCategory from '../../usecases/organization/fetchCategory';
import FetchCategoryTree from '../../usecases/organization/fetchCategoryTree';
import SaveCategory from '../../usecases/organization/saveCategory';
import DeleteCategory from '../../usecases/organization/deleteCategory';
import { parentOptions } from '../../utils/categoryTree';
import { followNameSlug, validateCategoryTexts } from '../../utils/categoryForm';
import {
  organizationErrorMessage,
  organizationFieldErrors,
  organizationIssues,
} from '../../utils/organizationErrors';
import type { CategoryDetail, CategoryInput, CategoryTreeNode } from '../../organizationTypes';

const ROOT = 'root';

const TEXT_FIELDS = ['name', 'slug', 'description', 'seoTitle', 'seoDescription'] as const;
type TextField = (typeof TEXT_FIELDS)[number];
type TranslationForm = Record<TextField, string>;
type CategoryForm = {
  parentId: number | null;
  active: boolean;
  translations: Record<string, TranslationForm>;
};

/** Sets one text; the slug follows the name until it is edited by hand. */
const withText = (tr: TranslationForm, field: TextField, value: string): TranslationForm =>
  field === 'name'
    ? { ...tr, name: value, slug: followNameSlug(tr.name, tr.slug, value) }
    : { ...tr, [field]: value };

const emptyTranslation = (): TranslationForm => ({
  name: '',
  slug: '',
  description: '',
  seoTitle: '',
  seoDescription: '',
});

const formFromDetail = (detail: CategoryDetail | null, localeCodes: string[]): CategoryForm => ({
  parentId: detail?.parentId ?? null,
  active: detail ? detail.active : true,
  translations: Object.fromEntries(
    localeCodes.map((code) => {
      const tr = detail?.translations?.[code];
      return [
        code,
        tr
          ? {
              name: tr.name ?? '',
              slug: tr.slug ?? '',
              description: tr.description ?? '',
              seoTitle: tr.seoTitle ?? '',
              seoDescription: tr.seoDescription ?? '',
            }
          : emptyTranslation(),
      ];
    })
  ),
});

const toInput = (form: CategoryForm): CategoryInput => ({
  parentId: form.parentId,
  active: form.active,
  translations: Object.fromEntries(
    Object.entries(form.translations).map(([code, tr]) => [
      code,
      {
        name: tr.name,
        slug: tr.slug.trim(),
        description: tr.description || null,
        seoTitle: tr.seoTitle || null,
        seoDescription: tr.seoDescription || null,
      },
    ])
  ),
});

type LoadState = 'loading' | 'ready' | 'error' | 'notFound';

const CategoryEditPage = () => {
  const { formatMessage } = useIntl();
  const navigate = useNavigate();
  const { toggleNotification } = useNotification();
  const params = useParams<{ id: string }>();
  const categoryId = params.id && /^\d+$/.test(params.id) ? Number(params.id) : undefined;
  const isNew = params.id === undefined || params.id === 'new';
  const basePath = `/plugins/${config.pluginId}/ecommerce/categories`;
  const t = (id: string, values?: Record<string, any>) => formatMessage({ id: getTranslation(id) }, values);
  const p = 'ecommerce.organization.category';

  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [locales, setLocales] = useState<{ code: string; name: string }[]>([]);
  const [defaultLocale, setDefaultLocale] = useState('');
  const [activeLocale, setActiveLocale] = useState('');
  const [tree, setTree] = useState<CategoryTreeNode[]>([]);
  const [detail, setDetail] = useState<CategoryDetail | null>(null);
  const [form, setForm] = useState<CategoryForm | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoadState('loading');
    setErrors({});
    setNotice(null);
    (async () => {
      try {
        if (!isNew && categoryId === undefined) {
          setLoadState('notFound');
          return;
        }
        const [ctx, roots, found] = await Promise.all([
          new FetchEcommerceLocales().execute(),
          new FetchCategoryTree().execute(),
          isNew ? Promise.resolve(null) : new FetchCategory().execute(categoryId as number),
        ]);
        if (cancelled) return;
        setLocales(ctx.locales);
        setDefaultLocale(ctx.defaultLocale);
        setActiveLocale((current) => current || ctx.defaultLocale);
        setTree(Array.isArray(roots) ? roots : []);
        setDetail(found);
        setForm(formFromDetail(found, ctx.locales.map((l) => l.code)));
        setLoadState('ready');
      } catch (err) {
        if (cancelled) return;
        setLoadState((err as any)?.response?.status === 404 ? 'notFound' : 'error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isNew, categoryId, reloadKey]);

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
  const current = form.translations[activeLocale] ?? emptyTranslation();
  const errorText = (path: string) => (errors[path] ? t(`ecommerce.organization.errors.${errors[path]}`) : undefined);
  const clearError = (path: string) =>
    setErrors((map) => {
      if (!map[path]) return map;
      const next = { ...map };
      delete next[path];
      return next;
    });

  const update = (patch: Partial<CategoryForm>, path?: string) => {
    setForm((f) => (f ? { ...f, ...patch } : f));
    if (path) clearError(path);
  };

  const setText = (field: TextField, value: string) => {
    setForm((f) =>
      f
        ? {
            ...f,
            translations: {
              ...f.translations,
              [activeLocale]: withText(f.translations[activeLocale] ?? emptyTranslation(), field, value),
            },
          }
        : f
    );
    clearError(`translations.${activeLocale}.${field}`);
  };

  const showErrors = (map: Record<string, string>) => {
    setErrors(map);
    const localePath = Object.keys(map).find((k) => k.startsWith('translations.'));
    if (localePath) setActiveLocale(localePath.split('.')[1]);
    toggleNotification({ type: 'warning', message: t(`${p}.fix`) });
  };

  const save = async () => {
    if (saving) return;
    const local = validateCategoryTexts(form.translations, defaultLocale);
    if (Object.keys(local).length) {
      // The default locale's error first, so its tab is shown.
      const defaultPath = `translations.${defaultLocale}.name`;
      showErrors(local[defaultPath] ? { [defaultPath]: local[defaultPath], ...local } : local);
      return;
    }
    setSaving(true);
    setNotice(null);
    try {
      const { id } = await new SaveCategory().execute(toInput(form), detail?.id);
      setErrors({});
      toggleNotification({ type: 'success', message: t(`${p}.saved`) });
      if (!detail) navigate(`${basePath}/${id}`, { replace: true });
      else setReloadKey((k) => k + 1);
    } catch (err) {
      const issues = organizationIssues(err);
      const message = organizationErrorMessage(err);
      if (issues.length) showErrors(organizationFieldErrors(issues));
      else if (message) setNotice(t(message.id, message.values));
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
      await new DeleteCategory().execute(detail.id);
      toggleNotification({ type: 'success', message: t('ecommerce.organization.categories.deleted') });
      navigate(basePath);
    } catch (err) {
      const message = organizationErrorMessage(err);
      if (message) setNotice(t(message.id, message.values));
      else toggleNotification({ type: 'danger', message: t('ecommerce.organization.categories.deleteError') });
    } finally {
      setSaving(false);
    }
  };

  const savedName = detail ? (detail.translations[defaultLocale]?.name ?? '') : '';
  const title = form.translations[defaultLocale]?.name.trim() || savedName || t(`${p}.new`);
  const fallbackHint = isDefault ? undefined : t('ecommerce.organization.fallbackHint', { locale: defaultLocale });

  const textField = (field: Exclude<TextField, 'description'>, opts: { required?: boolean; hint?: string } = {}) => {
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
            <ToneBadge variant="success">{t('ecommerce.organization.categories.status.active')}</ToneBadge>
          ) : (
            <ToneBadge>{t('ecommerce.organization.categories.status.inactive')}</ToneBadge>
          )}
        </Flex>
      </Flex>

      <HeaderActions>
        {detail && (
          <Button variant="danger-light" disabled={saving} onClick={() => setConfirmDelete(true)}>
            {t(`${p}.delete`)}
          </Button>
        )}
        {/* As the product's Enable / Disable: red to disable, green to enable (stored on Save). */}
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

      <Box background="neutral0" shadow="tableShadow" hasRadius padding={6}>
        <Flex direction="column" alignItems="stretch" gap={5}>
          <LocaleSwitcher
            locales={locales}
            defaultLocale={defaultLocale}
            value={activeLocale}
            onChange={setActiveLocale}
            isFilled={(code) => !!form.translations[code]?.name.trim()}
            label={t('ecommerce.organization.locale')}
          />
          {errors[`translations.${activeLocale}`] && (
            <Typography variant="pi" textColor="danger600" role="alert">
              {errorText(`translations.${activeLocale}`)}
            </Typography>
          )}
          {textField('name', { required: isDefault, hint: fallbackHint })}
          {textField('slug', { hint: t(`${p}.slug.hint`) })}
          <Field.Root name="parentId" error={errorText('parentId')} hint={t(`${p}.parent.hint`)}>
            <Field.Label>{t(`${p}.parent`)}</Field.Label>
            <SingleSelect
              value={form.parentId === null ? ROOT : String(form.parentId)}
              hasError={!!errors.parentId}
              onChange={(value: string | number) =>
                update({ parentId: String(value) === ROOT ? null : Number(value) }, 'parentId')
              }
            >
              <SingleSelectOption value={ROOT}>{t(`${p}.root`)}</SingleSelectOption>
              {parentOptions(tree, detail?.id).map((option) => (
                <SingleSelectOption key={option.id} value={String(option.id)}>
                  {option.label}
                </SingleSelectOption>
              ))}
            </SingleSelect>
            <Field.Error />
            <Field.Hint />
          </Field.Root>
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
        </Flex>
      </Box>

      <ConfirmModal
        open={confirmDelete}
        title={t('ecommerce.organization.categories.deleteTitle')}
        text={t('ecommerce.organization.categories.deleteText', { name: savedName })}
        confirm={{
          variant: 'danger-light',
          button: t('ecommerce.organization.categories.delete'),
          action: remove,
        }}
        cancel={{ button: t('ecommerce.organization.cancel'), action: () => setConfirmDelete(false) }}
      />
    </Flex>
  );
};

export { CategoryEditPage };
