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
import { Output as OutputFetchLocales } from '../core/usecases/fetchLocales';
import FetchSlugs, { Output as OutputFetchSlugs } from '../core/usecases/fetchSlugs';
import { getTranslation } from '../core/utils/getTranslation';
import config, { SLUG_LANGUAGE_STRATEGY, SLUG_CONTENT_STRATEGY } from '../core/config';
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
  const [selectedStrategy, setSelectedStrategy] = useState(SLUG_LANGUAGE_STRATEGY);
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
    updateSetting('homepageSlugStrategy', selectedStrategy);
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
    const currentHomepageSlugStrategy = settings.provide('slug').homepageSlugStrategy;
    setShowDefaultLanguage(currentShowDefaultLanguage);
    setSelectedStrategy(currentHomepageSlugStrategy);
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
                <Typography variant="sigma" style={{ paddingBottom: '5px' }}>
                  {formatMessage({
                    id: getTranslation(
                      `module.${module}.modal.settings.input.default-language.title`
                    ),
                    defaultMessage: 'Show language slug',
                  })}
                </Typography>
                <Typography
                  variant="pi"
                  style={{ paddingBottom: '5px', color: '#a5a5ba', display: 'flex' }}
                >
                  {formatMessage({
                    id: getTranslation(
                      `module.${module}.modal.settings.input.default-language.description`
                    ),
                    defaultMessage: 'Show language slug for default language in site url',
                  })}
                </Typography>
                <Toggle
                  onLabel="True"
                  offLabel="False"
                  checked={showDefaultLanguage}
                  onChange={(e: any) => setShowDefaultLanguage(e.target.checked)}
                />
                <Typography variant="sigma" style={{ paddingBottom: '5px', paddingTop: '24px' }}>
                  {formatMessage({
                    id: getTranslation(`module.${module}.modal.settings.input.homepage.title`),
                    defaultMessage: 'Home page',
                  })}
                </Typography>
                <Typography
                  variant="pi"
                  style={{ paddingBottom: '5px', color: '#a5a5ba', display: 'flex' }}
                >
                  {formatMessage({
                    id: getTranslation(
                      `module.${module}.modal.settings.input.homepage.description`
                    ),
                    defaultMessage: 'The content that will be rendered as the homepage',
                  })}
                </Typography>
                <BoxInput style={{ flex: 1, display: 'flex', width: '100%' }}>
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
                <Typography variant="sigma" style={{ paddingBottom: '5px', paddingTop: '24px' }}>
                  {formatMessage({
                    id: getTranslation(
                      `module.${module}.modal.settings.input.homepage-strategy.title`
                    ),
                    defaultMessage: 'Home page slug strategy',
                  })}
                </Typography>
                <BoxInput style={{ flex: 1, display: 'flex', width: '100%' }}>
                  <SingleSelect
                    onChange={(value: string) => setSelectedStrategy(value)}
                    value={selectedStrategy}
                  >
                    <SingleSelectOption value={SLUG_LANGUAGE_STRATEGY}>Language</SingleSelectOption>
                    <SingleSelectOption value={SLUG_CONTENT_STRATEGY}>Content</SingleSelectOption>
                  </SingleSelect>
                </BoxInput>
                <Card
                  shadow={false}
                  style={{
                    marginTop: '10px',
                    padding: '10px',
                    display: 'flex',
                    alignItems: 'center',
                  }}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="24"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <path
                      fill="#7b79ff"
                      d="M12 0C5.383 0 0 5.383 0 12s5.383 12 12 12 12-5.383 12-12S18.617 0 12 0Zm1.154 18.456h-2.308V16.15h2.308v2.307Zm-.23-3.687h-1.847l-.346-9.23h2.538l-.346 9.23Z"
                    ></path>
                  </svg>
                  {selectedStrategy === SLUG_LANGUAGE_STRATEGY && (
                    <Typography
                      variant="pi"
                      style={{ color: '#a5a5ba', display: 'flex', marginLeft: '10px' }}
                    >
                      {formatMessage({
                        id: getTranslation(
                          `module.${module}.modal.settings.input.homepage-strategy.description.language`
                        ),
                        defaultMessage:
                          'Use the language slug and ignore the content slug set as the homepage',
                      })}
                    </Typography>
                  )}
                  {selectedStrategy === SLUG_CONTENT_STRATEGY && (
                    <Typography
                      variant="pi"
                      style={{ color: '#a5a5ba', display: 'flex', marginLeft: '10px' }}
                    >
                      {formatMessage({
                        id: getTranslation(
                          `module.${module}.modal.settings.input.homepage-strategy.description.content`
                        ),
                        defaultMessage: 'Use the slug of the content set as the homepage',
                      })}
                    </Typography>
                  )}
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

export default SlugSettingsModal;
