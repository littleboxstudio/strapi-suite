import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useIntl } from 'react-intl';
import { useNavigate, useParams } from 'react-router-dom';
import { useNotification } from '@strapi/strapi/admin';
import {
  Badge,
  Box,
  Button,
  Field,
  Flex,
  IconButton,
  Loader,
  Textarea,
  TextInput,
  Tooltip,
  Typography,
} from '@strapi/design-system';
import { ArrowLeft, Sparkle } from '@strapi/icons';
import config from '../../core/config';
import { getTranslation } from '../../core/utils/getTranslation';
import { convertToSlug } from '../../core/utils/convertToSlug';
import FetchEcommerceLocales from '../usecases/fetchEcommerceLocales';
import FetchProduct from '../usecases/fetchProduct';
import SaveProduct from '../usecases/saveProduct';
import DeleteProduct from '../usecases/deleteProduct';
import SetProductActive from '../usecases/setProductActive';
import ConfirmModal from '../../components/ConfirmModal';
import { NoticeModal } from '../components/NoticeModal';
import { ActionConfirmModal } from '../components/ActionConfirmModal';
import { HeaderActions } from '../components/HeaderActions';
import TranslateProductStrings from '../usecases/translateProductStrings';
import { LocaleSwitcher } from '../components/LocaleSwitcher';
import { DescriptionEditor } from '../components/DescriptionEditor';
import { VariantsTable } from '../components/VariantsTable';
import { VariantModal } from '../components/VariantModal';
import { Gallery } from '../components/Gallery';
import {
  applyTranslations,
  buildProductInput,
  buildTranslationRequest,
  emptyProductForm,
  extractFieldErrors,
  productFormFromDetail,
  scopedErrors,
  toErrorMap,
  validateProductForm,
  type ErrorMap,
  type FormVariant,
  type ProductForm,
  type ProductTranslation,
} from '../utils/productForm';
import type { EcommerceLocales, ImageRecord, ProductDetail } from '../types';

type ModalState = { index: number | null; newKey: string };

const Section = ({
  title,
  actions,
  children,
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}) => (
  <Box background="neutral0" shadow="tableShadow" hasRadius padding={6}>
    <Flex direction="column" alignItems="stretch" gap={5}>
      <Flex justifyContent="space-between" alignItems="center" gap={4} wrap="wrap">
        <Typography variant="delta" tag="h2">
          {title}
        </Typography>
        {actions}
      </Flex>
      {children}
    </Flex>
  </Box>
);

const ProductEditPage = () => {
  const { formatMessage } = useIntl();
  const navigate = useNavigate();
  const { toggleNotification } = useNotification();
  const params = useParams<{ id: string }>();
  const productId = params.id ? Number(params.id) : undefined;
  const basePath = `/plugins/${config.pluginId}/ecommerce/products`;
  const t = (id: string, values?: Record<string, any>) =>
    formatMessage({ id: getTranslation(id) }, values);

  const [info, setInfo] = useState<EcommerceLocales | null>(null);
  const [form, setForm] = useState<ProductForm | null>(null);
  const [savedSlugs, setSavedSlugs] = useState<Record<string, { name: string; slug: string }>>({});
  const [productImages, setProductImages] = useState<ImageRecord[]>([]);
  const [activeLocale, setActiveLocale] = useState('');
  const [errors, setErrors] = useState<ErrorMap>({});
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [modal, setModal] = useState<ModalState | null>(null);
  /** False once the product is in some order: it can only be deactivated. */
  const [deletable, setDeletable] = useState(true);
  const [deleteDialog, setDeleteDialog] = useState<'confirm' | 'blocked' | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [toggling, setToggling] = useState(false);
  /** Disable/Enable asks for confirmation first. */
  const [confirmToggle, setConfirmToggle] = useState(false);
  const newKeyCounter = useRef(0);

  const codes = info?.locales.map((l) => l.code) ?? [];

  const applyProduct = useCallback((detail: ProductDetail, localeCodes: string[]) => {
    const next = productFormFromDetail(detail, localeCodes);
    setForm(next);
    setProductImages(detail.images);
    setDeletable(detail.deletable !== false);
    setSavedSlugs(
      Object.fromEntries(
        Object.entries(next.translations)
          .filter(([, tr]) => tr.slug)
          .map(([code, tr]) => [code, { name: tr.name, slug: tr.slug as string }])
      )
    );
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoadError(false);
    setErrors({});
    (async () => {
      try {
        const locales = info ?? (await new FetchEcommerceLocales().execute());
        if (cancelled) return;
        if (!info) {
          setInfo(locales);
          setActiveLocale(locales.defaultLocale);
        }
        const localeCodes = locales.locales.map((l) => l.code);
        if (productId === undefined) {
          setForm(emptyProductForm(localeCodes));
          setProductImages([]);
          setSavedSlugs({});
        } else {
          const detail = await new FetchProduct().execute(productId);
          if (!cancelled) applyProduct(detail, localeCodes);
        }
      } catch {
        if (!cancelled) setLoadError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // `info` is only read to avoid fetching the locales twice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId, applyProduct]);

  if (loadError) {
    return <Typography textColor="danger600">{t('ecommerce.product.loadError')}</Typography>;
  }

  if (!info || !form) {
    return (
      <Flex justifyContent="center" padding={8}>
        <Loader />
      </Flex>
    );
  }

  const { defaultLocale, locales, aiAvailable } = info;
  const current: ProductTranslation = form.translations[activeLocale] ?? {
    name: '',
    shortDescription: '',
    description: '',
  };
  const title = form.translations[defaultLocale]?.name.trim() || t('ecommerce.product.new');
  const isDefault = activeLocale === defaultLocale;

  const saved = savedSlugs[activeLocale];
  const slugPreview =
    saved && saved.name === current.name.trim() ? saved.slug : convertToSlug(current.name);

  const clearErrors = (predicate: (path: string) => boolean) =>
    setErrors((map) => {
      const paths = Object.keys(map).filter(predicate);
      if (paths.length === 0) return map;
      const next = { ...map };
      paths.forEach((path) => delete next[path]);
      return next;
    });

  const setTranslationField = (
    field: 'name' | 'shortDescription' | 'description',
    value: string
  ) => {
    setForm((f) =>
      f
        ? {
            ...f,
            translations: {
              ...f.translations,
              [activeLocale]: { ...current, ...f.translations[activeLocale], [field]: value },
            },
          }
        : f
    );
    const path = `translations.${activeLocale}.${field}`;
    clearErrors((p) => p === path);
  };

  const errorText = (path: string) =>
    errors[path] ? t(`ecommerce.product.errors.${errors[path]}`) : undefined;

  const showErrors = (map: ErrorMap) => {
    setErrors(map);
    const paths = Object.keys(map);
    if (paths.some((path) => path.startsWith(`translations.${defaultLocale}.`))) {
      setActiveLocale(defaultLocale);
    } else {
      const locale = paths.find((path) => path.startsWith('translations.'))?.split('.')[1];
      if (locale) setActiveLocale(locale);
    }
    toggleNotification({ type: 'warning', message: t('ecommerce.product.errors.fix') });
  };

  const save = async () => {
    if (saving) return;
    const local = validateProductForm(form, defaultLocale);
    if (local.length) {
      showErrors(toErrorMap(local));
      return;
    }
    setSaving(true);
    try {
      const id = await new SaveProduct().execute(productId, buildProductInput(form));
      setErrors({});
      toggleNotification({ type: 'success', message: t('ecommerce.product.saved') });
      if (productId === undefined) {
        navigate(`${basePath}/${id}`, { replace: true });
      } else {
        // Reload to pick up ids of new variants and the slugs generated by the server.
        await new FetchProduct()
          .execute(id)
          .then((detail) => applyProduct(detail, codes))
          .catch(() => setLoadError(true));
      }
    } catch (err) {
      const fieldErrors = extractFieldErrors(err);
      if (fieldErrors) showErrors(toErrorMap(fieldErrors));
      else toggleNotification({ type: 'danger', message: t('ecommerce.product.saveError') });
    } finally {
      setSaving(false);
    }
  };

  /**
   * Like the module header: a saved product is enabled/disabled right away (other unsaved edits
   * stay in the form); a new product only changes the form, stored on its first save.
   */
  const toggleActive = async () => {
    if (!form || toggling) return;
    const next = !form.active;
    if (productId === undefined) {
      setForm((f) => (f ? { ...f, active: next } : f));
      return;
    }
    setToggling(true);
    try {
      const { active } = await new SetProductActive().execute(productId, next);
      setForm((f) => (f ? { ...f, active } : f));
      toggleNotification({
        type: 'success',
        message: t(active ? 'ecommerce.product.enabledNotice' : 'ecommerce.product.disabledNotice'),
      });
    } catch {
      toggleNotification({ type: 'danger', message: t('ecommerce.product.toggleError') });
    } finally {
      setToggling(false);
    }
  };

  const askDelete = () => setDeleteDialog(deletable ? 'confirm' : 'blocked');

  const deleteProduct = async () => {
    if (productId === undefined || deleting) return;
    setDeleting(true);
    try {
      await new DeleteProduct().execute(productId);
      toggleNotification({ type: 'success', message: t('ecommerce.product.deleted') });
      navigate(basePath, { replace: true });
    } catch (err: any) {
      // Ordered since the page was loaded: explain instead of a generic error.
      if (err?.response?.status === 409) {
        setDeletable(false);
        setDeleteDialog('blocked');
        return;
      }
      setDeleteDialog(null);
      toggleNotification({ type: 'danger', message: t('ecommerce.product.deleteError') });
    } finally {
      setDeleting(false);
    }
  };

  const translateWithAi = async () => {
    const request = buildTranslationRequest(form, defaultLocale, codes);
    if (!request) {
      toggleNotification({ type: 'info', message: t('ecommerce.product.ai.nothing') });
      return;
    }
    setTranslating(true);
    try {
      const result = await new TranslateProductStrings().execute(request);
      setForm((f) => (f ? applyTranslations(f, result.translations) : f));
      const failed = Number(result.failed) || 0;
      toggleNotification(
        failed > 0
          ? { type: 'warning', message: t('ecommerce.product.ai.partial', { failed }) }
          : { type: 'success', message: t('ecommerce.product.ai.done') }
      );
    } catch {
      toggleNotification({ type: 'danger', message: t('ecommerce.product.ai.error') });
    } finally {
      setTranslating(false);
    }
  };

  const openNewVariant = () => {
    newKeyCounter.current += 1;
    setModal({ index: null, newKey: `new-${newKeyCounter.current}` });
  };

  const confirmVariant = (variant: FormVariant) => {
    if (!modal) return;
    const index = modal.index ?? form.variants.length;
    setForm((f) => {
      if (!f) return f;
      const variants = [...f.variants];
      variants[index] = variant;
      return { ...f, variants };
    });
    clearErrors((p) => p === 'variants' || p.startsWith(`variants.${index}.`));
    setModal(null);
  };

  const setVariantActive = (variantId: number, active: boolean) =>
    setForm((f) =>
      f ? { ...f, variants: f.variants.map((v) => (v.id === variantId ? { ...v, active } : v)) } : f
    );

  const setVariantImages = (variantId: number, images: ImageRecord[]) =>
    setForm((f) =>
      f ? { ...f, variants: f.variants.map((v) => (v.id === variantId ? { ...v, images } : v)) } : f
    );

  const removeVariant = (index: number) => {
    setForm((f) => (f ? { ...f, variants: f.variants.filter((_, i) => i !== index) } : f));
    // Row indexes shift, so per-variant server errors no longer point at the right rows.
    clearErrors((p) => p.startsWith('variants.'));
  };

  const aiButton = (
    <Button
      variant="secondary"
      size="S"
      startIcon={<Sparkle />}
      onClick={translateWithAi}
      loading={translating}
      disabled={!aiAvailable || translating || saving}
    >
      {t('ecommerce.product.ai.translate')}
    </Button>
  );

  return (
    <Flex direction="column" alignItems="stretch" gap={6}>
      <Flex justifyContent="space-between" alignItems="center" gap={4}>
        <Flex gap={3} alignItems="center" style={{ minWidth: 0 }}>
          <IconButton label={t('ecommerce.product.back')} onClick={() => navigate(basePath)}>
            <ArrowLeft />
          </IconButton>
          <Typography variant="beta" tag="h1" ellipsis>
            {title}
          </Typography>
          {form.active ? (
            <Badge backgroundColor="success100" textColor="success700">
              {t('ecommerce.products.status.active')}
            </Badge>
          ) : (
            <Badge>{t('ecommerce.products.status.inactive')}</Badge>
          )}
        </Flex>
      </Flex>

      {/* In the module's fixed top bar, so they stay visible while the form scrolls. */}
      <HeaderActions>
        {productId !== undefined && (
          <Button
            variant="danger-light"
            onClick={askDelete}
            loading={deleting}
            disabled={saving || translating}
          >
            {t('ecommerce.product.delete')}
          </Button>
        )}
        <Button
          variant={form.active ? 'danger-light' : 'success-light'}
          onClick={() => setConfirmToggle(true)}
          loading={toggling}
          disabled={saving || deleting}
        >
          {t(form.active ? 'ecommerce.product.disable' : 'ecommerce.product.enable')}
        </Button>
        <Button onClick={save} loading={saving} disabled={translating || deleting}>
          {t('ecommerce.product.save')}
        </Button>
      </HeaderActions>

      <ActionConfirmModal
        open={confirmToggle}
        title={t(form.active ? 'ecommerce.product.disableConfirm.title' : 'ecommerce.product.enableConfirm.title')}
        text={t(form.active ? 'ecommerce.product.disableConfirm.text' : 'ecommerce.product.enableConfirm.text')}
        confirmLabel={t(form.active ? 'ecommerce.product.disable' : 'ecommerce.product.enable')}
        cancelLabel={t('ecommerce.product.deleteConfirm.cancel')}
        confirmVariant={form.active ? 'danger' : 'default'}
        onCancel={() => setConfirmToggle(false)}
        onConfirm={() => {
          setConfirmToggle(false);
          toggleActive();
        }}
      />

      <ConfirmModal
        open={deleteDialog === 'confirm'}
        title={t('ecommerce.product.deleteConfirm.title')}
        text={t('ecommerce.product.deleteConfirm.text')}
        confirm={{ button: t('ecommerce.product.delete'), action: deleteProduct }}
        cancel={{
          button: t('ecommerce.product.deleteConfirm.cancel'),
          action: () => setDeleteDialog(null),
        }}
      />
      <NoticeModal
        open={deleteDialog === 'blocked'}
        title={t('ecommerce.product.deleteBlocked.title')}
        text={t('ecommerce.product.deleteBlocked.text')}
        okLabel={t('ecommerce.product.ok')}
        onClose={() => setDeleteDialog(null)}
      />

      <Section
        title={t('ecommerce.product.information')}
        actions={
          aiAvailable ? (
            aiButton
          ) : (
            <Tooltip label={t('ecommerce.product.ai.unavailable')}>
              <span>{aiButton}</span>
            </Tooltip>
          )
        }
      >
        <LocaleSwitcher
          locales={locales}
          defaultLocale={defaultLocale}
          value={activeLocale}
          onChange={setActiveLocale}
          isFilled={(code) => !!form.translations[code]?.name.trim()}
          label={t('ecommerce.product.locale')}
        />

        <Field.Root
          name="name"
          required={isDefault}
          error={errorText(`translations.${activeLocale}.name`)}
          hint={
            isDefault ? undefined : t('ecommerce.product.fallbackHint', { locale: defaultLocale })
          }
        >
          <Field.Label>{t('ecommerce.product.name')}</Field.Label>
          <TextInput
            value={current.name}
            onChange={(e: any) => setTranslationField('name', e.target.value)}
          />
          <Field.Error />
          <Field.Hint />
        </Field.Root>

        <Field.Root name="slug" hint={t('ecommerce.product.slug.hint')}>
          <Field.Label>{t('ecommerce.product.slug')}</Field.Label>
          <TextInput value={slugPreview} readOnly disabled />
          <Field.Hint />
        </Field.Root>

        <Field.Root name="shortDescription">
          <Field.Label>{t('ecommerce.product.shortDescription')}</Field.Label>
          <Textarea
            value={current.shortDescription}
            onChange={(e: any) => setTranslationField('shortDescription', e.target.value)}
          />
        </Field.Root>

        <Field.Root
          name="description"
          id="ecommerce-product-description"
          required={isDefault}
          error={errorText(`translations.${activeLocale}.description`)}
        >
          <Field.Label id="ecommerce-product-description-label">
            {t('ecommerce.product.description')}
          </Field.Label>
          <DescriptionEditor
            key={activeLocale}
            id="ecommerce-product-description"
            ariaLabelledBy="ecommerce-product-description-label"
            value={current.description}
            onChange={(html) => setTranslationField('description', html)}
            hasError={!!errors[`translations.${activeLocale}.description`]}
            labels={{
              bold: t('ecommerce.product.editor.bold'),
              italic: t('ecommerce.product.editor.italic'),
              underline: t('ecommerce.product.editor.underline'),
            }}
          />
          <Field.Error />
        </Field.Root>
      </Section>

      <Section title={t('ecommerce.product.gallery')}>
        {productId !== undefined ? (
          <Gallery owner={{ productId }} images={productImages} onChange={setProductImages} />
        ) : (
          <Typography variant="omega" textColor="neutral600">
            {t('ecommerce.product.gallery.saveFirst')}
          </Typography>
        )}
      </Section>

      <Section title={t('ecommerce.product.variants')}>
        {errors.variants && (
          <Typography variant="omega" textColor="danger600" role="alert">
            {t(`ecommerce.product.errors.${errors.variants}`)}
          </Typography>
        )}
        <VariantsTable
          variants={form.variants}
          locale={activeLocale}
          defaultLocale={defaultLocale}
          errors={errors}
          onAdd={openNewVariant}
          onEdit={(index) => setModal({ index, newKey: form.variants[index].key })}
          onRemove={removeVariant}
          disabled={translating}
        />
      </Section>

      {modal && (
        <VariantModal
          variant={modal.index === null ? null : form.variants[modal.index]}
          newKey={modal.newKey}
          locales={locales}
          defaultLocale={defaultLocale}
          initialLocale={activeLocale}
          serverErrors={modal.index === null ? {} : scopedErrors(errors, `variants.${modal.index}`)}
          onClose={() => setModal(null)}
          onConfirm={confirmVariant}
          onImagesChange={setVariantImages}
          onActiveChange={setVariantActive}
        />
      )}
    </Flex>
  );
};

export { ProductEditPage };
