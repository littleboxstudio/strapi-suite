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
  Checkbox,
  SingleSelect,
  SingleSelectOption,
} from '@strapi/design-system';
import { Cross } from '@strapi/icons';
import { useIntl } from 'react-intl';
import styled from 'styled-components';
import { getTranslation } from '../core/utils/getTranslation';
import config from '../core/config';
import TranslateWithAi, { Output as OutputTranslateWithAi } from '../core/usecases/translateWithAi';
import { Output as OutputFetchLocales } from '../core/usecases/fetchLocales';

interface Props {
  open: boolean;
  locales: OutputFetchLocales[];
  close: (refresh: boolean) => void;
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

const TranslationAiModal = ({ open, locales, close }: Props) => {
  const [module] = useState(config.uuid.modules.translation);
  const [hidden, setHidden] = useState(true);
  const [sourceLocale, setSourceLocale] = useState<string | undefined>();
  const [targetLocales, setTargetLocales] = useState<string[]>([]);
  const [overwrite, setOverwrite] = useState(false);
  const [translateInProgress, setTranslateInProgress] = useState(false);
  const [result, setResult] = useState<OutputTranslateWithAi | undefined>();
  const [error, setError] = useState('');
  const { formatMessage } = useIntl();

  function changeSourceLocale(code: string) {
    setSourceLocale(code);
    setTargetLocales([]);
    setResult(undefined);
    setError('');
  }

  function toggleTargetLocale(code: string) {
    if (targetLocales.includes(code)) {
      setTargetLocales(targetLocales.filter((locale) => locale !== code));
      return;
    }
    setTargetLocales([...targetLocales, code]);
  }

  function selectAllTargetLocales() {
    const available = locales
      .filter((locale: OutputFetchLocales) => locale.code !== sourceLocale)
      .map((locale: OutputFetchLocales) => locale.code);
    setTargetLocales(targetLocales.length === available.length ? [] : available);
  }

  async function translate() {
    if (translateInProgress || !sourceLocale || targetLocales.length === 0) return;
    setTranslateInProgress(true);
    setResult(undefined);
    setError('');
    try {
      const translateWithAi = new TranslateWithAi();
      const output = await translateWithAi.execute({ sourceLocale, targetLocales, overwrite });
      setResult(output);
    } catch (e: any) {
      setError(
        e?.response?.data?.error?.message ||
          e?.message ||
          formatMessage({
            id: getTranslation(`module.${module}.modal.ai.error`),
            defaultMessage: 'The translation request failed',
          })
      );
    }
    setTranslateInProgress(false);
  }

  function handleClose() {
    if (translateInProgress) return;
    const refresh = !!result && result.translated > 0;
    setSourceLocale(undefined);
    setTargetLocales([]);
    setOverwrite(false);
    setResult(undefined);
    setError('');
    close(refresh);
  }

  useEffect(() => {
    if (!open) {
      setHidden(true);
      return;
    }
    const defaultLocale = locales.find((locale: OutputFetchLocales) => locale.isDefault);
    setSourceLocale(defaultLocale?.code);
    setTargetLocales([]);
    setOverwrite(false);
    setResult(undefined);
    setError('');
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
                    id: getTranslation(`module.${module}.modal.ai.title`),
                    defaultMessage: 'Translate with AI',
                  })}
                </Typography>
                {!translateInProgress && (
                  <IconButton variant="tertiary" onClick={handleClose} label="Close" borderWidth={0}>
                    <Cross />
                  </IconButton>
                )}
              </Flex>
            </Dialog.Header>
            <Dialog.Body>
              <Box style={{ display: 'flex', flexDirection: 'column', width: '100%' }}>
                <Typography variant="sigma" style={{ paddingBottom: '5px' }}>
                  {formatMessage({
                    id: getTranslation(`module.${module}.modal.ai.input.source.title`),
                    defaultMessage: 'Base language',
                  })}
                </Typography>
                <Typography
                  variant="pi"
                  style={{ paddingBottom: '5px', color: '#a5a5ba', display: 'flex' }}
                >
                  {formatMessage({
                    id: getTranslation(`module.${module}.modal.ai.input.source.description`),
                    defaultMessage: 'The language the entries are translated from',
                  })}
                </Typography>
                <BoxInput>
                  <SingleSelect
                    onChange={(value: string) => changeSourceLocale(value)}
                    value={sourceLocale}
                    disabled={translateInProgress}
                  >
                    {locales.map((locale: OutputFetchLocales, index: number) => (
                      <SingleSelectOption key={index} value={locale.code}>
                        {locale.name}
                      </SingleSelectOption>
                    ))}
                  </SingleSelect>
                </BoxInput>
                {sourceLocale && (
                  <>
                    <Flex
                      style={{
                        justifyContent: 'space-between',
                        alignItems: 'end',
                        paddingTop: '24px',
                        paddingBottom: '5px',
                      }}
                    >
                      <Typography variant="sigma">
                        {formatMessage({
                          id: getTranslation(`module.${module}.modal.ai.input.targets.title`),
                          defaultMessage: 'Languages to translate to',
                        })}
                      </Typography>
                      <Button
                        variant="tertiary"
                        size="S"
                        onClick={selectAllTargetLocales}
                        disabled={translateInProgress}
                      >
                        {formatMessage({
                          id: getTranslation(`module.${module}.modal.ai.input.targets.select-all`),
                          defaultMessage: 'Select all',
                        })}
                      </Button>
                    </Flex>
                    <Box style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      {locales
                        .filter((locale: OutputFetchLocales) => locale.code !== sourceLocale)
                        .map((locale: OutputFetchLocales) => (
                          <Checkbox
                            key={locale.code}
                            checked={targetLocales.includes(locale.code)}
                            disabled={translateInProgress}
                            onCheckedChange={() => toggleTargetLocale(locale.code)}
                          >
                            {locale.name}
                          </Checkbox>
                        ))}
                    </Box>
                    <Typography variant="sigma" style={{ paddingBottom: '5px', paddingTop: '24px' }}>
                      {formatMessage({
                        id: getTranslation(`module.${module}.modal.ai.input.overwrite.title`),
                        defaultMessage: 'Overwrite existing translations',
                      })}
                    </Typography>
                    <Typography
                      variant="pi"
                      style={{ paddingBottom: '5px', color: '#a5a5ba', display: 'flex' }}
                    >
                      {formatMessage({
                        id: getTranslation(`module.${module}.modal.ai.input.overwrite.description`),
                        defaultMessage:
                          'When disabled only the missing translations are generated',
                      })}
                    </Typography>
                    <Toggle
                      onLabel="True"
                      offLabel="False"
                      checked={overwrite}
                      disabled={translateInProgress}
                      onChange={(e: any) => setOverwrite(e.target.checked)}
                    />
                  </>
                )}
                {translateInProgress && (
                  <Card
                    shadow={false}
                    style={{
                      marginTop: '20px',
                      padding: '10px',
                      display: 'flex',
                      alignItems: 'center',
                    }}
                  >
                    <Loader small />
                    <Typography
                      variant="pi"
                      style={{ color: '#a5a5ba', display: 'flex', marginLeft: '10px' }}
                    >
                      {formatMessage({
                        id: getTranslation(`module.${module}.modal.ai.progress`),
                        defaultMessage:
                          'Translating. This can take a few minutes, please keep this window open',
                      })}
                    </Typography>
                  </Card>
                )}
                {result && !translateInProgress && (
                  <Card
                    shadow={false}
                    style={{
                      marginTop: '20px',
                      padding: '10px',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'start',
                      gap: '5px',
                    }}
                  >
                    <Typography variant="pi" style={{ display: 'flex' }}>
                      {formatMessage(
                        {
                          id: getTranslation(`module.${module}.modal.ai.result`),
                          defaultMessage:
                            '{translated} translated, {skipped} skipped, {failed} failed',
                        },
                        {
                          translated: result.translated,
                          skipped: result.skipped,
                          failed: result.failed,
                        }
                      )}
                    </Typography>
                    {result.errors.map((message: string, index: number) => (
                      <Typography
                        key={index}
                        variant="pi"
                        style={{ color: '#ee5e52', display: 'flex' }}
                      >
                        {message}
                      </Typography>
                    ))}
                  </Card>
                )}
                {error && !translateInProgress && (
                  <Card
                    shadow={false}
                    style={{
                      marginTop: '20px',
                      padding: '10px',
                      display: 'flex',
                      alignItems: 'center',
                    }}
                  >
                    <Typography variant="pi" style={{ color: '#ee5e52', display: 'flex' }}>
                      {error}
                    </Typography>
                  </Card>
                )}
              </Box>
            </Dialog.Body>
            <Dialog.Footer style={{ justifyContent: 'end', gap: '5px' }}>
              <Button variant="tertiary" onClick={handleClose} disabled={translateInProgress}>
                {formatMessage({
                  id: getTranslation(`app.modal.confirm.button.cancel`),
                  defaultMessage: 'Cancel',
                })}
              </Button>
              <Button
                style={{ marginRight: '5px' }}
                onClick={translate}
                disabled={translateInProgress || !sourceLocale || targetLocales.length === 0}
              >
                {formatMessage({
                  id: getTranslation(`module.${module}.modal.ai.button.translate`),
                  defaultMessage: 'Translate',
                })}
              </Button>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Root>
      )}
    </>
  );
};

export default TranslationAiModal;
