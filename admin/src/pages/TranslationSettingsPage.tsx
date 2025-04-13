import { Fragment, useEffect, useState } from 'react';
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
  Card,
  Tooltip,
} from '@strapi/design-system';
import { Pencil, Trash, Plus, Duplicate } from '@strapi/icons';
import { EmptyDocuments } from '@strapi/icons/symbols';
import styled from 'styled-components';
import config from '../core/config';
import UpdateSetting from '../core/usecases/updateSetting';
import { getTranslation } from '../core/utils/getTranslation';
import DeleteTranslations from '../core/usecases/deleteTranslations';
import FetchTranslations, {
  Output as OutputFetchTranslations,
} from '../core/usecases/fetchTranslations';
import FetchLocales, { Output as OutputFetchLocales } from '../core/usecases/fetchLocales';
import { useSettings } from '../contexts/settings';
import HeaderLayout from '../components/HeaderLayout';
import ConfirmModal from '../components/ConfirmModal';
import TranslationHandleDataModal from '../components/TranslationHandleDataModal';

interface TranslationItem {
  id: number;
  uid: string;
  translations: Record<string, string>;
}

const CustomCard = styled(Card)`
  min-width: 32px;
  height: 32px;
  display: flex;
  justify-content: center;
  align-items: center;
  margin-right: 7px;
  padding: 0 7px;
`;

const TranslationSettingsPage = () => {
  const [module, setModule] = useState(config.uuid.modules.translation);
  const [records, setRecords] = useState<TranslationItem[]>([]);
  const [filteredRecords, setFilteredRecords] = useState<TranslationItem[]>([]);
  const [i18nLocales, setI18nLocales] = useState<OutputFetchLocales[]>([]);
  const [currentI18nLocale, setCurrentI18nLocale] = useState<OutputFetchLocales>();
  const [fetchInProgress, setFetchInProgress] = useState(true);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [selectedRecords, setSelectedRecords] = useState<string[]>([]);
  const [selectedRecord, setSelectedRecord] = useState<TranslationItem | undefined>();
  const [showHandleDataModal, setShowHandleDataModal] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
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

  function groupByUid(items: OutputFetchTranslations[]): TranslationItem[] {
    const groupedMap = items.reduce<Record<string, TranslationItem>>((acc, item) => {
      if (acc[item.uid]) {
        acc[item.uid].translations[item.locale] = item.translation;
      } else {
        acc[item.uid] = {
          id: item.id,
          uid: item.uid,
          translations: {
            [item.locale]: item.translation,
          },
        };
      }
      return acc;
    }, {});
    return Object.values(groupedMap);
  }

  async function fetchLocales() {
    const fetchLocales = new FetchLocales();
    const fetchLocalesOutput = await fetchLocales.execute();
    setI18nLocales(fetchLocalesOutput);
  }

  async function fetchRecords() {
    setFetchInProgress(true);
    const fetchTranslations = new FetchTranslations();
    const outputFetchTranslations = await fetchTranslations.execute();
    const mappedOutput = groupByUid(outputFetchTranslations);
    setRecords(mappedOutput);
    setFilteredRecords(mappedOutput);
    setFetchInProgress(false);
  }

  async function deleteRecords(uids: string[]) {
    setFetchInProgress(true);
    const deleteTranslations = new DeleteTranslations();
    await deleteTranslations.execute(uids);
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
    records.forEach((item) => items.push(item.uid));
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
    const fetch = async () => {
      await fetchLocales();
      fetchRecords();
    };
    fetch();
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
          { title: 'Translation' },
        ]}
        description={formatMessage({ id: getTranslation(`module.${module}.description`) })}
      >
        <Button
          variant="secondary"
          size="S"
          style={{ marginRight: '10px' }}
          startIcon={<Plus />}
          onClick={() => {
            setSelectedRecord(undefined);
            setShowHandleDataModal(true);
          }}
        >
          {formatMessage({ id: getTranslation('app.create-new-entry') })}
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
                    id: getTranslation(`module.${module}.table.column.uid`),
                    defaultMessage: 'UID',
                  })}
                </Typography>
              </Th>
              <Th>
                <Typography variant="sigma">
                  {formatMessage({
                    id: getTranslation(`module.${module}.table.column.translations`),
                    defaultMessage: 'Translations',
                  })}
                </Typography>
              </Th>
              <Th>
                <Typography variant="sigma">
                  {formatMessage({
                    id: getTranslation(`module.${module}.table.column.locales`),
                    defaultMessage: 'Locales',
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
            {currentI18nLocale &&
              !fetchInProgress &&
              filteredRecords.map((entry: TranslationItem, index: number) => (
                <Tr key={entry.uid}>
                  <Td>
                    <Checkbox
                      aria-label={`Select ${entry.uid}`}
                      onClick={() => toggleCheckbox(entry.uid)}
                      checked={selectedRecords.includes(entry.uid)}
                    />
                  </Td>
                  <Td>
                    <Typography textColor="neutral800">{entry.uid}</Typography>
                  </Td>
                  <Td>
                    <Typography textColor="neutral800">
                      {entry.translations[currentI18nLocale.code] || (
                        <Box style={{ color: '#ee5e52', display: 'flex' }}>
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 32 32"
                            width="20px"
                            height="20px"
                            fill="#ee5e52"
                          >
                            <path d="M16 3a13 13 0 1 0 13 13A13.013 13.013 0 0 0 16 3m-1 7a1 1 0 0 1 2 0v7a1 1 0 0 1-2 0zm1 13a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3"></path>
                          </svg>

                          <Typography
                            textColor="neutral800"
                            style={{ display: 'flex', paddingLeft: '7px' }}
                          >
                            {formatMessage({
                              id: getTranslation(`module.${module}.table.missing.warning`),
                              defaultMessage: 'Translation missing',
                            })}
                          </Typography>
                        </Box>
                      )}
                    </Typography>
                  </Td>
                  <Td>
                    <Box style={{ width: '100%', display: 'flex' }}>
                      {i18nLocales.map((locale: OutputFetchLocales) => (
                        <Fragment key={locale.code}>
                          {entry.translations[locale.code] && (
                            <CustomCard>
                              <Typography variant="sigma">{locale.code}</Typography>
                            </CustomCard>
                          )}
                          {!entry.translations[locale.code] && (
                            <Tooltip
                              label={formatMessage({
                                id: getTranslation(`module.${module}.table.missing.warning`),
                                defaultMessage: 'Translation missing',
                              })}
                            >
                              <CustomCard
                                style={{
                                  borderColor: '#ee5e52',
                                }}
                              >
                                <Typography variant="sigma">{locale.code}</Typography>
                              </CustomCard>
                            </Tooltip>
                          )}
                        </Fragment>
                      ))}
                    </Box>
                  </Td>
                  <Td style={{ paddingRight: '0px' }}>
                    <Flex style={{ justifyContent: 'end', gap: '10px' }}>
                      <IconButton
                        onClick={() => {
                          setSelectedRecord(entry);
                          setShowHandleDataModal(true);
                        }}
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
                          setSelectedRecords([entry.uid]);
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
      <TranslationHandleDataModal
        currentRecords={records}
        selectedRecord={selectedRecord}
        open={showHandleDataModal}
        locales={i18nLocales}
        close={(refresh: boolean) => {
          setShowHandleDataModal(false);
          setSelectedRecord(undefined);
          if (refresh) {
            fetchRecords();
          }
        }}
      />
    </Main>
  );
};

export { TranslationSettingsPage };
