import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useIntl } from 'react-intl';
import { useNavigate, useParams } from 'react-router-dom';
import { useNotification } from '@strapi/strapi/admin';
import {
  Alert,
  Badge,
  Box,
  Button,
  Field,
  Flex,
  IconButton,
  Loader,
  Radio,
  Switch,
  Textarea,
  TextInput,
  Typography,
} from '@strapi/design-system';
import { ArrowLeft, Plus, Trash } from '@strapi/icons';
import config from '../../../core/config';
import { getTranslation } from '../../../core/utils/getTranslation';
import ConfirmModal from '../../../components/ConfirmModal';
import FetchPromotion from '../../usecases/promotions/fetchPromotion';
import FetchPromotionEditorContext from '../../usecases/promotions/fetchPromotionEditorContext';
import SavePromotion from '../../usecases/promotions/savePromotion';
import DeletePromotion from '../../usecases/promotions/deletePromotion';
import { LocaleSwitcher } from '../../components/LocaleSwitcher';
import ConditionGroupEditor from '../../components/promotions/ConditionGroupEditor';
import BenefitEditor from '../../components/promotions/BenefitEditor';
import EligibilityFields from '../../components/promotions/EligibilityFields';
import LimitsFields from '../../components/promotions/LimitsFields';
import StackingFields from '../../components/promotions/StackingFields';
import PromotionSummary from '../../components/promotions/PromotionSummary';
import RedemptionsTable from '../../components/promotions/RedemptionsTable';
import { usePromotionPermissions } from '../../hooks/usePromotionPermissions';
import { formatCents } from '../../utils/money';
import { apiErrorCode } from '../../utils/orderDetail';
import { statusTone } from '../../utils/promotionList';
import {
  clearErrorsUnder,
  deactivationInput,
  describeBenefit,
  emptyBenefit,
  emptyPromotionForm,
  errorMapFromIssues,
  MAX_BENEFITS,
  promotionFormFromView,
  toBenefit,
  toPromotionInput,
  unmappedErrors,
  validatePromotionForm,
  wallTimeNow,
  type FormSection,
  type PromotionErrors,
  type PromotionForm,
} from '../../utils/promotionForm';
import type { Promotion, PromotionEditorContext, PromotionMethod } from '../../promotionTypes';

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <Box background="neutral0" shadow="tableShadow" hasRadius padding={6}>
    <Flex direction="column" alignItems="stretch" gap={5}>
      <Typography variant="delta" tag="h2">
        {title}
      </Typography>
      {children}
    </Flex>
  </Box>
);

type LoadState = 'loading' | 'ready' | 'error' | 'notFound';

const PromotionEditPage = () => {
  const { formatMessage, locale } = useIntl();
  const navigate = useNavigate();
  const { toggleNotification } = useNotification();
  const { isLoading: permissionsLoading, canRead, canManage } = usePromotionPermissions();
  const params = useParams<{ id: string }>();
  const promotionId = params.id && /^\d+$/.test(params.id) ? Number(params.id) : undefined;
  const isNew = params.id === undefined || params.id === 'new';
  const basePath = `/plugins/${config.pluginId}/ecommerce/promotions`;
  const t = (id: string, values?: Record<string, any>) => formatMessage({ id: getTranslation(id) }, values);
  const p = 'ecommerce.promotions.form';

  const [context, setContext] = useState<PromotionEditorContext | null>(null);
  const [view, setView] = useState<Promotion | null>(null);
  const [form, setForm] = useState<PromotionForm | null>(null);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [activeLocale, setActiveLocale] = useState('');
  const [errors, setErrors] = useState<PromotionErrors>({});
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [inUse, setInUse] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const applyView = useCallback(
    (promotion: Promotion) => {
      setView(promotion);
      setForm(promotionFormFromView(promotion, locale));
    },
    [locale]
  );

  useEffect(() => {
    if (!canRead) return undefined;
    let cancelled = false;
    setLoadState('loading');
    setErrors({});
    setConflict(false);
    setInUse(false);
    (async () => {
      try {
        const ctx = await new FetchPromotionEditorContext().execute();
        if (cancelled) return;
        setContext(ctx);
        setActiveLocale((current) => current || ctx.defaultLocale);
        if (isNew) {
          setView(null);
          setForm(emptyPromotionForm(ctx.defaultLocale, wallTimeNow(ctx.timezone)));
        } else if (promotionId === undefined) {
          setLoadState('notFound');
          return;
        } else {
          const promotion = await new FetchPromotion().execute(promotionId);
          if (cancelled) return;
          applyView(promotion);
        }
        setLoadState('ready');
      } catch (err) {
        if (cancelled) return;
        setLoadState((err as any)?.response?.status === 404 ? 'notFound' : 'error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [canRead, isNew, promotionId, reloadKey, applyView]);

  if (permissionsLoading || (canRead && loadState === 'loading')) {
    return (
      <Flex justifyContent="center" padding={8}>
        <Loader />
      </Flex>
    );
  }
  if (!canRead) {
    return <Typography textColor="neutral600">{t('ecommerce.promotions.forbidden')}</Typography>;
  }
  if (loadState === 'notFound') {
    return <Typography textColor="neutral600">{t(`${p}.notFound`)}</Typography>;
  }
  if (loadState === 'error' || !form || !context) {
    return <Typography textColor="danger600">{t(`${p}.loadError`)}</Typography>;
  }

  const readOnly = !canManage;
  // Saving disables the controls; only a read-only admin has them hidden (stable layout).
  const disabled = readOnly || saving;
  const timezone = view?.timezone ?? context.timezone;
  const localeCodes = context.locales.map((l) => l.code);
  const money = (cents: number) => formatCents(cents, locale);
  const errorText = (path: string) => (errors[path] ? t(`${p}.errors.${errors[path]}`) : undefined);
  const unmapped = unmappedErrors(errors);
  /** Server errors no field shows (e.g. `stacking.withOrder`), listed in their section. */
  const sectionErrors = (section: FormSection) => {
    const list = unmapped.filter((e) => e.section === section);
    if (!list.length) return null;
    return (
      <Flex direction="column" alignItems="flex-start" gap={1} role="alert">
        {list.map((e) => (
          <Typography key={e.path} variant="pi" textColor="danger600">
            {t(`${p}.errors.unmapped`, {
              path: e.path,
              message: formatMessage({
                id: getTranslation(`${p}.errors.${e.code}`),
                defaultMessage: e.code,
              }),
            })}
          </Typography>
        ))}
      </Flex>
    );
  };

  const update = (patch: Partial<PromotionForm>, clear: string[] = []) => {
    setForm((f) => (f ? { ...f, ...patch } : f));
    if (clear.length) setErrors((map) => clear.reduce(clearErrorsUnder, map));
  };

  const showErrors = (map: PromotionErrors) => {
    setErrors(map);
    const localePath = Object.keys(map).find((k) => k.startsWith('displayName.'));
    if (localePath) setActiveLocale(localePath.split('.')[1]);
    toggleNotification({ type: 'warning', message: t(`${p}.fix`) });
  };

  const save = async (next: PromotionForm = form) => {
    if (saving || readOnly) return;
    const local = validatePromotionForm(next, timezone);
    if (Object.keys(local).length) {
      showErrors(local);
      return;
    }
    setSaving(true);
    try {
      const body = { ...toPromotionInput(next, localeCodes), ...(view ? { version: view.version } : {}) };
      const saved = await new SavePromotion().execute(body, view?.id);
      setErrors({});
      setInUse(false);
      toggleNotification({ type: 'success', message: t(`${p}.saved`) });
      if (!view) navigate(`${basePath}/${saved.id}`, { replace: true });
      else applyView(saved);
    } catch (err) {
      const code = apiErrorCode(err);
      const issues = (err as any)?.response?.data?.error?.details?.errors;
      if (code === 'PROMOTION_VERSION_CONFLICT') setConflict(true);
      else if (Array.isArray(issues) && issues.length) showErrors(errorMapFromIssues(issues));
      else toggleNotification({ type: 'danger', message: t(`${p}.saveError`) });
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setConfirmDelete(false);
    if (!view || saving) return;
    setSaving(true);
    try {
      await new DeletePromotion().execute(view.id);
      toggleNotification({ type: 'success', message: t(`${p}.deleted`) });
      navigate(basePath);
    } catch (err) {
      if (apiErrorCode(err) === 'PROMOTION_IN_USE') setInUse(true);
      else toggleNotification({ type: 'danger', message: t(`${p}.deleteError`) });
    } finally {
      setSaving(false);
    }
  };

  /**
   * Saves only the deactivation: the stored definition with `active: false` and the loaded
   * version. Unsaved edits stay in the form (not saved) and the next Save uses the new version.
   */
  const deactivate = async () => {
    if (!view || saving || readOnly) return;
    setSaving(true);
    try {
      const saved = await new SavePromotion().execute(deactivationInput(view, localeCodes), view.id);
      setView(saved);
      setForm((f) => (f ? { ...f, active: false } : f));
      setInUse(false);
      toggleNotification({ type: 'success', message: t(`${p}.deactivated`) });
    } catch (err) {
      if (apiErrorCode(err) === 'PROMOTION_VERSION_CONFLICT') setConflict(true);
      else toggleNotification({ type: 'danger', message: t(`${p}.saveError`) });
    } finally {
      setSaving(false);
    }
  };

  const title = form.name.trim() || view?.name || t(`${p}.new`);
  const isDefaultLocale = activeLocale === context.defaultLocale;
  const setMethod = (method: PromotionMethod) => update({ method }, ['code']);

  return (
    <Flex direction="column" alignItems="stretch" gap={6}>
      <Flex justifyContent="space-between" alignItems="center" gap={4} wrap="wrap">
        <Flex gap={3} alignItems="center" style={{ minWidth: 0 }}>
          <IconButton label={t(`${p}.back`)} onClick={() => navigate(basePath)}>
            <ArrowLeft />
          </IconButton>
          <Typography variant="beta" tag="h1" ellipsis>
            {title}
          </Typography>
          {view && (
            <Badge variant={statusTone(view.status)} size="S">
              {t(`ecommerce.promotions.statuses.${view.status}`)}
            </Badge>
          )}
        </Flex>
        {!readOnly && (
          <Flex gap={2}>
            {view && (
              <Button variant="danger-light" startIcon={<Trash />} disabled={saving} onClick={() => setConfirmDelete(true)}>
                {t(`${p}.delete`)}
              </Button>
            )}
            <Button onClick={() => save()} loading={saving}>
              {t(`${p}.save`)}
            </Button>
          </Flex>
        )}
      </Flex>

      {readOnly && (
        <Alert variant="default" closeLabel={t(`${p}.close`)}>
          {t(`${p}.readOnly`)}
        </Alert>
      )}

      {conflict && (
        <Alert
          variant="warning"
          title={t(`${p}.conflict.title`)}
          closeLabel={t(`${p}.close`)}
          onClose={() => setConflict(false)}
          action={
            <Button variant="secondary" size="S" onClick={() => setReloadKey((k) => k + 1)}>
              {t(`${p}.conflict.reload`)}
            </Button>
          }
        >
          {t(`${p}.conflict.text`)}
        </Alert>
      )}

      {inUse && (
        <Alert
          variant="warning"
          title={t(`${p}.inUse.title`)}
          closeLabel={t(`${p}.close`)}
          onClose={() => setInUse(false)}
          action={
            view?.active ? (
              <Button variant="secondary" size="S" loading={saving} onClick={deactivate}>
                {t(`${p}.inUse.deactivate`)}
              </Button>
            ) : undefined
          }
        >
          {t(`${p}.inUse.text`)}
        </Alert>
      )}

      {sectionErrors('other')}

      {/* 1. General information */}
      <Section title={t(`${p}.sections.general`)}>
        <Flex gap={4} alignItems="flex-start" wrap="wrap">
          <Box style={{ flex: '2 1 280px' }}>
            <Field.Root name="name" required error={errorText('name')} hint={t(`${p}.name.hint`)}>
              <Field.Label>{t(`${p}.name`)}</Field.Label>
              <TextInput
                value={form.name}
                disabled={disabled}
                onChange={(e: any) => update({ name: e.target.value }, ['name'])}
              />
              <Field.Error />
              <Field.Hint />
            </Field.Root>
          </Box>
          <Box style={{ flex: '1 1 160px' }}>
            <Field.Root name="priority" error={errorText('priority')} hint={t(`${p}.priority.hint`)}>
              <Field.Label>{t(`${p}.priority`)}</Field.Label>
              <TextInput
                value={form.priority}
                inputMode="numeric"
                disabled={disabled}
                onChange={(e: any) => update({ priority: e.target.value }, ['priority'])}
              />
              <Field.Error />
              <Field.Hint />
            </Field.Root>
          </Box>
          <Flex gap={2} alignItems="center" paddingTop={6}>
            <Switch
              checked={form.active}
              disabled={disabled}
              onCheckedChange={(checked: boolean) => update({ active: checked })}
              aria-label={t(`${p}.active`)}
            />
            <Typography variant="omega">{t(`${p}.active`)}</Typography>
          </Flex>
        </Flex>

        <Field.Root name="description" error={errorText('description')}>
          <Field.Label>{t(`${p}.description`)}</Field.Label>
          <Textarea
            value={form.description}
            disabled={disabled}
            onChange={(e: any) => update({ description: e.target.value }, ['description'])}
          />
          <Field.Error />
        </Field.Root>

        {sectionErrors('general')}

        <Flex direction="column" alignItems="stretch" gap={3}>
          <LocaleSwitcher
            locales={context.locales}
            defaultLocale={context.defaultLocale}
            value={activeLocale}
            onChange={setActiveLocale}
            isFilled={(code) => !!form.displayName[code]?.trim()}
            label={t(`${p}.locale`)}
          />
          <Field.Root
            name={`displayName.${activeLocale}`}
            error={errorText(`displayName.${activeLocale}`)}
            hint={
              isDefaultLocale
                ? t(`${p}.displayName.hint`)
                : t(`${p}.displayName.fallback`, { locale: context.defaultLocale })
            }
          >
            <Field.Label>{t(`${p}.displayName`)}</Field.Label>
            <TextInput
              value={form.displayName[activeLocale] ?? ''}
              disabled={disabled}
              onChange={(e: any) =>
                update({ displayName: { ...form.displayName, [activeLocale]: e.target.value } }, [
                  `displayName.${activeLocale}`,
                ])
              }
            />
            <Field.Error />
            <Field.Hint />
          </Field.Root>
        </Flex>
      </Section>

      {/* 2. Method */}
      <Section title={t(`${p}.sections.method`)}>
        <Radio.Group
          value={form.method}
          disabled={disabled}
          aria-label={t(`${p}.sections.method`)}
          onValueChange={(value: string) => setMethod(value as PromotionMethod)}
        >
          {(['CODE', 'AUTOMATIC'] as const).map((method) => (
            <Radio.Item key={method} value={method}>
              <Flex direction="column" alignItems="flex-start">
                <Typography textColor="neutral800">{t(`${p}.method.${method}`)}</Typography>
                <Typography variant="pi" textColor="neutral600">
                  {t(`${p}.method.${method}.hint`)}
                </Typography>
              </Flex>
            </Radio.Item>
          ))}
        </Radio.Group>
        {sectionErrors('method')}
        <Box style={{ maxWidth: 420 }}>
          <Field.Root
            name="code"
            required={form.method === 'CODE'}
            error={errorText('code')}
            hint={form.method === 'CODE' ? t(`${p}.code.hint`) : t(`${p}.campaign.hint`)}
          >
            <Field.Label>{form.method === 'CODE' ? t(`${p}.code`) : t(`${p}.campaign`)}</Field.Label>
            <TextInput
              value={form.code}
              disabled={disabled}
              maxLength={40}
              style={{ fontFamily: 'monospace' }}
              onChange={(e: any) => update({ code: String(e.target.value).toUpperCase() }, ['code'])}
            />
            <Field.Error />
            <Field.Hint />
          </Field.Root>
        </Box>
      </Section>

      {/* 3. Validity */}
      <Section title={t(`${p}.sections.validity`)}>
        <Flex gap={4} alignItems="flex-start" wrap="wrap">
          <Box style={{ flex: '1 1 240px' }}>
            <Field.Root name="startsAt" required error={errorText('startsAt')}>
              <Field.Label>{t(`${p}.startsAt`)}</Field.Label>
              <TextInput
                type="datetime-local"
                value={form.startsAt}
                disabled={disabled}
                onChange={(e: any) => update({ startsAt: e.target.value }, ['startsAt', 'endsAt'])}
              />
              <Field.Error />
            </Field.Root>
          </Box>
          <Box style={{ flex: '1 1 240px' }}>
            <Field.Root name="endsAt" error={errorText('endsAt')}>
              <Field.Label>{t(`${p}.endsAt`)}</Field.Label>
              <TextInput
                type="datetime-local"
                value={form.endsAt}
                disabled={disabled}
                onChange={(e: any) => update({ endsAt: e.target.value }, ['endsAt'])}
              />
              <Field.Error />
            </Field.Root>
          </Box>
        </Flex>
        <Typography variant="pi" textColor="neutral600">
          {t(`${p}.timezone`, { timezone })}
        </Typography>
        {sectionErrors('validity')}
        {errors.timeZone && (
          <Typography variant="pi" textColor="danger600" role="alert">
            {t(`${p}.errors.${errors.timeZone}`)}
          </Typography>
        )}
      </Section>

      {/* 4. Eligibility */}
      <Section title={t(`${p}.sections.eligibility`)}>
        <EligibilityFields
          mode={form.eligibilityMode}
          emails={form.emails}
          errors={errors}
          disabled={disabled}
          onChange={(patch) => update(patch, ['eligibility'])}
        />
        {sectionErrors('eligibility')}
      </Section>

      {/* 5. Conditions */}
      <Section title={t(`${p}.sections.conditions`)}>
        <ConditionGroupEditor
          tree={form.conditions}
          onChange={(conditions) =>
            // Paths shift when nodes move, so the old condition errors no longer point at the right rows.
            update({ conditions }, ['conditions'])
          }
          labels={form.labels}
          onLabels={(labels) => update({ labels })}
          errors={errors}
          disabled={disabled}
          readOnly={readOnly}
        />
        {sectionErrors('conditions')}
      </Section>

      {/* 6. Benefits */}
      <Section title={t(`${p}.sections.benefits`)}>
        {errors.benefits && (
          <Typography variant="omega" textColor="danger600" role="alert">
            {t(`${p}.benefits.count`)}
          </Typography>
        )}
        {sectionErrors('benefits')}
        {form.benefits.map((benefit, index) => (
          <BenefitEditor
            key={benefit.key}
            benefit={benefit}
            index={index}
            labels={form.labels}
            onLabels={(labels) => update({ labels })}
            errors={errors}
            disabled={disabled}
            readOnly={readOnly}
            summary={describeBenefit(toBenefit(benefit), money, t)}
            onChange={(next) =>
              update({ benefits: form.benefits.map((b, i) => (i === index ? next : b)) }, [`benefits.${index}`])
            }
            onRemove={() => update({ benefits: form.benefits.filter((_, i) => i !== index) }, ['benefits'])}
          />
        ))}
        {!readOnly && (
          <Box>
            <Button
              variant="secondary"
              startIcon={<Plus />}
              disabled={saving || form.benefits.length >= MAX_BENEFITS}
              onClick={() => update({ benefits: [...form.benefits, emptyBenefit()] }, ['benefits'])}
            >
              {t(`${p}.benefits.add`)}
            </Button>
          </Box>
        )}
      </Section>

      {/* 7. Limits */}
      <Section title={t(`${p}.sections.limits`)}>
        <LimitsFields
          values={{
            usageLimit: form.usageLimit,
            perCustomerLimit: form.perCustomerLimit,
            perOrderLimit: form.perOrderLimit,
          }}
          errors={errors}
          disabled={disabled}
          onChange={(key, value) => update({ [key]: value } as Partial<PromotionForm>, [key])}
        />
        {sectionErrors('limits')}
      </Section>

      {/* 8. Stacking */}
      <Section title={t(`${p}.sections.stacking`)}>
        <StackingFields
          stacking={form.stacking}
          disabled={disabled}
          onChange={(stacking) => update({ stacking }, ['stacking'])}
        />
        {sectionErrors('stacking')}
      </Section>

      {/* 9. Summary */}
      <Section title={t(`${p}.sections.summary`)}>
        <PromotionSummary form={form} />
        {!readOnly && (
          <Flex justifyContent="flex-end">
            <Button onClick={() => save()} loading={saving}>
              {t(`${p}.save`)}
            </Button>
          </Flex>
        )}
      </Section>

      {view && (
        <Section title={t(`${p}.sections.usage`)}>
          <RedemptionsTable promotionId={view.id} />
        </Section>
      )}

      <ConfirmModal
        open={confirmDelete}
        title={t(`${p}.deleteTitle`)}
        text={t(`${p}.deleteText`, { name: view?.name ?? '' })}
        confirm={{ button: t(`${p}.deleteConfirm`), action: remove }}
        cancel={{ button: t(`${p}.deleteCancel`), action: () => setConfirmDelete(false) }}
      />
    </Flex>
  );
};

export { PromotionEditPage };
