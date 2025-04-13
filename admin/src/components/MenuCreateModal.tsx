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
} from '@strapi/design-system';
import { Cross } from '@strapi/icons';
import { useIntl } from 'react-intl';
import styled from 'styled-components';
import { getTranslation } from '../core/utils/getTranslation';
import { isEmpty, isNotEmpty } from '../core/utils/isEmpty';
import { convertToSlug } from '../core/utils/convertToSlug';
import config from '../core/config';
import CreateMenu from '../core/usecases/createMenu';
import { Output as OutputFetchMenus } from '../core/usecases/fetchMenus';

const BoxInput = styled(Box)`
  & > div {
    width: 100%;
  }
`;

const MenuCreateModal = ({ open, close, locale, currentRecords }: any) => {
  const [module, setModule] = useState(config.uuid.modules.menu);
  const [hidden, setHidden] = useState(true);
  const [formTitle, setFormTitle] = useState('');
  const [formUid, setFormUid] = useState('');
  const [uidExist, setUidExist] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [createInProgress, setCreateInProgress] = useState(false);
  const { formatMessage } = useIntl();

  function checkUidExist(uid: string): boolean {
    const uidExist = currentRecords.find((record: OutputFetchMenus) => record.uid === uid);
    setUidExist(uidExist);
    return uidExist;
  }

  async function handlerForm() {
    if (!createInProgress && isNotEmpty(formTitle) && isNotEmpty(formUid)) {
      const uidExist = checkUidExist(formUid);
      if (uidExist) return;
      setUidExist(false);
      setCreateInProgress(true);
      const createMenu = new CreateMenu();
      await createMenu.execute({
        uid: formUid,
        title: formTitle,
        locale,
      });
      setCreateInProgress(false);
      setSubmitted(false);
      setFormTitle('');
      setFormUid('');
      close(true);
    }
  }

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
                  {formatMessage({
                    id: getTranslation(`module.${module}.modal.create.title`),
                    defaultMessage: 'Create new entry',
                  })}
                </Typography>
                {!createInProgress && (
                  <IconButton
                    variant="tertiary"
                    onClick={() => close(false)}
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
                    id: getTranslation(`module.${module}.modal.create.input.title`),
                    defaultMessage: 'Title',
                  })}
                </Typography>
                <BoxInput style={{ flex: 1, display: 'flex', width: '100%', marginRight: '10px' }}>
                  <TextInput
                    style={{ width: '100%' }}
                    aria-label={formatMessage({
                      id: getTranslation(`module.${module}.modal.input.title`),
                      defaultMessage: 'Title',
                    })}
                    value={formTitle}
                    hasError={submitted && isEmpty(formTitle)}
                    onChange={(e: any) => setFormTitle(e.target.value)}
                  />
                  <Field.Hint />
                  <Field.Error />
                </BoxInput>
                <Typography variant="sigma" style={{ paddingBottom: '5px', paddingTop: '24px' }}>
                  {formatMessage({
                    id: getTranslation(`module.${module}.modal.create.input.uid`),
                    defaultMessage: 'UID',
                  })}
                </Typography>
                <Typography
                  variant="pi"
                  style={{ paddingBottom: '5px', color: '#a5a5ba', display: 'flex' }}
                >
                  {formatMessage({
                    id: getTranslation(`module.${module}.modal.create.input.uid.description`),
                    defaultMessage:
                      'Unique identifier for the menu. Repeat the UID only if you are entering translations for an existing menu',
                  })}
                </Typography>

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
                      id: getTranslation(`module.${module}.modal.create.input.uid`),
                      defaultMessage: 'UID',
                    })}
                    value={formUid}
                    hasError={submitted && (isEmpty(formUid) || uidExist)}
                    onChange={(e: any) => {
                      const convertedText = convertToSlug(e.target.value);
                      setFormUid(convertedText);
                      checkUidExist(e.target.value);
                    }}
                  />
                  <Field.Hint />
                  <Field.Error />
                  {submitted && uidExist && (
                    <Typography variant="pi" style={{ color: '#ee5e52', paddingTop: '5px' }}>
                      {formatMessage({
                        id: getTranslation(
                          `module.${module}.modal.create.input.uid.error.duplicated`
                        ),
                        defaultMessage: 'The UID already exists for the selected locale',
                      })}
                    </Typography>
                  )}
                </BoxInput>
              </Box>
            </Dialog.Body>
            <Dialog.Footer style={{ justifyContent: 'end' }}>
              {createInProgress && <Loader small />}
              <Button
                style={{ marginRight: '5px' }}
                onClick={() => {
                  setSubmitted(true);
                  handlerForm();
                }}
                disabled={createInProgress}
              >
                {formatMessage({
                  id: getTranslation(`module.${module}.modal.create.button`),
                  defaultMessage: 'Create',
                })}
              </Button>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Root>
      )}
    </>
  );
};

export default MenuCreateModal;
