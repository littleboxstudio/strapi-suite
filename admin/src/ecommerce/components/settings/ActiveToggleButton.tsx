import { useState } from 'react';
import { useIntl } from 'react-intl';
import { Button } from '@strapi/design-system';
import { getTranslation } from '../../../core/utils/getTranslation';
import { ActionConfirmModal } from '../ActionConfirmModal';

type Props = {
  /** The provider's display name (used in the confirmation). */
  name: string;
  active: boolean;
  /** True while the activation request runs. */
  busy: boolean;
  onChange: (active: boolean) => void;
};

/**
 * Disable (red) or Enable button of an integration card. Disabling asks first; enabling goes
 * straight through (the section already asks when it replaces another provider).
 */
const ActiveToggleButton = ({ name, active, busy, onChange }: Props) => {
  const { formatMessage } = useIntl();
  const t = (id: string, values?: Record<string, any>) =>
    formatMessage({ id: getTranslation(id) }, values);
  const [confirming, setConfirming] = useState(false);

  return (
    <>
      <Button
        variant={active ? 'danger-light' : 'success-light'}
        loading={busy}
        onClick={() => (active ? setConfirming(true) : onChange(true))}
      >
        {t(
          active
            ? 'ecommerce.settings.integrations.disable'
            : 'ecommerce.settings.integrations.enable'
        )}
      </Button>
      <ActionConfirmModal
        open={confirming}
        title={t('ecommerce.settings.integrations.disableConfirm.title', { name })}
        text={t('ecommerce.settings.integrations.disableConfirm.text', { name })}
        confirmLabel={t('ecommerce.settings.integrations.disable')}
        cancelLabel={t('ecommerce.settings.cancel')}
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          onChange(false);
        }}
      />
    </>
  );
};

export { ActiveToggleButton };
