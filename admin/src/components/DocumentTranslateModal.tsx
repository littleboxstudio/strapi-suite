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
  SingleSelect,
  SingleSelectOption,
} from '@strapi/design-system';
import { Cross } from '@strapi/icons';
import { useIntl } from 'react-intl';
import styled from 'styled-components';
import { getTranslation } from '../core/utils/getTranslation';
import config from '../core/config';
import { Output as OutputTranslateDocument } from '../core/usecases/translateDocument';
import { Output as OutputFetchLocales } from '../core/usecases/fetchLocales';

interface Props {
  open: boolean;
  locales: OutputFetchLocales[];
  targetLocale?: OutputFetchLocales;
  translate: (sourceLocale: string, overwrite: boolean) => Promise<OutputTranslateDocument>;
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

const DocumentTranslateModal = ({ open, locales, targetLocale, translate, close }: Props) => {
  const [module] = useState(config.uuid.modules.translation);
  const [hidden, setHidden] = useState(true);
  const [sourceLocale, setSourceLocale] = useState<string | undefined>();
  const [overwrite, setOverwrite] = useState(true);
  const [translateInProgress, setTranslateInProgress] = useState(false);
  const [result, setResult] = useState<OutputTranslateDocument | undefined>();
  const [error, setError] = useState('');
  const { formatMessage } = useIntl();

  const sources = locales.filter(
    (locale: OutputFetchLocales) => locale.code !== targetLocale?.code
  );

  async function run() {
    if (translateInProgress || !sourceLocale) return;
    setTranslateInProgress(true);
    setResult(undefined);
    setError('');
    try {
      const output = await translate(sourceLocale, overwrite);
      if (output.errors.includes('no-source')) {
        setError(
          formatMessage({
            id: getTranslation(`module.${module}.panel.ai.error.no-source`),
            defaultMessage: 'This entry does not exist yet in the language you picked as the base',
          })
        );
      } else {
        setResult(output);
      }
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
    setResult(undefined);
    setError('');
    close();
  }

  useEffect(() => {
    if (!open) {
      setHidden(true);
      return;
    }
    setSourceLocale(sources[0]?.code);
    setOverwrite(true);
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
                    id: getTranslation(`module.${module}.panel.ai.title`),
                    defaultMessage: 'Translate with AI',
                  })}
                </Typography>
                {!translateInProgress && (
                  <IconButton
                    variant="tertiary"
                    onClick={handleClose}
                    label="Close"
                    borderWidth={0}
                  >
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
                  {formatMessage(
                    {
                      id: getTranslation(`module.${module}.panel.ai.input.source.description`),
                      defaultMessage: 'This entry is translated into {target} from the language you pick here',
                    },
                    { target: targetLocale?.name || '' }
                  )}
                </Typography>
                <BoxInput>
                  <SingleSelect
                    onChange={(value: string) => setSourceLocale(value)}
                    value={sourceLocale}
                    disabled={translateInProgress}
                  >
                    {sources.map((locale: OutputFetchLocales, index: number) => (
                      <SingleSelectOption key={index} value={locale.code}>
                        {locale.name}
                      </SingleSelectOption>
                    ))}
                  </SingleSelect>
                </BoxInput>
                <Typography variant="sigma" style={{ paddingBottom: '5px', paddingTop: '24px' }}>
                  {formatMessage({
                    id: getTranslation(`module.${module}.panel.ai.input.overwrite.title`),
                    defaultMessage: 'Overwrite fields that already have content',
                  })}
                </Typography>
                <Typography
                  variant="pi"
                  style={{ paddingBottom: '5px', color: '#a5a5ba', display: 'flex' }}
                >
                  {formatMessage({
                    id: getTranslation(`module.${module}.panel.ai.input.overwrite.description`),
                    defaultMessage: 'When disabled only the empty fields are filled in',
                  })}
                </Typography>
                <Toggle
                  onLabel="True"
                  offLabel="False"
                  checked={overwrite}
                  disabled={translateInProgress}
                  onChange={(e: any) => setOverwrite(e.target.checked)}
                />
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
                    {result.translated > 0 && (
                      <Typography variant="pi" style={{ color: '#a5a5ba', display: 'flex' }}>
                        {formatMessage({
                          id: getTranslation(`module.${module}.panel.ai.result.save`),
                          defaultMessage: 'Review the fields and save the entry to keep them',
                        })}
                      </Typography>
                    )}
                    {result.unmatched > 0 && (
                      <Typography variant="pi" style={{ color: '#ee5e52', display: 'flex' }}>
                        {formatMessage(
                          {
                            id: getTranslation(`module.${module}.panel.ai.result.unmatched`),
                            defaultMessage:
                              '{unmatched} fields of the base language have no match here, the two entries have a different structure',
                          },
                          { unmatched: result.unmatched }
                        )}
                      </Typography>
                    )}
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
                onClick={run}
                disabled={translateInProgress || !sourceLocale}
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

export default DocumentTranslateModal;
