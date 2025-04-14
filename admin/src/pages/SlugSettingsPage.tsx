import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import {
  Main,
  Button,
  SingleSelect,
  SingleSelectOption,
  Table,
  Thead,
  Tbody,
  Tr,
  Td,
  Th,
  Checkbox,
  Typography,
  VisuallyHidden,
  Flex,
  IconButton,
  Box,
  EmptyStateLayout,
  Loader,
  Searchbar,
  SearchForm,
} from '@strapi/design-system';
import { Pencil, Trash, BulletList } from '@strapi/icons';
import { EmptyDocuments } from '@strapi/icons/symbols';
import config from '../core/config';
import UpdateSetting from '../core/usecases/updateSetting';
import { getTranslation } from '../core/utils/getTranslation';
import DeleteSlugs from '../core/usecases/deleteSlugs';
import FetchSlugs, { Output as OutputFetchSlugs } from '../core/usecases/fetchSlugs';
import FetchLocales, { Output as OutputFetchLocales } from '../core/usecases/fetchLocales';
import HeaderLayout from '../components/HeaderLayout';
import ConfirmModal from '../components/ConfirmModal';
import SlugSettingsModal from '../components/SlugSettingsModal';
import { useSettings } from '../contexts/settings';

const SlugSettingsPage = () => {
  const [module, setModule] = useState(config.uuid.modules.slug);
  const [records, setRecords] = useState<OutputFetchSlugs[]>([]);
  const [filteredRecords, setFilteredRecords] = useState<OutputFetchSlugs[]>([]);
  const [i18nLocales, setI18nLocales] = useState<OutputFetchLocales[]>([]);
  const [currentI18nLocale, setCurrentI18nLocale] = useState<OutputFetchLocales>();
  const [defaultLocale, setDefaultLocale] = useState<OutputFetchLocales>();
  const [fetchInProgress, setFetchInProgress] = useState(true);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [selectedRecords, setSelectedRecords] = useState<string[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [currentHomePage, setCurrentHomePage] = useState();
  const { formatMessage } = useIntl();
  const settings = useSettings();

  async function toggleState(value: boolean) {
    const updateSetting = new UpdateSetting();
    await updateSetting.execute({
      property: 'active',
      module,
      value,
    });
  }

  function changeLocale(code: string) {
    i18nLocales.forEach((i18nLocale: OutputFetchLocales) => {
      if (i18nLocale.code === code) {
        setCurrentI18nLocale(i18nLocale);
      }
    });
  }

  async function fetchLocales() {
    const fetchLocales = new FetchLocales();
    const fetchLocalesOutput = await fetchLocales.execute();
    const defaultLocale = fetchLocalesOutput.find((locale) => locale.isDefault);
    setI18nLocales(fetchLocalesOutput);
    setDefaultLocale(defaultLocale);
  }

  async function fetchRecords() {
    setFetchInProgress(true);
    const fetchSlugs = new FetchSlugs();
    const outputFetchSlugs = await fetchSlugs.execute({ locale: currentI18nLocale?.code });
    setRecords(outputFetchSlugs);
    setFilteredRecords(outputFetchSlugs);
    setFetchInProgress(false);
  }

  async function deleteRecords(contentIds: string[]) {
    setFetchInProgress(true);
    const deleteSlugs = new DeleteSlugs();
    await deleteSlugs.execute(contentIds, { locale: currentI18nLocale?.code });
  }

  function toggleCheckbox(value: string) {
    if (selectedRecords.includes(value)) {
      setSelectedRecords(selectedRecords.filter((item) => item !== value));
    } else {
      setSelectedRecords([...selectedRecords, value]);
    }
  }

  function selectAllRecords() {
    const items: string[] = [];
    records.forEach((item) => items.push(item.contentId));
    setSelectedRecords(items);
  }

  function filterRecords(term: string) {
    if (searchTerm.length === 0) {
      setFilteredRecords(records);
      return;
    }
    setFilteredRecords(
      records.filter((item) =>
        Object.values(item).some(
          (val) => val && val.toString().toLowerCase().includes(term.toLowerCase())
        )
      )
    );
  }

  function getParentTitle(parentId: string): any {
    const parent = records.find((record) => record.contentId === parentId);
    return parent?.contentTitle;
  }

  function getCurrentHomePage() {
    const currentHomePage = settings.provide('slug').homepageContentId;
    setCurrentHomePage(currentHomePage);
  }

  useEffect(() => {
    const timer = setTimeout(() => {
      if (records.length > 0) {
        filterRecords(searchTerm);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchTerm, records]);

  useEffect(() => {
    i18nLocales.forEach((i18nLocale: OutputFetchLocales) => {
      if (i18nLocale.isDefault) {
        setCurrentI18nLocale(i18nLocale);
      }
    });
  }, [i18nLocales]);

  useEffect(() => {
    if (currentI18nLocale) {
      fetchRecords();
    }
  }, [currentI18nLocale]);

  useEffect(() => {
    getCurrentHomePage();
  }, [settings]);

  useEffect(() => {
    fetchLocales();
  }, []);

  return (
    <Main
      style={{
        width: '100%',
        padding: '40px 50px',
      }}
    >
      <HeaderLayout
        breadcrumbs={[
          { title: 'Suite Modules', link: `/plugins/${config.pluginId}` },
          { title: 'Slug' },
        ]}
        description={formatMessage({ id: getTranslation(`module.${module}.description`) })}
      >
        <Button
          variant="secondary"
          size="S"
          onClick={() => setShowSettingsModal(true)}
          startIcon={<BulletList />}
          style={{ marginRight: '10px' }}
        >
          {formatMessage({ id: getTranslation('app.settings') })}
        </Button>
        {!settings.provide(module).active && (
          <Button variant="danger" size="S" onClick={() => toggleState(true)}>
            {formatMessage({ id: getTranslation('app.disabled') })}
          </Button>
        )}
        {settings.provide(module).active && (
          <Button size="S" onClick={() => toggleState(false)}>
            {formatMessage({ id: getTranslation('app.enabled') })}
          </Button>
        )}
      </HeaderLayout>
      <Box style={{ display: 'flex', paddingTop: '40px', with: '100%' }}>
        <Box style={{ display: 'flex', flex: '1' }}>
          <SearchForm>
            <Searchbar
              name="searchbar"
              value={searchTerm}
              onClear={() => setSearchTerm('')}
              onChange={(e: any) => setSearchTerm(e.target.value)}
              clearLabel={formatMessage({
                id: getTranslation(`module.${module}.table.search.label`),
                defaultMessage: 'Clearing the search',
              })}
              placeholder={formatMessage({
                id: getTranslation(`module.${module}.table.search.placeholder`),
                defaultMessage: 'Enter the search term',
              })}
            />
          </SearchForm>
        </Box>
        <Box style={{ display: 'flex', gap: '10px' }}>
          {selectedRecords.length > 0 && (
            <Button size="S" variant="danger-light" onClick={() => setShowConfirmModal(true)}>
              {formatMessage({
                id: getTranslation('app.delete'),
                defaultMessage: 'Delete',
              })}{' '}
              ({selectedRecords.length})
            </Button>
          )}
          <SingleSelect size="S" onChange={changeLocale} value={currentI18nLocale?.code}>
            {i18nLocales.map((i18nLocale: OutputFetchLocales, index) => (
              <SingleSelectOption key={index} value={i18nLocale.code}>
                {i18nLocale.name}
              </SingleSelectOption>
            ))}
          </SingleSelect>
        </Box>
      </Box>
      <Box style={{ paddingTop: '16px', with: '100%' }}>
        <Table colCount={6} styled={{ with: '100%' }}>
          <Thead>
            <Tr>
              <Th>
                <Checkbox
                  aria-label="Select all entries"
                  onClick={() => {
                    if (records.length !== selectedRecords.length) selectAllRecords();
                    if (records.length === selectedRecords.length) setSelectedRecords([]);
                  }}
                  checked={
                    selectedRecords.length > 0 && selectedRecords.length === records.length
                      ? true
                      : selectedRecords.length > 0
                        ? 'indeterminate'
                        : false
                  }
                />
              </Th>
              <Th>
                <Typography variant="sigma">
                  {formatMessage({
                    id: getTranslation(`module.${module}.table.column.id`),
                    defaultMessage: 'ID',
                  })}
                </Typography>
              </Th>
              <Th>
                <Typography variant="sigma">
                  {formatMessage({
                    id: getTranslation(`module.${module}.table.column.locale`),
                    defaultMessage: 'Locale',
                  })}
                </Typography>
              </Th>
              <Th>
                <Typography variant="sigma">
                  {formatMessage({
                    id: getTranslation(`module.${module}.table.column.slug`),
                    defaultMessage: 'Slug',
                  })}
                </Typography>
              </Th>
              <Th>
                <Typography variant="sigma">
                  {formatMessage({
                    id: getTranslation(`module.${module}.table.column.content-title`),
                    defaultMessage: 'Content Title',
                  })}
                </Typography>
              </Th>
              <Th>
                <Typography variant="sigma">
                  {formatMessage({
                    id: getTranslation(`module.${module}.table.column.parent`),
                    defaultMessage: 'Parent',
                  })}
                </Typography>
              </Th>
              <Th>
                <VisuallyHidden>
                  {formatMessage({
                    id: getTranslation(`module.${module}.table.column.actions`),
                    defaultMessage: 'Actions',
                  })}
                </VisuallyHidden>
              </Th>
            </Tr>
          </Thead>
          <Tbody>
            {!fetchInProgress &&
              filteredRecords.map((entry: OutputFetchSlugs) => (
                <Tr key={entry.id}>
                  <Td>
                    <Checkbox
                      aria-label={`Select ${entry.contentTitle}`}
                      onClick={() => toggleCheckbox(entry.contentId)}
                      checked={selectedRecords.includes(entry.contentId)}
                    />
                  </Td>
                  <Td>
                    <Typography textColor="neutral800">{entry.id}</Typography>
                  </Td>
                  <Td>
                    <Typography textColor="neutral800">{entry.locale}</Typography>
                  </Td>
                  <Td>
                    <Typography textColor="neutral800">{entry.slug}</Typography>
                  </Td>
                  <Td>
                    <Box style={{ display: 'flex', alignItems: 'center' }}>
                      {entry.contentId === currentHomePage && (
                        <Box
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            backgroundColor: '#7b79ff',
                            color: '#fff',
                            borderRadius: '4px',
                            padding: '3px 8px',
                            marginRight: '10px',
                          }}
                        >
                          <Typography variant="sigma">Homepage</Typography>
                        </Box>
                      )}
                      <Typography textColor="neutral800">{entry.contentTitle}</Typography>
                    </Box>
                  </Td>
                  <Td>
                    <Typography textColor="neutral800">
                      {!entry.parentContentId && <>--</>}
                      {entry.parentContentId && (
                        <a
                          style={{ color: '#7b79ff', textDecoration: 'none' }}
                          href={`/admin/content-manager/collection-types/${entry.parentContentModel}/${entry.parentContentId}?plugins[i18n][locale]=${currentI18nLocale?.code}`}
                          target="_blank"
                        >
                          {getParentTitle(entry.parentContentId)}
                        </a>
                      )}
                    </Typography>
                  </Td>
                  <Td style={{ paddingRight: '0px' }}>
                    <Flex style={{ justifyContent: 'end', gap: '10px' }}>
                      <IconButton
                        onClick={() =>
                          window.open(
                            `/admin/content-manager/collection-types/${entry.contentModel}/${entry.contentId}?plugins[i18n][locale]=${currentI18nLocale?.code}`,
                            '_blank'
                          )
                        }
                        label={formatMessage({
                          id: getTranslation('app.edit'),
                          defaultMessage: 'Edit',
                        })}
                        borderWidth={0}
                      >
                        <Pencil />
                      </IconButton>
                      <IconButton
                        variant="danger-light"
                        onClick={() => {
                          setSelectedRecords([entry.contentId]);
                          setShowConfirmModal(true);
                        }}
                        label={formatMessage({
                          id: getTranslation('app.delete'),
                          defaultMessage: 'Delete',
                        })}
                        borderWidth={0}
                      >
                        <Trash />
                      </IconButton>
                    </Flex>
                  </Td>
                </Tr>
              ))}
            {fetchInProgress && (
              <Td colSpan="7">
                <EmptyStateLayout shadow={false} content={<Loader small />} />
              </Td>
            )}
            {!fetchInProgress && records.length === 0 && (
              <Td colSpan="7">
                <EmptyStateLayout
                  shadow={false}
                  content={
                    <>
                      <EmptyDocuments width="160px" height="88px" />
                      <br />
                      <br />
                      {formatMessage({ id: getTranslation('app.empty') })}
                    </>
                  }
                />
              </Td>
            )}
          </Tbody>
        </Table>
      </Box>
      <ConfirmModal
        open={showConfirmModal}
        title={formatMessage({
          id: getTranslation(`app.modal.confirm.title`),
          defaultMessage: 'Confirmation',
        })}
        text={
          selectedRecords.length === 1
            ? formatMessage({
                id: getTranslation(`module.${module}.table.delete.confirmation.singular`),
                defaultMessage: 'Are you sure you want to delete this entry?',
              })
            : formatMessage({
                id: getTranslation(`module.${module}.table.delete.confirmation.plural`),
                defaultMessage: 'Are you sure you want to delete these entries?',
              })
        }
        confirm={{
          action: async () => {
            await deleteRecords(selectedRecords);
            fetchRecords();
            setSelectedRecords([]);
            setShowConfirmModal(false);
          },
          button: formatMessage({
            id: getTranslation(`app.modal.confirm.button.confirm`),
            defaultMessage: 'Confirm',
          }),
        }}
        cancel={{
          action: () => setShowConfirmModal(false),
          button: formatMessage({
            id: getTranslation(`app.modal.confirm.button.cancel`),
            defaultMessage: 'Cancel',
          }),
        }}
      />
      <SlugSettingsModal
        defaultLocale={defaultLocale as OutputFetchLocales}
        open={showSettingsModal}
        close={() => setShowSettingsModal(false)}
      />
    </Main>
  );
};

export { SlugSettingsPage };
