import { useState } from 'react';
import { useIntl } from 'react-intl';
import { useNotification } from '@strapi/strapi/admin';
import { Button, Flex, Modal } from '@strapi/design-system';
import { getTranslation } from '../../../core/utils/getTranslation';
import { ActionConfirmModal } from '../ActionConfirmModal';
import { MarketRatesEditor } from './MarketRatesEditor';
import { MethodNameTaxFields } from './MethodNameTaxFields';
import CreateShippingMethod from '../../usecases/settings/createShippingMethod';
import UpdateShippingMethod from '../../usecases/settings/updateShippingMethod';
import { extractFieldErrors } from '../../utils/productForm';
import {
  draftToManualMethodInput,
  emptyManualMethodDraft,
  manualMethodErrorMap,
  manualMethodToDraft,
  type ManualMethodDraft,
  type ManualMethodErrors,
} from '../../utils/manualMethodForm';
import type { ManualMethod } from '../../settingsTypes';

/** Mount it only while open: the draft is initialised once, from the props. */
type Props = {
  /** The method being edited, or null to create one. */
  method: ManualMethod | null;
  locales: { code: string; name: string }[];
  defaultLocale: string;
  /** The store markets (country codes); without any the method cannot be saved. */
  markets: string[];
  onClose: () => void;
  onSaved: (method: ManualMethod) => void;
  /** A saved method was enabled or disabled from the footer (applied right away). */
  onActiveChange: (method: ManualMethod) => void;
};

const ManualMethodModal = ({
  method,
  locales,
  defaultLocale,
  markets,
  onClose,
  onSaved,
  onActiveChange,
}: Props) => {
  const { formatMessage, locale: uiLocale } = useIntl();
  const { toggleNotification } = useNotification();
  const t = (id: string, values?: Record<string, any>) =>
    formatMessage({ id: getTranslation(id) }, values);
  const codes = locales.map((l) => l.code);

  const [draft, setDraft] = useState<ManualMethodDraft>(() =>
    method ? manualMethodToDraft(method, codes, uiLocale, markets) : emptyManualMethodDraft(codes)
  );
  const [errors, setErrors] = useState<ManualMethodErrors>({});
  const [locale, setLocale] = useState(defaultLocale);
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [confirmToggle, setConfirmToggle] = useState(false);

  /**
   * Like the variant button: a saved method is enabled/disabled right away; a new one only in the
   * draft (stored when it is saved).
   */
  const toggleActive = async () => {
    if (toggling) return;
    const next = !draft.active;
    if (!method) {
      setDraft((d) => ({ ...d, active: next }));
      return;
    }
    setToggling(true);
    try {
      const saved = await new UpdateShippingMethod().execute(method.id, { active: next });
      setDraft((d) => ({ ...d, active: saved.active }));
      onActiveChange(saved);
      toggleNotification({
        type: 'success',
        message: t(
          saved.active
            ? 'ecommerce.settings.manualMethods.enabledNotice'
            : 'ecommerce.settings.manualMethods.disabledNotice'
        ),
      });
    } catch {
      toggleNotification({
        type: 'danger',
        message: t('ecommerce.settings.manualMethods.toggleError'),
      });
    } finally {
      setToggling(false);
    }
  };

  const namePath = (code: string) => `name.${code}`;

  const clearError = (path: string) =>
    setErrors((current) => {
      if (!(path in current)) return current;
      const { [path]: _removed, ...rest } = current;
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

  /** Drops every error whose path is `prefix` or below it (row indexes shift on add/remove). */
  const clearErrorsUnder = (prefix: string) =>
    setErrors((current) => {
      const keys = Object.keys(current).filter((k) => k === prefix || k.startsWith(`${prefix}.`));
      if (keys.length === 0) return current;
      const rest = { ...current };
      keys.forEach((k) => delete rest[k]);
      return rest;
    });

  /** Bumped when errors are shown: clears the market search so no market with an error is hidden. */
  const [errorRound, setErrorRound] = useState(0);

  const showErrors = (map: ManualMethodErrors) => {
    setErrors(map);
    setErrorRound((n) => n + 1);
    // The default-locale name is the only required name: show it if that is what failed.
    if (map[namePath(defaultLocale)]) setLocale(defaultLocale);
  };

  const save = async () => {
    if (saving || markets.length === 0) return;
    const result = draftToManualMethodInput(draft, defaultLocale);
    if (!result.input) {
      showErrors(result.errors);
      return;
    }
    setSaving(true);
    try {
      const saved = method
        ? await new UpdateShippingMethod().execute(method.id, result.input)
        : await new CreateShippingMethod().execute(result.input);
      toggleNotification({ type: 'success', message: t('ecommerce.settings.saved') });
      onSaved(saved);
    } catch (err) {
      const fieldErrors = extractFieldErrors(err);
      if (fieldErrors) {
        showErrors(manualMethodErrorMap(fieldErrors));
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
              method
                ? 'ecommerce.settings.manualMethods.editTitle'
                : 'ecommerce.settings.manualMethods.addTitle'
            )}
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
            />
          </Flex>
        </Modal.Body>
        <Modal.Footer>
          <Flex gap={2}>
            <Button variant="tertiary" onClick={onClose}>
              {t('ecommerce.settings.cancel')}
            </Button>
            {/* Same as the variant's button: confirmed, then applied immediately on a saved method. */}
            <Button
              variant={draft.active ? 'danger-light' : 'success-light'}
              onClick={() => setConfirmToggle(true)}
              loading={toggling}
              disabled={saving}
            >
              {t(
                draft.active
                  ? 'ecommerce.settings.manualMethods.disable'
                  : 'ecommerce.settings.manualMethods.enable'
              )}
            </Button>
          </Flex>
          <Button variant="secondary" onClick={save} loading={saving} disabled={markets.length === 0 || toggling}>
            {t('ecommerce.settings.save')}
          </Button>
        </Modal.Footer>
      </Modal.Content>
      <ActionConfirmModal
        open={confirmToggle}
        title={t(
          draft.active
            ? 'ecommerce.settings.manualMethods.disableConfirm.title'
            : 'ecommerce.settings.manualMethods.enableConfirm.title'
        )}
        text={t(
          draft.active
            ? 'ecommerce.settings.manualMethods.disableConfirm.text'
            : 'ecommerce.settings.manualMethods.enableConfirm.text'
        )}
        confirmLabel={t(
          draft.active
            ? 'ecommerce.settings.manualMethods.disable'
            : 'ecommerce.settings.manualMethods.enable'
        )}
        cancelLabel={t('ecommerce.settings.cancel')}
        confirmVariant={draft.active ? 'danger' : 'default'}
        onCancel={() => setConfirmToggle(false)}
        onConfirm={() => {
          setConfirmToggle(false);
          toggleActive();
        }}
      />
    </Modal.Root>
  );
};

export { ManualMethodModal };
