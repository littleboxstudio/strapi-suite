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
  SingleSelect,
  SingleSelectOption,
} from '@strapi/design-system';
import { Cross } from '@strapi/icons';
import { useIntl } from 'react-intl';
import styled from 'styled-components';
import { Output as OutputFetchLocales } from '../core/usecases/fetchLocales';
import FetchSlugs, { Output as OutputFetchSlugs } from '../core/usecases/fetchSlugs';
import { getTranslation } from '../core/utils/getTranslation';
import config from '../core/config';
import UpdateSetting from '../core/usecases/updateSetting';
import { useSettings } from '../contexts/settings';

interface Props {
  defaultLocale: OutputFetchLocales;
  open: boolean;
  close: () => void;
}

const BoxInput = styled(Box)`
  & > div {
    width: 100%;
  }
`;

const SlugSettingsModal = ({ open, close, defaultLocale }: Props) => {
  const [module, setModule] = useState(config.uuid.modules.slug);
  const [hidden, setHidden] = useState(true);
  const [showDefaultLanguage, setShowDefaultLanguage] = useState(true);
  const [selectedContent, setSelectedContent] = useState<OutputFetchSlugs>();
  const [pages, setPages] = useState<OutputFetchSlugs[]>([]);
  const [saveInProgress, setSaveInProgress] = useState(false);
  const { formatMessage } = useIntl();
  const settings = useSettings();

  function updateSetting(property: string, value: any) {
    const updateSetting = new UpdateSetting();
    updateSetting.execute({ property, module, value });
  }

  function handleChangeSelectedContent(value: any) {
    const page = pages.find((page) => page.id == value);
    setSelectedContent(page);
  }

  function save() {
    updateSetting('showDefaultLanguage', showDefaultLanguage);
    updateSetting('homepageContentId', selectedContent?.contentId);
    updateSetting('homepageContentModel', selectedContent?.contentModel);
    close();
  }

  async function fetchSlugs() {
    const fetchSlugs = new FetchSlugs();
    const outputFetchSlugs = await fetchSlugs.execute({ locale: defaultLocale.code });
    setPages(outputFetchSlugs);
  }

  useEffect(() => {
    if (defaultLocale) {
      fetchSlugs();
    }
  }, [defaultLocale]);

  useEffect(() => {
    setHidden(!open);
  }, [open]);

  useEffect(() => {
    const currentShowDefaultLanguage = settings.provide('slug').showDefaultLanguage;
    setShowDefaultLanguage(currentShowDefaultLanguage);
  }, []);

  useEffect(() => {
    const currentHomePage = settings.provide('slug').homepageContentId;
    const page = pages.find((page) => page.contentId == currentHomePage);
    setSelectedContent(page);
  }, [pages]);

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
                <span style={{ paddingBottom: '5px', color: '#a5a5ba', display: 'flex' }}>
                  <Typography variant="pi">
                    {formatMessage({
                      id: getTranslation(
                        `module.${module}.modal.settings.input.default-language.description`
                      ),
                      defaultMessage: 'Show language slug for default language in site url',
                    })}
                  </Typography>
                </span>
                <Toggle
                  onLabel="True"
                  offLabel="False"
                  checked={showDefaultLanguage}
                  onChange={(e: any) => setShowDefaultLanguage(e.target.checked)}
                />
                <span style={{ paddingBottom: '5px', paddingTop: '24px' }}>
                  <Typography variant="sigma">
                    {formatMessage({
                      id: getTranslation(`module.${module}.modal.settings.input.homepage.title`),
                      defaultMessage: 'Home page',
                    })}
                  </Typography>
                </span>
                <span style={{ paddingBottom: '5px', color: '#a5a5ba', display: 'flex' }}>
                  <Typography variant="pi">
                    {formatMessage({
                      id: getTranslation(
                        `module.${module}.modal.settings.input.homepage.description`
                      ),
                      defaultMessage: 'The content that will be rendered as the homepage',
                    })}
                  </Typography>
                </span>
                <BoxInput style={{ flex: 1, display: 'flex', width: '100%', marginRight: '10px' }}>
                  <SingleSelect
                    onChange={(value: number) => handleChangeSelectedContent(value)}
                    value={selectedContent?.id}
                  >
                    {pages.map((page: OutputFetchSlugs, index: number) => (
                      <SingleSelectOption key={index} value={page.id}>
                        {page.contentTitle}
                      </SingleSelectOption>
                    ))}
                  </SingleSelect>
                </BoxInput>
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

export default SlugSettingsModal;
