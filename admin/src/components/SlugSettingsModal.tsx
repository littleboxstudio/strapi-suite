import { useEffect, useState } from 'react';
import { Dialog, IconButton, Flex, Typography, Box, Toggle } from '@strapi/design-system';
import { Cross } from '@strapi/icons';
import { useIntl } from 'react-intl';
import { getTranslation } from '../core/utils/getTranslation';
import config from '../core/config';
import UpdateSetting from '../core/usecases/updateSetting';
import { useSettings } from '../contexts/settings';

const SlugSettingsModal = ({ open, close }: any) => {
  const [module, setModule] = useState(config.uuid.modules.slug);
  const [hidden, setHidden] = useState(true);
  const [checked, setChecked] = useState(true);
  const { formatMessage } = useIntl();
  const settings = useSettings();

  async function handleChange(event: any) {
    setChecked(event.target.checked);
    const updateSetting = new UpdateSetting();
    await updateSetting.execute({
      property: 'showDefaultLanguage',
      module: module,
      value: event.target.checked,
    });
  }

  useEffect(() => {
    setHidden(!open);
  }, [open]);

  useEffect(() => {
    setChecked(settings.provide('slug').showDefaultLanguage);
  });

  return (
    <>
      {!hidden && (
        <Dialog.Root defaultOpen={true}>
          <Dialog.Content>
            <Dialog.Header style={{ textAlign: 'left' }}>
              <Flex style={{ width: '100%', justifyContent: 'space-between' }}>
                <Typography variant="omega">
                  {formatMessage({
                    id: getTranslation(`module.${module}.modal.settings.title`),
                    defaultMessage: 'Settings',
                  })}
                </Typography>
                <IconButton variant="tertiary" onClick={close} label="Close" borderWidth={0}>
                  <Cross />
                </IconButton>
              </Flex>
            </Dialog.Header>
            <Dialog.Body>
              <Box style={{ display: 'flex', flexDirection: 'column', width: '100%' }}>
                <span style={{ paddingBottom: '5px' }}>
                  <Typography variant="sigma">
                    {formatMessage({
                      id: getTranslation(
                        `module.${module}.modal.settings.input.default-language.title`
                      ),
                      defaultMessage: 'Show language slug',
                    })}
                  </Typography>
                </span>
                <span style={{ paddingBottom: '15px', color: '#a5a5ba', display: 'flex' }}>
                  <Typography variant="pi">
                    {formatMessage({
                      id: getTranslation(
                        `module.${module}.modal.settings.input.default-language.description`
                      ),
                      defaultMessage: 'Show language slug for default language in site url',
                    })}
                  </Typography>
                </span>
                <Toggle onLabel="True" offLabel="False" checked={checked} onChange={handleChange} />
              </Box>
            </Dialog.Body>
          </Dialog.Content>
        </Dialog.Root>
      )}
    </>
  );
};

export default SlugSettingsModal;
