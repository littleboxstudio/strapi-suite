import { useMemo, useState } from 'react';
import { useIntl } from 'react-intl';
import { useNotification } from '@strapi/strapi/admin';
import {
  Button,
  Field,
  Flex,
  Modal,
  MultiSelect,
  MultiSelectOption,
  TextInput,
} from '@strapi/design-system';
import { getTranslation } from '../../../core/utils/getTranslation';
import CreateShippingZone from '../../usecases/settings/createShippingZone';
import UpdateShippingZone from '../../usecases/settings/updateShippingZone';
import { extractFieldErrors } from '../../utils/productForm';
import { countryOptions } from '../../utils/settingsForm';
import {
  draftToZoneInput,
  emptyZoneDraft,
  zoneErrorMap,
  zoneCountryChoices,
  zoneToDraft,
  type ZoneDraft,
} from '../../utils/shippingZoneForm';
import type { ShippingZone } from '../../settingsTypes';

/** Mount it only while open: the draft is initialised once, from the props. */
type Props = {
  /** The zone being edited, or null to create one. */
  zone: ShippingZone | null;
  /** The store's markets: the only countries a zone can hold. */
  markets: string[];
  /** All zones: a country already in another zone is not offered. */
  zones: ShippingZone[];
  onClose: () => void;
  onSaved: (zone: ShippingZone) => void;
};

const ShippingZoneModal = ({ zone, markets, zones, onClose, onSaved }: Props) => {
  const { formatMessage, locale: uiLocale } = useIntl();
  const { toggleNotification } = useNotification();
  const t = (id: string, values?: Record<string, any>) =>
    formatMessage({ id: getTranslation(id) }, values);

  const [draft, setDraft] = useState<ZoneDraft>(() => (zone ? zoneToDraft(zone) : emptyZoneDraft()));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [conflictZones, setConflictZones] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  // Market countries not in another zone, plus the zone's own (even outside the markets).
  const options = useMemo(() => {
    const allowed = zoneCountryChoices(markets, zone, zones);
    return countryOptions(uiLocale).filter((o) => allowed.has(o.code));
  }, [markets, zone, zones, uiLocale]);

  const update = <K extends keyof ZoneDraft>(field: K, value: ZoneDraft[K]) => {
    setDraft((d) => ({ ...d, [field]: value }));
    setErrors((current) => {
      if (!(field in current)) return current;
      const { [field]: _removed, ...rest } = current;
      return rest;
    });
  };

  const errorText = (field: keyof ZoneDraft) =>
    errors[field]
      ? t(`ecommerce.settings.errors.${errors[field]}`, { zones: conflictZones.join(', ') })
      : undefined;

  const save = async () => {
    if (saving) return;
    const result = draftToZoneInput(draft);
    if (!result.input) {
      setErrors(result.errors);
      return;
    }
    setSaving(true);
    try {
      const saved = zone
        ? await new UpdateShippingZone().execute(zone.id, result.input)
        : await new CreateShippingZone().execute(result.input);
      toggleNotification({ type: 'success', message: t('ecommerce.settings.saved') });
      onSaved(saved);
    } catch (err) {
      const fieldErrors = extractFieldErrors(err);
      if (fieldErrors) {
        const mapped = zoneErrorMap(fieldErrors);
        setErrors(mapped.fields);
        setConflictZones(mapped.conflictZones);
        toggleNotification({ type: 'warning', message: t('ecommerce.settings.errors.fix') });
      } else {
        toggleNotification({ type: 'danger', message: t('ecommerce.settings.saveError') });
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal.Root open onOpenChange={(next: boolean) => !next && onClose()}>
      <Modal.Content>
        <Modal.Header>
          <Modal.Title>
            {t(
              zone
                ? 'ecommerce.settings.zones.modal.editTitle'
                : 'ecommerce.settings.zones.modal.createTitle'
            )}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Flex direction="column" alignItems="stretch" gap={5}>
            <Field.Root name="name" required error={errorText('name')}>
              <Field.Label>{t('ecommerce.settings.zones.fields.name')}</Field.Label>
              <TextInput value={draft.name} onChange={(e: any) => update('name', e.target.value)} />
              <Field.Error />
            </Field.Root>
            <Field.Root
              name="countries"
              required
              error={errorText('countries')}
              hint={t('ecommerce.settings.zones.fields.countries.hint')}
            >
              <Field.Label>{t('ecommerce.settings.zones.fields.countries')}</Field.Label>
              <MultiSelect
                withTags
                value={draft.countries}
                hasError={!!errors.countries}
                onChange={(value: string[]) => update('countries', value)}
              >
                {options.map(({ code, name }) => (
                  <MultiSelectOption key={code} value={code}>
                    {name}
                  </MultiSelectOption>
                ))}
              </MultiSelect>
              <Field.Error />
              <Field.Hint />
            </Field.Root>
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

export { ShippingZoneModal };
