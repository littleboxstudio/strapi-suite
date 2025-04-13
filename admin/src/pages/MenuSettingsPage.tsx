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
import { Pencil, Trash, Plus, Duplicate } from '@strapi/icons';
import { EmptyDocuments } from '@strapi/icons/symbols';
import { useNavigate } from 'react-router-dom';
import config from '../core/config';
import UpdateSetting from '../core/usecases/updateSetting';
import { getTranslation } from '../core/utils/getTranslation';
import DeleteMenus from '../core/usecases/deleteMenus';
import FetchMenus, { Output as OutputFetchMenus } from '../core/usecases/fetchMenus';
import FetchLocales, { Output as OutputFetchLocales } from '../core/usecases/fetchLocales';
import { useSettings } from '../contexts/settings';
import HeaderLayout from '../components/HeaderLayout';
import ConfirmModal from '../components/ConfirmModal';
import MenuCreateModal from '../components/MenuCreateModal';
import MenuDuplicateModal from '../components/MenuDuplicateModal';

const MenuSettingsPage = () => {
  const [module, setModule] = useState(config.uuid.modules.menu);
  const [records, setRecords] = useState<OutputFetchMenus[]>([]);
  const [filteredRecords, setFilteredRecords] = useState<OutputFetchMenus[]>([]);
  const [i18nLocales, setI18nLocales] = useState<OutputFetchLocales[]>([]);
  const [currentI18nLocale, setCurrentI18nLocale] = useState<OutputFetchLocales>();
  const [fetchInProgress, setFetchInProgress] = useState(true);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [showDuplicateModal, setShowDuplicateModal] = useState(false);
  const [selectedRecords, setSelectedRecords] = useState<string[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [duplicateDocumentId, setDuplicateDocumentId] = useState<string>();
  const { formatMessage } = useIntl();
  const settings = useSettings();
  const navigate = useNavigate();

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
    setI18nLocales(fetchLocalesOutput);
  }

  async function fetchRecords() {
    setFetchInProgress(true);
    const fetchMenus = new FetchMenus();
    const OutputFetchMenus = await fetchMenus.execute({
      locale: currentI18nLocale?.code,
    });
    setRecords(OutputFetchMenus);
    setFilteredRecords(OutputFetchMenus);
    setFetchInProgress(false);
  }

  async function deleteRecords(contentIds: string[]) {
    setFetchInProgress(true);
    const deleteMenus = new DeleteMenus();
    await deleteMenus.execute(contentIds, { locale: currentI18nLocale?.code });
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
    records.forEach((item) => items.push(item.documentId));
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
    if (currentI18nLocale) {
      fetchRecords();
    }
  }, [currentI18nLocale]);

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
          { title: 'Menu' },
        ]}
        description={formatMessage({ id: getTranslation(`module.${module}.description`) })}
      >
        <Button
          variant="secondary"
          size="S"
          style={{ marginRight: '10px' }}
          startIcon={<Plus />}
          onClick={() => setShowCreateModal(true)}
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
                    id: getTranslation(`module.${module}.table.column.id`),
                    defaultMessage: 'ID',
                  })}
                </Typography>
              </Th>
              <Th>
                <Typography variant="sigma">
                  {formatMessage({
                    id: getTranslation(`module.${module}.table.column.document-id`),
                    defaultMessage: 'Document ID',
                  })}
                </Typography>
              </Th>
              <Th>
                <Typography variant="sigma">
                  {formatMessage({
                    id: getTranslation(`module.${module}.table.column.title`),
                    defaultMessage: 'Title',
                  })}
                </Typography>
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
                    id: getTranslation(`module.${module}.table.column.locale`),
                    defaultMessage: 'Locale',
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
              filteredRecords.map((entry: OutputFetchMenus) => (
                <Tr key={entry.id}>
                  <Td>
                    <Checkbox
                      aria-label={`Select ${entry.documentId}`}
                      onClick={() => toggleCheckbox(entry.documentId)}
                      checked={selectedRecords.includes(entry.documentId)}
                    />
                  </Td>
                  <Td>
                    <Typography textColor="neutral800">{entry.id}</Typography>
                  </Td>
                  <Td>
                    <Typography textColor="neutral800">{entry.documentId}</Typography>
                  </Td>
                  <Td>
                    <Typography textColor="neutral800">{entry.title}</Typography>
                  </Td>
                  <Td>
                    <Typography textColor="neutral800">{entry.uid}</Typography>
                  </Td>
                  <Td>
                    <Typography textColor="neutral800">{entry.locale}</Typography>
                  </Td>
                  <Td style={{ paddingRight: '0px' }}>
                    <Flex style={{ justifyContent: 'end', gap: '10px' }}>
                      <IconButton
                        onClick={() =>
                          navigate(`/plugins/${config.pluginId}/${module}/${entry.documentId}`)
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
                        onClick={() => {
                          setDuplicateDocumentId(entry.documentId);
                          setShowDuplicateModal(true);
                        }}
                        label={formatMessage({
                          id: getTranslation('app.duplicate'),
                          defaultMessage: 'Duplicate',
                        })}
                        borderWidth={0}
                      >
                        <Duplicate />
                      </IconButton>
                      <IconButton
                        variant="danger-light"
                        onClick={() => {
                          setSelectedRecords([entry.documentId]);
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
      <MenuCreateModal
        currentRecords={records}
        locale={currentI18nLocale?.code}
        open={showCreateModal}
        close={(refresh: boolean) => {
          setShowCreateModal(false);
          if (refresh) {
            fetchRecords();
          }
        }}
      />
      <MenuDuplicateModal
        documentId={duplicateDocumentId}
        locales={i18nLocales}
        open={showDuplicateModal}
        close={(refresh: boolean) => {
          setShowDuplicateModal(false);
          if (refresh) {
            fetchRecords();
          }
        }}
      />
    </Main>
  );
};

export { MenuSettingsPage };
