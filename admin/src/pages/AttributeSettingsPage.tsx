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
import { Pencil, Trash } from '@strapi/icons';
import { EmptyDocuments } from '@strapi/icons/symbols';
import config from '../core/config';
import UpdateSetting from '../core/usecases/updateSetting';
import { getTranslation } from '../core/utils/getTranslation';
import DeleteAttributes from '../core/usecases/deleteAttributes';
import FetchAttributes, { Output as OutputFetchAttributes } from '../core/usecases/fetchAttributes';
import FetchLocales, { Output as OutputFetchLocales } from '../core/usecases/fetchLocales';
import HeaderLayout from '../components/HeaderLayout';
import ConfirmModal from '../components/ConfirmModal';
import { useSettings } from '../contexts/settings';

const AttributeSettingsPage = () => {
  const [module, setModule] = useState(config.uuid.modules.attribute);
  const [records, setRecords] = useState<OutputFetchAttributes[]>([]);
  const [filteredRecords, setFilteredRecords] = useState<OutputFetchAttributes[]>([]);
  const [i18nLocales, setI18nLocales] = useState<OutputFetchLocales[]>([]);
  const [currentI18nLocale, setCurrentI18nLocale] = useState<OutputFetchLocales>();
  const [fetchInProgress, setFetchInProgress] = useState(true);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [selectedRecords, setSelectedRecords] = useState<string[]>([]);
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

  async function fetchLocales() {
    const fetchLocales = new FetchLocales();
    const fetchLocalesOutput = await fetchLocales.execute();
    setI18nLocales(fetchLocalesOutput);
  }

  async function fetchRecords() {
    setFetchInProgress(true);
    const fetchAttributes = new FetchAttributes();
    const OutputFetchAttributes = await fetchAttributes.execute({
      locale: currentI18nLocale?.code,
    });
    setRecords(OutputFetchAttributes);
    setFilteredRecords(OutputFetchAttributes);
    setFetchInProgress(false);
  }

  async function deleteRecords(contentIds: string[]) {
    setFetchInProgress(true);
    const deleteAttributes = new DeleteAttributes();
    await deleteAttributes.execute(contentIds, { locale: currentI18nLocale?.code });
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
          { title: 'Attribute' },
        ]}
        description={formatMessage({ id: getTranslation(`module.${module}.description`) })}
      >
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
                <Typography variant="sigma">
                  {formatMessage({
                    id: getTranslation(`module.${module}.table.column.template`),
                    defaultMessage: 'Template',
                  })}
                </Typography>
              </Th>
              <Th>
                <Typography variant="sigma">
                  {formatMessage({
                    id: getTranslation(`module.${module}.table.column.priority`),
                    defaultMessage: 'Priority',
                  })}
                </Typography>
              </Th>
              <Th>
                <Typography variant="sigma">
                  {formatMessage({
                    id: getTranslation(`module.${module}.table.column.frequency`),
                    defaultMessage: 'Change Frequency',
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
              filteredRecords.map((entry: OutputFetchAttributes) => (
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
                    <Typography textColor="neutral800">{entry.contentTitle}</Typography>
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
                          {entry.parentContentTitle}
                        </a>
                      )}
                    </Typography>
                  </Td>
                  <Td>
                    <Typography textColor="neutral800">{entry.templateTitle}</Typography>
                  </Td>
                  <Td>
                    <Typography textColor="neutral800">
                      {!entry.priority && <>--</>}
                      {entry.priority}
                    </Typography>
                  </Td>
                  <Td>
                    <Typography textColor="neutral800">
                      {!entry.frequency && <>--</>}
                      {entry.frequency}
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
              <Td colSpan="6">
                <EmptyStateLayout shadow={false} content={<Loader small />} />
              </Td>
            )}
            {!fetchInProgress && records.length === 0 && (
              <Td colSpan="6">
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
    </Main>
  );
};

export { AttributeSettingsPage };
