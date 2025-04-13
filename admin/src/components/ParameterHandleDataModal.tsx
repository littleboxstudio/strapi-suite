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
  Toggle,
} from '@strapi/design-system';
import { Cross } from '@strapi/icons';
import { useIntl } from 'react-intl';
import styled from 'styled-components';
import { getTranslation } from '../core/utils/getTranslation';
import { isEmpty, isNotEmpty } from '../core/utils/isEmpty';
import { convertToSlug } from '../core/utils/convertToSlug';
import config from '../core/config';
import { Output as OutputFetchParameters } from '../core/usecases/fetchParameters';
import CreateParameter from '../core/usecases/createParameter';
import EditParameter from '../core/usecases/editParameter';

const BoxInput = styled(Box)`
  & > div {
    width: 100%;
  }
`;

type Props = {
  open: boolean;
  close: (refresh: boolean) => void;
  data: OutputFetchParameters;
  currentRecords: OutputFetchParameters[];
};

const ParameterHandleDataModal = ({ open, close, data, currentRecords }: Props) => {
  const [module, setModule] = useState(config.uuid.modules.parameter);
  const [hidden, setHidden] = useState(true);
  const [form, setForm] = useState({ uid: '', value: '', private: false });
  const [uidExist, setUidExist] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [saveInProgress, setSaveInProgress] = useState(false);
  const { formatMessage } = useIntl();

  function checkUidExist(uid: string): boolean {
    const uidExist = currentRecords.find(
      (record: OutputFetchParameters) => record.uid === uid && record.documentId !== data.documentId
    );
    setUidExist(!!uidExist);
    return !!uidExist;
  }

  async function handlerForm() {
    if (!saveInProgress && isNotEmpty(form.uid) && isNotEmpty(form.value)) {
      const uidExist = checkUidExist(form.uid);
      if (uidExist) return;
      setUidExist(false);
      setSaveInProgress(true);
      if (data.documentId) {
        const editParameter = new EditParameter();
        await editParameter.execute(data.documentId, form);
      }
      if (!data.documentId) {
        const createParameter = new CreateParameter();
        await createParameter.execute(form);
      }
      setSaveInProgress(false);
      setSubmitted(false);
      handleClose(true);
    }
  }

  function handleClose(refresh: boolean) {
    setForm({ uid: '', value: '', private: false });
    setSubmitted(false);
    close(refresh);
  }

  useEffect(() => {
    setForm({
      uid: data.uid || '',
      value: data.value || '',
      private: data.private || false,
    });
  }, [data]);

  useEffect(() => {
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
                  {!data.documentId &&
                    formatMessage({
                      id: getTranslation(`module.${module}.modal.handler.create.title`),
                      defaultMessage: 'Create new entry',
                    })}
                  {data.documentId &&
                    formatMessage({
                      id: getTranslation(`module.${module}.modal.handler.edit.title`),
                      defaultMessage: 'Edit parameter',
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
                    defaultMessage: 'Unique identifier for the parameter',
                  })}
                </Typography>
                <BoxInput
                  style={{
                    flex: 1,
                    display: 'flex',
                    width: '100%',
                    flexDirection: 'column',
                    marginRight: '10px',
                  }}
                >
                  <TextInput
                    style={{ width: '100%' }}
                    aria-label={formatMessage({
                      id: getTranslation(`module.${module}.modal.handler.input.uid`),
                      defaultMessage: 'UID',
                    })}
                    value={form.uid}
                    hasError={submitted && (isEmpty(form.uid) || uidExist)}
                    onChange={(e: any) => {
                      const convertedText = convertToSlug(e.target.value);
                      setForm({ ...form, uid: convertedText });
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
                <span style={{ paddingBottom: '5px', paddingTop: '24px' }}>
                  <Typography variant="sigma">
                    {formatMessage({
                      id: getTranslation(`module.${module}.modal.handler.input.value`),
                      defaultMessage: 'Value',
                    })}
                  </Typography>
                </span>
                <BoxInput
                  style={{
                    flex: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    width: '100%',
                    marginRight: '10px',
                  }}
                >
                  <TextInput
                    style={{ width: '100%' }}
                    aria-label={formatMessage({
                      id: getTranslation(`module.${module}.modal.input.title`),
                      defaultMessage: 'Title',
                    })}
                    value={form.value}
                    hasError={submitted && isEmpty(form.value)}
                    onChange={(e: any) => setForm({ ...form, value: e.target.value })}
                  />
                  <Field.Hint />
                  <Field.Error />
                </BoxInput>
                <span style={{ paddingBottom: '5px', paddingTop: '24px' }}>
                  <Typography variant="sigma">
                    {formatMessage({
                      id: getTranslation(`module.${module}.modal.handler.input.private`),
                      defaultMessage: 'Private',
                    })}
                  </Typography>
                </span>
                <BoxInput
                  style={{
                    flex: 1,
                    display: 'flex',
                    width: '100%',
                    flexDirection: 'column',
                    marginRight: '10px',
                  }}
                >
                  <Toggle
                    onLabel="True"
                    offLabel="False"
                    checked={form.private}
                    onChange={(e: any) => setForm({ ...form, private: e.target.checked })}
                  />
                </BoxInput>
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

export default ParameterHandleDataModal;
