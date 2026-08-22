import { useEffect, useState } from 'react';
import {
  Dialog,
  IconButton,
  Flex,
  Typography,
  Box,
  Toggle,
  Loader,
  Button,
  Card,
  TextInput,
  Field,
} from '@strapi/design-system';
import { Cross } from '@strapi/icons';
import { useIntl } from 'react-intl';
import styled from 'styled-components';
import { getTranslation } from '../core/utils/getTranslation';
import config, { AI_TRANSLATION_DEFAULT_MODEL } from '../core/config';
import UpdateSetting from '../core/usecases/updateSetting';
import { useSettings } from '../contexts/settings';

interface Props {
  open: boolean;
  close: () => void;
}

const BoxInput = styled(Box)`
  flex: 1;
  display: flex;
  width: 100%;
  flex-direction: column;
  & > div {
    width: 100%;
  }
`;

const TranslationSettingsModal = ({ open, close }: Props) => {
  const [module] = useState(config.uuid.modules.translation);
  const [hidden, setHidden] = useState(true);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiApiKey, setAiApiKey] = useState('');
  const [aiModel, setAiModel] = useState(AI_TRANSLATION_DEFAULT_MODEL);
  const [storedApiKey, setStoredApiKey] = useState('');
  const [saveInProgress, setSaveInProgress] = useState(false);
  const { formatMessage } = useIntl();
  const settings = useSettings();

  async function updateSetting(property: string, value: any) {
    const updateSetting = new UpdateSetting();
    await updateSetting.execute({ property, module, value });
  }

  async function save() {
    if (saveInProgress) return;
    setSaveInProgress(true);
    await updateSetting('aiEnabled', aiEnabled);
    await updateSetting('aiModel', aiModel.trim() || AI_TRANSLATION_DEFAULT_MODEL);
    if (aiApiKey.trim().length > 0) {
      await updateSetting('aiApiKey', aiApiKey.trim());
    }
    await settings.refresh();
    setAiApiKey('');
    setSaveInProgress(false);
    close();
  }

  useEffect(() => {
    if (!open) {
      setHidden(true);
      return;
    }
    const current = settings.provide(module);
    setAiEnabled(!!current.aiEnabled);
    setAiModel(current.aiModel || AI_TRANSLATION_DEFAULT_MODEL);
    setStoredApiKey(current.aiApiKey || '');
    setAiApiKey('');
    setHidden(false);
  }, [open]);

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
                {!saveInProgress && (
                  <IconButton variant="tertiary" onClick={close} label="Close" borderWidth={0}>
                    <Cross />
                  </IconButton>
                )}
              </Flex>
            </Dialog.Header>
            <Dialog.Body>
              <Box style={{ display: 'flex', flexDirection: 'column', width: '100%' }}>
                <Typography variant="sigma" style={{ paddingBottom: '5px' }}>
                  {formatMessage({
                    id: getTranslation(`module.${module}.modal.settings.input.ai-enabled.title`),
                    defaultMessage: 'Translate with artificial intelligence',
                  })}
                </Typography>
                <Typography
                  variant="pi"
                  style={{ paddingBottom: '5px', color: '#a5a5ba', display: 'flex' }}
                >
                  {formatMessage({
                    id: getTranslation(
                      `module.${module}.modal.settings.input.ai-enabled.description`
                    ),
                    defaultMessage:
                      'Enable the OpenAI powered translation of the entries of this module',
                  })}
                </Typography>
                <Toggle
                  onLabel="True"
                  offLabel="False"
                  checked={aiEnabled}
                  onChange={(e: any) => setAiEnabled(e.target.checked)}
                />
                <Typography variant="sigma" style={{ paddingBottom: '5px', paddingTop: '24px' }}>
                  {formatMessage({
                    id: getTranslation(`module.${module}.modal.settings.input.ai-api-key.title`),
                    defaultMessage: 'OpenAI API key',
                  })}
                </Typography>
                <Typography
                  variant="pi"
                  style={{ paddingBottom: '5px', color: '#a5a5ba', display: 'flex' }}
                >
                  {formatMessage({
                    id: getTranslation(
                      `module.${module}.modal.settings.input.ai-api-key.description`
                    ),
                    defaultMessage:
                      'The key is stored on the server and is never shown again. Leave it empty to keep the current one',
                  })}
                </Typography>
                <BoxInput>
                  <TextInput
                    type="password"
                    style={{ width: '100%' }}
                    autoComplete="new-password"
                    aria-label={formatMessage({
                      id: getTranslation(`module.${module}.modal.settings.input.ai-api-key.title`),
                      defaultMessage: 'OpenAI API key',
                    })}
                    placeholder={
                      storedApiKey ||
                      formatMessage({
                        id: getTranslation(
                          `module.${module}.modal.settings.input.ai-api-key.placeholder`
                        ),
                        defaultMessage: 'No API key set',
                      })
                    }
                    value={aiApiKey}
                    onChange={(e: any) => setAiApiKey(e.target.value)}
                  />
                  <Field.Hint />
                  <Field.Error />
                </BoxInput>
                <Typography variant="sigma" style={{ paddingBottom: '5px', paddingTop: '24px' }}>
                  {formatMessage({
                    id: getTranslation(`module.${module}.modal.settings.input.ai-model.title`),
                    defaultMessage: 'OpenAI model',
                  })}
                </Typography>
                <Typography
                  variant="pi"
                  style={{ paddingBottom: '5px', color: '#a5a5ba', display: 'flex' }}
                >
                  {formatMessage({
                    id: getTranslation(`module.${module}.modal.settings.input.ai-model.description`),
                    defaultMessage: 'The model used to generate the translations',
                  })}
                </Typography>
                <BoxInput>
                  <TextInput
                    style={{ width: '100%' }}
                    aria-label={formatMessage({
                      id: getTranslation(`module.${module}.modal.settings.input.ai-model.title`),
                      defaultMessage: 'OpenAI model',
                    })}
                    placeholder={AI_TRANSLATION_DEFAULT_MODEL}
                    value={aiModel}
                    onChange={(e: any) => setAiModel(e.target.value)}
                  />
                  <Field.Hint />
                  <Field.Error />
                </BoxInput>
                <Card
                  shadow={false}
                  style={{
                    marginTop: '20px',
                    padding: '10px',
                    display: 'flex',
                    alignItems: 'center',
                  }}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" fill="none" viewBox="0 0 24 24">
                    <path
                      fill="#7b79ff"
                      d="M12 0C5.383 0 0 5.383 0 12s5.383 12 12 12 12-5.383 12-12S18.617 0 12 0Zm1.154 18.456h-2.308V16.15h2.308v2.307Zm-.23-3.687h-1.847l-.346-9.23h2.538l-.346 9.23Z"
                    ></path>
                  </svg>
                  <Typography
                    variant="pi"
                    style={{ color: '#a5a5ba', display: 'flex', marginLeft: '10px' }}
                  >
                    {formatMessage({
                      id: getTranslation(`module.${module}.modal.settings.hint`),
                      defaultMessage:
                        'Each translation is billed by OpenAI on the account that owns the API key',
                    })}
                  </Typography>
                </Card>
              </Box>
            </Dialog.Body>
            <Dialog.Footer style={{ justifyContent: 'end' }}>
              {saveInProgress && <Loader small />}
              <Button style={{ marginRight: '5px' }} onClick={save} disabled={saveInProgress}>
                {formatMessage({
                  id: getTranslation(`module.${module}.modal.settings.button.save`),
                  defaultMessage: 'Save',
                })}
              </Button>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Root>
      )}
    </>
  );
};

export default TranslationSettingsModal;
