import { useEffect, useState } from 'react';
import {
  Dialog,
  IconButton,
  Flex,
  Typography,
  Box,
  Button,
  Loader,
  SingleSelect,
  SingleSelectOption,
} from '@strapi/design-system';
import { Cross } from '@strapi/icons';
import { useIntl } from 'react-intl';
import styled from 'styled-components';
import { getTranslation } from '../core/utils/getTranslation';
import config from '../core/config';
import { Output as OutputFetchLocales } from '../core/usecases/fetchLocales';
import DuplicateMenu from '../core/usecases/duplicateMenu';

const BoxInput = styled(Box)`
  & > div {
    width: 100%;
  }
`;

const MenuDuplicateModal = ({ open, close, documentId, locales }: any) => {
  const [module, setModule] = useState(config.uuid.modules.menu);
  const [hidden, setHidden] = useState(true);
  const [selectedLocale, setSelectedLocale] = useState<string>();
  const [duplicateInProgress, setDuplicateInProgress] = useState(false);
  const { formatMessage } = useIntl();

  async function duplicate() {
    if (selectedLocale) {
      const duplicateMenu = new DuplicateMenu();
      await duplicateMenu.execute(documentId, selectedLocale);
      setSelectedLocale(undefined);
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
                    id: getTranslation(`module.${module}.modal.duplicate.title`),
                    defaultMessage: 'Duplicate entry',
                  })}
                </Typography>
                {!duplicateInProgress && (
                  <IconButton
                    variant="tertiary"
                    onClick={() => {
                      setSelectedLocale(undefined);
                      close(false);
                    }}
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
                    id: getTranslation(`module.${module}.duplicate.input.title`),
                    defaultMessage: 'Select language',
                  })}
                </Typography>
                <BoxInput style={{ flex: 1, display: 'flex', width: '100%', marginRight: '10px' }}>
                  <SingleSelect
                    onChange={(value: string) => setSelectedLocale(value)}
                    value={selectedLocale}
                  >
                    {locales.map((i18nLocale: OutputFetchLocales, index: number) => (
                      <SingleSelectOption key={index} value={i18nLocale.code}>
                        {i18nLocale.name}
                      </SingleSelectOption>
                    ))}
                  </SingleSelect>
                </BoxInput>
              </Box>
            </Dialog.Body>
            <Dialog.Footer style={{ justifyContent: 'end' }}>
              {duplicateInProgress && <Loader small />}
              <Button
                style={{ marginRight: '5px' }}
                onClick={() => {
                  duplicate();
                }}
                disabled={!selectedLocale || duplicateInProgress}
              >
                Create
              </Button>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Root>
      )}
    </>
  );
};

export default MenuDuplicateModal;
