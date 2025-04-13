import { useEffect, useState } from 'react';
import {
  Dialog,
  IconButton,
  Flex,
  Typography,
  Box,
  TextInput,
  Button,
  Field,
  Loader,
  Card,
} from '@strapi/design-system';
import { Cross } from '@strapi/icons';
import { useIntl } from 'react-intl';
import styled from 'styled-components';
import { getTranslation } from '../core/utils/getTranslation';
import { isEmpty, isNotEmpty } from '../core/utils/isEmpty';
import config from '../core/config';
import CreateTranslations from '../core/usecases/createTranslations';
import EditTranslations from '../core/usecases/editTranslations';
import { Output as OutputFetchLocales } from '../core/usecases/fetchLocales';

const BoxInput = styled(Box)`
  flex: 1;
  display: flex;
  width: 100%;
  flex-direction: column;
  & > div {
    width: 100%;
  }
`;

interface TranslationItem {
  id: number;
  uid: string;
  translations: Record<string, string>;
}

interface Form {
  uid: string;
  translations: Record<string, string>;
}

type Props = {
  open: boolean;
  close: (refresh: boolean) => void;
  currentRecords: TranslationItem[];
  selectedRecord: TranslationItem | undefined;
  locales: OutputFetchLocales[];
};

const TranslationHandleDataModal = ({
  open,
  close,
  locales,
  selectedRecord,
  currentRecords,
}: Props) => {
  const [module, setModule] = useState(config.uuid.modules.parameter);
  const [hidden, setHidden] = useState(true);
  const [form, setForm] = useState<Form>({ uid: '', translations: {} });
  const [uidExist, setUidExist] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [saveInProgress, setSaveInProgress] = useState(false);
  const { formatMessage } = useIntl();

  function checkUidExist(uid: string): boolean {
    const uidExist = currentRecords.find(
      (record: TranslationItem) => record.uid === uid && selectedRecord?.id !== record.id
    );
    setUidExist(!!uidExist);
    return !!uidExist;
  }

  async function handlerForm() {
    if (!saveInProgress && isNotEmpty(form.uid) && isNotEmpty(form.translations)) {
      const uidExist = checkUidExist(form.uid);
      if (uidExist) return;
      setUidExist(false);
      setSaveInProgress(true);
      const data = Object.entries(form.translations)
        .filter(([_, translation]) => isNotEmpty(translation))
        .map(([locale, translation]) => ({
          uid: form.uid,
          translation,
          locale,
        }));
      if (selectedRecord) {
        const editTranslations = new EditTranslations();
        await editTranslations.execute(selectedRecord.uid, data);
      }
      if (!selectedRecord) {
        const createTranslations = new CreateTranslations();
        await createTranslations.execute(data);
      }
      setSaveInProgress(false);
      setSubmitted(false);
      handleClose(true);
    }
  }

  function handleClose(refresh: boolean) {
    setForm({ uid: '', translations: {} });
    setSubmitted(false);
    close(refresh);
  }

  function checkTranslationsAreEmpty(translations: Record<string, string>) {
    return Object.values(translations).every(isEmpty);
  }

  useEffect(() => {
    const data = selectedRecord
      ? { uid: selectedRecord.uid, translations: { ...selectedRecord.translations } }
      : { uid: '', translations: {} };
    locales.forEach((locale: OutputFetchLocales) => {
      if (!data.translations.hasOwnProperty(locale.code)) {
        data.translations[locale.code] = '';
      }
    });
    setForm(data);
    setHidden(!open);
  }, [open]);

  return (
    <>
      {!hidden && (
        <Dialog.Root defaultOpen={true}>
          <Dialog.Content>
            <Dialog.Header style={{ textAlign: 'left' }}>
              <Flex style={{ width: '100%', justifyContent: 'space-between' }}>
                <Typography variant="omega">
                  {!selectedRecord &&
                    formatMessage({
                      id: getTranslation(`module.${module}.modal.handler.create.title`),
                      defaultMessage: 'Create new entry',
                    })}
                  {selectedRecord &&
                    formatMessage({
                      id: getTranslation(`module.${module}.modal.handler.edit.title`),
                      defaultMessage: 'Edit translations',
                    })}
                </Typography>
                {!saveInProgress && (
                  <IconButton
                    variant="tertiary"
                    onClick={() => handleClose(false)}
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
                    id: getTranslation(`module.${module}.modal.handler.input.uid`),
                    defaultMessage: 'UID',
                  })}
                </Typography>
                <Typography
                  variant="pi"
                  style={{ paddingBottom: '5px', color: '#a5a5ba', display: 'flex' }}
                >
                  {formatMessage({
                    id: getTranslation(`module.${module}.modal.handler.input.uid.description`),
                    defaultMessage: 'Unique identifier for the translation',
                  })}
                </Typography>
                <BoxInput>
                  <TextInput
                    style={{ width: '100%' }}
                    aria-label={formatMessage({
                      id: getTranslation(`module.${module}.modal.handler.input.uid`),
                      defaultMessage: 'UID',
                    })}
                    value={form.uid}
                    hasError={submitted && (isEmpty(form.uid) || uidExist)}
                    onChange={(e: any) => {
                      setForm({ ...form, uid: e.target.value });
                      checkUidExist(e.target.value);
                    }}
                  />
                  <Field.Hint />
                  <Field.Error />
                  {submitted && uidExist && (
                    <Typography variant="pi" style={{ color: '#ee5e52', paddingTop: '5px' }}>
                      {formatMessage({
                        id: getTranslation(
                          `module.${module}.modal.handler.input.uid.error.duplicated`
                        ),
                        defaultMessage: 'The UID already exists',
                      })}
                    </Typography>
                  )}
                </BoxInput>
                <Box
                  style={{
                    width: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    paddingTop: '24px',
                    paddingBottom: '7px',
                  }}
                >
                  <Typography variant="sigma">
                    {formatMessage({
                      id: getTranslation(`module.${module}.modal.handler.input.languages`),
                      defaultMessage: 'Languages',
                    })}
                  </Typography>
                  {submitted && checkTranslationsAreEmpty(form.translations) && (
                    <Typography variant="pi" style={{ color: '#ee5e52', paddingTop: '5px' }}>
                      {formatMessage({
                        id: getTranslation(
                          `module.${module}.modal.handler.input.translation.error`
                        ),
                        defaultMessage: 'You must enter at least one language',
                      })}
                    </Typography>
                  )}
                </Box>
                {Object.entries(form.translations as { [key: string]: string }).map(
                  ([key, value]) => (
                    <Box style={{ width: '100%', display: 'flex', paddingBottom: '5px' }} key={key}>
                      <Card
                        style={{
                          width: '60px',
                          height: '38px',
                          display: 'flex',
                          justifyContent: 'center',
                          alignItems: 'center',
                          marginRight: '7px',
                        }}
                      >
                        <Typography variant="sigma">{key}</Typography>
                      </Card>
                      <BoxInput>
                        <TextInput
                          style={{ width: '100%' }}
                          aria-label={formatMessage({
                            id: getTranslation(`module.${module}.modal.input.title`),
                            defaultMessage: 'Title',
                          })}
                          value={value}
                          hasError={submitted && checkTranslationsAreEmpty(form.translations)}
                          onChange={(e: any) => {
                            const updatedForm = { ...form };
                            updatedForm.translations[key] = e.target.value;
                            setForm(updatedForm);
                          }}
                        />
                        <Field.Hint />
                        <Field.Error />
                      </BoxInput>
                    </Box>
                  )
                )}
              </Box>
            </Dialog.Body>
            <Dialog.Footer style={{ justifyContent: 'end' }}>
              {saveInProgress && <Loader small />}
              <Button
                style={{ marginRight: '5px' }}
                onClick={() => {
                  setSubmitted(true);
                  handlerForm();
                }}
                disabled={saveInProgress}
              >
                {formatMessage({
                  id: getTranslation(`module.${module}.modal.handler.button`),
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

export default TranslationHandleDataModal;
