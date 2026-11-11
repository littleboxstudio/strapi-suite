import { useState } from 'react';
import { useIntl } from 'react-intl';
import { Box, Button, Flex, Typography } from '@strapi/design-system';
import config from '../../../core/config';
import UpdateSetting from '../../../core/usecases/updateSetting';
import { getTranslation } from '../../../core/utils/getTranslation';
import { useSettings } from '../../../contexts/settings';

/**
 * Settings → General: turns the whole E-commerce module on or off (it used to sit in the module
 * header). Disabling it closes the store; the layout then shows the "module disabled" screen.
 */
const ModuleStatusSection = ({ readOnly }: { readOnly: boolean }) => {
  const module = config.uuid.modules.ecommerce;
  const { formatMessage } = useIntl();
  const t = (id: string) => formatMessage({ id: getTranslation(id) });
  const settings = useSettings();
  const active = settings.provide(module).active;
  const [saving, setSaving] = useState(false);

  const toggle = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await new UpdateSetting().execute({ property: 'active', module, value: !active });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box background="neutral0" shadow="tableShadow" hasRadius padding={6}>
      <Flex justifyContent="space-between" alignItems="center" gap={6} wrap="wrap">
        <Flex direction="column" alignItems="flex-start" gap={2} style={{ flex: 1, minWidth: 260 }}>
          <Typography variant="delta" tag="h2">
            {t('ecommerce.settings.module.title')}
          </Typography>
          <Typography variant="omega" textColor="neutral600">
            {t('ecommerce.settings.module.description')}
          </Typography>
        </Flex>
        <Button
          variant={active ? 'default' : 'danger'}
          onClick={toggle}
          loading={saving}
          disabled={readOnly}
          aria-pressed={active}
        >
          {t(active ? 'app.enabled' : 'app.disabled')}
        </Button>
      </Flex>
    </Box>
  );
};

export { ModuleStatusSection };
