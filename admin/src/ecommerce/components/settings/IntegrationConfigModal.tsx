import { useState } from 'react';
import { useIntl } from 'react-intl';
import { useNotification } from '@strapi/strapi/admin';
import {
  Box,
  Button,
  Field,
  Flex,
  Modal,
  MultiSelect,
  MultiSelectOption,
  SingleSelect,
  SingleSelectOption,
  Switch,
  TextInput,
  Typography,
} from '@strapi/design-system';
import { getTranslation } from '../../../core/utils/getTranslation';
import UpdateIntegration from '../../usecases/settings/updateIntegration';
import { extractFieldErrors } from '../../utils/productForm';
import { extractErrorCode } from '../../utils/settingsForm';
import {
  buildIntegrationPayload,
  integrationErrorMap,
  integrationFormFromView,
  isIntegerText,
  type IntegrationFormValues,
  validateIntegrationForm,
  showsAsRequired,
} from '../../utils/integrationForm';
import type { IntegrationView, ProviderField, ShippingZone } from '../../settingsTypes';

/** Mount it only while open: the form is initialised once, from the props. */
type Props = {
  integration: IntegrationView;
  /** Errors to show on open (e.g. an activation refused for missing fields), keyed by field. */
  initialErrors?: Record<string, string>;
  /** The shipping zones offered by a `zones` field. */
  zones?: ShippingZone[];
  onClose: () => void;
  onSaved: (integration: IntegrationView) => void;
};

const IntegrationConfigModal = ({
  integration,
  initialErrors = {},
  zones = [],
  onClose,
  onSaved,
}: Props) => {
  const { formatMessage } = useIntl();
  const { toggleNotification } = useNotification();
  const t = (id: string, values?: Record<string, any>, defaultMessage?: string) =>
    formatMessage({ id: getTranslation(id), defaultMessage }, values);

  const [values, setValues] = useState<IntegrationFormValues>(() =>
    integrationFormFromView(integration)
  );
  const [errors, setErrors] = useState<Record<string, string>>(initialErrors);
  const [saving, setSaving] = useState(false);
  /** Stored optional secrets the user chose to delete on save. */
  const [clearedSecrets, setClearedSecrets] = useState<string[]>([]);

  const name = t(
    `ecommerce.settings.providers.${integration.id}.name`,
    undefined,
    integration.name
  );
  const hasSecrets = integration.fields.some((f) => f.type === 'secret');

  const setValue = (key: string, value: string | boolean | string[]) => {
    setValues((v) => ({ ...v, [key]: value }));
    setErrors((current) => {
      if (!(key in current)) return current;
      const { [key]: _removed, ...rest } = current;
      return rest;
    });
  };

  const save = async () => {
    if (saving) return;
    const local = validateIntegrationForm(integration.fields, values, integration.active);
    if (Object.keys(local).length) {
      setErrors(local);
      toggleNotification({ type: 'warning', message: t('ecommerce.settings.errors.fix') });
      return;
    }
    setSaving(true);
    try {
      const saved = await new UpdateIntegration().execute(
        integration.id,
        buildIntegrationPayload(integration.fields, values, clearedSecrets)
      );
      toggleNotification({ type: 'success', message: t('ecommerce.settings.saved') });
      onSaved(saved);
    } catch (err) {
      const fieldErrors = extractFieldErrors(err);
      const code = extractErrorCode(err);
      if (fieldErrors) {
        setErrors(integrationErrorMap(fieldErrors));
        toggleNotification({ type: 'warning', message: t('ecommerce.settings.errors.fix') });
      } else if (code) {
        toggleNotification({ type: 'danger', message: t(`ecommerce.settings.errors.${code}`) });
      } else {
        toggleNotification({ type: 'danger', message: t('ecommerce.settings.saveError') });
      }
    } finally {
      setSaving(false);
    }
  };

  const fieldInput = (field: ProviderField) => {
    const value = values[field.key];
    const hasError = !!errors[field.key];

    switch (field.type) {
      case 'boolean':
        return (
          <Flex gap={3}>
            <Switch
              checked={value === true}
              onCheckedChange={(checked: boolean) => setValue(field.key, checked)}
              aria-label={t(field.label, undefined, field.key)}
            />
          </Flex>
        );
      case 'select':
        return (
          <SingleSelect
            value={typeof value === 'string' ? value : ''}
            hasError={hasError}
            placeholder={t('ecommerce.settings.integrations.selectPlaceholder')}
            onChange={(next: string | number) => setValue(field.key, String(next))}
            onClear={field.required ? undefined : () => setValue(field.key, '')}
          >
            {(field.options ?? []).map((option) => (
              <SingleSelectOption key={option} value={option}>
                {t(`${field.label}.options.${option}`, undefined, option)}
              </SingleSelectOption>
            ))}
          </SingleSelect>
        );
      case 'secret': {
        const cleared = clearedSecrets.includes(field.key);
        const clearable = !field.required && !!integration.secrets[field.key];
        return (
          <Flex gap={2} alignItems="center">
            <Box flex="1">
              <TextInput
                type="password"
                autoComplete="new-password"
                value={typeof value === 'string' ? value : ''}
                placeholder={cleared ? '' : (integration.secrets[field.key] ?? '')}
                hasError={hasError}
                onChange={(e: any) => {
                  setValue(field.key, e.target.value);
                  // Typing a new value replaces the stored one instead of clearing it.
                  if (cleared) setClearedSecrets((keys) => keys.filter((k) => k !== field.key));
                }}
              />
            </Box>
            {clearable && (
              <Button
                variant="tertiary"
                size="L"
                onClick={() => {
                  setValue(field.key, '');
                  setClearedSecrets((keys) =>
                    cleared ? keys.filter((k) => k !== field.key) : [...keys, field.key]
                  );
                }}
              >
                {t(`ecommerce.settings.integrations.secret.${cleared ? 'undoClear' : 'clear'}`)}
              </Button>
            )}
          </Flex>
        );
      }
      case 'zones':
        if (zones.length === 0) {
          return (
            <Box background="warning100" borderColor="warning200" hasRadius padding={4}>
              <Typography textColor="neutral800">
                {t('ecommerce.settings.zones.createFirst')}
              </Typography>
            </Box>
          );
        }
        return (
          <MultiSelect
            withTags
            value={Array.isArray(value) ? value : []}
            hasError={hasError}
            onChange={(next: string[]) => setValue(field.key, next)}
          >
            {zones.map((zone) => (
              <MultiSelectOption key={zone.id} value={String(zone.id)}>
                {zone.name}
              </MultiSelectOption>
            ))}
          </MultiSelect>
        );
      case 'number':
        return (
          <TextInput
            inputMode="numeric"
            value={typeof value === 'string' ? value : ''}
            hasError={hasError}
            onChange={(e: any) => {
              const next = e.target.value.trim();
              if (isIntegerText(next)) setValue(field.key, next);
            }}
          />
        );
      default:
        return (
          <TextInput
            type={field.format === 'email' ? 'email' : 'text'}
            placeholder={typeof field.default === 'string' ? field.default : undefined}
            value={typeof value === 'string' ? value : ''}
            hasError={hasError}
            onChange={(e: any) => setValue(field.key, e.target.value)}
          />
        );
    }
  };

  const secretHint = (field: ProviderField) => {
    if (field.type !== 'secret') return undefined;
    if (clearedSecrets.includes(field.key)) {
      return t('ecommerce.settings.integrations.secret.clearHint');
    }
    if (integration.secretsStatus === 'unreadable') {
      return t('ecommerce.settings.integrations.secret.unreadableHint');
    }
    return integration.secrets[field.key]
      ? t('ecommerce.settings.integrations.secret.keepHint')
      : undefined;
  };

  return (
    <Modal.Root open onOpenChange={(next: boolean) => !next && onClose()}>
      <Modal.Content>
        <Modal.Header>
          <Modal.Title>{t('ecommerce.settings.integrations.configureTitle', { name })}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Flex direction="column" alignItems="stretch" gap={5}>
            {hasSecrets && !integration.encryptionKeyConfigured && (
              <Box background="warning100" borderColor="warning200" hasRadius padding={4}>
                <Typography textColor="neutral800">
                  {t('ecommerce.settings.errors.ENCRYPTION_KEY_MISSING')}
                </Typography>
              </Box>
            )}
            {integration.fields.map((field) => (
              <Field.Root
                key={field.key}
                name={field.key}
                required={showsAsRequired(field)}
                error={
                  errors[field.key]
                    ? t(`ecommerce.settings.errors.${errors[field.key]}`)
                    : undefined
                }
                hint={secretHint(field)}
              >
                <Field.Label>{t(field.label, undefined, field.key)}</Field.Label>
                {fieldInput(field)}
                <Field.Error />
                <Field.Hint />
              </Field.Root>
            ))}
          </Flex>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="tertiary" onClick={onClose}>
            {t('ecommerce.settings.cancel')}
          </Button>
          <Button onClick={save} loading={saving}>
            {t('ecommerce.settings.save')}
          </Button>
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
};

export { IntegrationConfigModal };
