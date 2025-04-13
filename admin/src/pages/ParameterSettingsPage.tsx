import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import {
  Main,
  Button,
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
  Tooltip,
} from '@strapi/design-system';
import { Pencil, Trash, Plus, Shield } from '@strapi/icons';
import { EmptyDocuments } from '@strapi/icons/symbols';
import config from '../core/config';
import UpdateSetting from '../core/usecases/updateSetting';
import { getTranslation } from '../core/utils/getTranslation';
import DeleteParameters from '../core/usecases/deleteParameters';
import FetchParameters, { Output as OutputFetchParameters } from '../core/usecases/fetchParameters';
import { useSettings } from '../contexts/settings';
import HeaderLayout from '../components/HeaderLayout';
import ConfirmModal from '../components/ConfirmModal';
import ParameterHandleDataModal from '../components/ParameterHandleDataModal';

const ParameterSettingsPage = () => {
  const [module, setModule] = useState(config.uuid.modules.parameter);
  const [records, setRecords] = useState<OutputFetchParameters[]>([]);
  const [filteredRecords, setFilteredRecords] = useState<OutputFetchParameters[]>([]);
  const [fetchInProgress, setFetchInProgress] = useState(true);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [selectedRecords, setSelectedRecords] = useState<string[]>([]);
  const [showHandleDataModal, setShowHandleDataModal] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedDocument, setSelectedDocument] = useState<OutputFetchParameters>();
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

  async function fetchRecords() {
    setFetchInProgress(true);
    const fetchParameters = new FetchParameters();
    const OutputFetchParameters = await fetchParameters.execute();
    setRecords(OutputFetchParameters);
    setFilteredRecords(OutputFetchParameters);
    setFetchInProgress(false);
  }

  async function deleteRecords(contentIds: string[]) {
    setFetchInProgress(true);
    const deleteParameters = new DeleteParameters();
    await deleteParameters.execute(contentIds);
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
    fetchRecords();
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
          { title: 'Parameter' },
        ]}
        description={formatMessage({ id: getTranslation(`module.${module}.description`) })}
      >
        <Button
          variant="secondary"
          size="S"
          style={{ marginRight: '10px' }}
          startIcon={<Plus />}
          onClick={() => {
            setSelectedDocument(undefined);
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
                    id: getTranslation(`module.${module}.table.column.uid`),
                    defaultMessage: 'UID',
                  })}
                </Typography>
              </Th>
              <Th>
                <Typography variant="sigma">
                  {formatMessage({
                    id: getTranslation(`module.${module}.table.column.value`),
                    defaultMessage: 'Value',
                  })}
                </Typography>
              </Th>
              <Th>
                <Typography variant="sigma">
                  {formatMessage({
                    id: getTranslation(`module.${module}.table.column.visibility`),
                    defaultMessage: 'Visibility',
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
              filteredRecords.map((entry: OutputFetchParameters) => (
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
                    <Typography textColor="neutral800">{entry.uid}</Typography>
                  </Td>
                  <Td>
                    <Typography textColor="neutral800">{entry.value}</Typography>
                  </Td>
                  <Td>
                    {entry.private && <Typography textColor="neutral800">Private</Typography>}
                    {!entry.private && (
                      <Box style={{ color: '#ee5e52', display: 'flex' }}>
                        <Tooltip
                          label={formatMessage({
                            id: getTranslation(`module.${module}.table.public.warning`),
                            defaultMessage: 'Available via API',
                          })}
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 32 32"
                            width="20px"
                            height="20px"
                            fill="#ee5e52"
                          >
                            <path d="M16 3a13 13 0 1 0 13 13A13.013 13.013 0 0 0 16 3m-1 7a1 1 0 0 1 2 0v7a1 1 0 0 1-2 0zm1 13a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3"></path>
                          </svg>
                        </Tooltip>
                        <Typography
                          textColor="neutral800"
                          style={{ display: 'flex', paddingLeft: '7px' }}
                        >
                          {formatMessage({
                            id: getTranslation(`module.${module}.table.public`),
                            defaultMessage: 'Public',
                          })}
                        </Typography>
                      </Box>
                    )}
                  </Td>
                  <Td style={{ paddingRight: '0px' }}>
                    <Flex style={{ justifyContent: 'end', gap: '10px' }}>
                      <IconButton
                        onClick={() => {
                          setSelectedDocument(entry);
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
      <ParameterHandleDataModal
        currentRecords={records}
        data={selectedDocument || ({} as OutputFetchParameters)}
        open={showHandleDataModal}
        close={(refresh: boolean) => {
          setShowHandleDataModal(false);
          setSelectedDocument(undefined);
          if (refresh) {
            fetchRecords();
          }
        }}
      />
    </Main>
  );
};

export { ParameterSettingsPage };
