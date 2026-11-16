import { useState } from 'react';
import { useIntl } from 'react-intl';
import { Button, Flex, Modal } from '@strapi/design-system';
import { getTranslation } from '../../../core/utils/getTranslation';
import { MarketRatesEditor } from './MarketRatesEditor';
import { MethodNameTaxFields } from './MethodNameTaxFields';
import {
  dpdServiceMarkets,
  dpdServiceToDraft,
  draftToDpdService,
} from '../../utils/dpdServicesForm';
import type { ManualMethodDraft, ManualMethodErrors } from '../../utils/manualMethodForm';
import type { DpdService, DpdServiceId } from '../../settingsTypes';

/** Mount it only while open: the draft is initialised once, from the props. */
type Props = {
  id: DpdServiceId;
  service: DpdService;
  locales: { code: string; name: string }[];
  defaultLocale: string;
  /** The store markets (PICKUP keeps only PT and PT-ISL). */
  markets: string[];
  onClose: () => void;
  /**
   * Saves the service (with the other one unchanged). Resolves to the server errors of this
   * service (keyed like the draft), or null when it was saved.
   */
  onSave: (service: DpdService) => Promise<ManualMethodErrors | null>;
};

/**
 * Edits one DPD service like a manual shipping method: the name per locale, the VAT rate and the
 * rate table. Switching the service on or off is done from the services table.
 */
const DpdServiceModal = ({
  id,
  service,
  locales,
  defaultLocale,
  markets: storeMarkets,
  onClose,
  onSave,
}: Props) => {
  const { formatMessage, locale: uiLocale } = useIntl();
  const t = (key: string, values?: Record<string, any>) =>
    formatMessage({ id: getTranslation(key) }, values);
  /** The markets this service may have prices for (PICKUP: PT and PT-ISL only). */
  const markets = dpdServiceMarkets(id, storeMarkets);

  const [draft, setDraft] = useState<ManualMethodDraft>(() =>
    dpdServiceToDraft(
      service,
      locales.map((l) => l.code),
      uiLocale,
      markets
    )
  );
  const [errors, setErrors] = useState<ManualMethodErrors>({});
  const [errorRound, setErrorRound] = useState(0);
  const [locale, setLocale] = useState(defaultLocale);
  const [saving, setSaving] = useState(false);

  const clearError = (path: string) =>
    setErrors((current) => {
      if (!(path in current)) return current;
      const { [path]: _removed, ...rest } = current;
      return rest;
    });

  const clearErrorsUnder = (prefix: string) =>
    setErrors((current) => {
      const keys = Object.keys(current).filter((k) => k === prefix || k.startsWith(`${prefix}.`));
      if (keys.length === 0) return current;
      const rest = { ...current };
      keys.forEach((k) => delete rest[k]);
      return rest;
    });

  const update = <K extends keyof ManualMethodDraft>(
    field: K,
    value: ManualMethodDraft[K],
    errorPath: string = field
  ) => {
    setDraft((d) => ({ ...d, [field]: value }));
    clearError(errorPath);
  };

  const showErrors = (map: ManualMethodErrors) => {
    setErrors(map);
    setErrorRound((n) => n + 1);
    if (map[`name.${defaultLocale}`]) setLocale(defaultLocale);
  };

  const save = async () => {
    if (saving) return;
    const result = draftToDpdService(draft, defaultLocale);
    if (!result.service) {
      showErrors(result.errors);
      return;
    }
    setSaving(true);
    try {
      const serverErrors = await onSave(result.service);
      if (serverErrors) showErrors(serverErrors);
    } finally {
      setSaving(false);
    }
  };

  const title = t(`ecommerce.settings.dpdServices.services.${id}`);

  return (
    <Modal.Root open onOpenChange={(next: boolean) => !next && onClose()}>
      <Modal.Content>
        <Modal.Header>
          <Modal.Title>
            {t('ecommerce.settings.dpdServices.editTitle', { service: title })}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Flex direction="column" alignItems="stretch" gap={5}>
            <MethodNameTaxFields
              locales={locales}
              defaultLocale={defaultLocale}
              locale={locale}
              onLocaleChange={setLocale}
              draft={draft}
              errors={errors}
              update={update}
            />
            <MarketRatesEditor
              markets={markets}
              value={draft}
              onChange={(change) => setDraft((d) => ({ ...d, ...change(d) }))}
              errors={errors}
              errorRound={errorRound}
              clearError={clearError}
              clearErrorsUnder={clearErrorsUnder}
              required={false}
              emptyText={t('ecommerce.settings.dpdServices.noMarketsSelected')}
            />
          </Flex>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="tertiary" onClick={onClose}>
            {t('ecommerce.settings.cancel')}
          </Button>
          <Button variant="secondary" onClick={save} loading={saving} disabled={markets.length === 0}>
            {t('ecommerce.settings.save')}
          </Button>
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
};

export { DpdServiceModal };
