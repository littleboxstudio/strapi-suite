import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import { Main, Button, Box, Loader } from '@strapi/design-system';
import { Check } from '@strapi/icons';
import { useNavigate, useParams } from 'react-router-dom';
import config from '../core/config';
import { getTranslation } from '../core/utils/getTranslation';
import FetchMenu, { Output as OutputFetchMenu } from '../core/usecases/fetchMenu';
import EditMenu from '../core/usecases/editMenu';
import HeaderLayout from '../components/HeaderLayout';
import MenuDragDrop from '../components/menu/MenuDragDrop';
import ConfirmModal from '../components/ConfirmModal';
import { RequestEditInput } from '../components/menu/types';

const MenuSettingsEditPage = () => {
  const [module, setModule] = useState(config.uuid.modules.menu);
  const [data, setData] = useState<OutputFetchMenu>();
  const [fetchInProgress, setFetchInProgress] = useState(true);
  const [saveInProgress, setSaveInProgress] = useState(false);
  const [enableSaveButton, setEnableSaveButton] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [unsavedData, setUnsavedData] = useState<RequestEditInput | null>();
  const { formatMessage } = useIntl();
  const navigate = useNavigate();
  const { documentId } = useParams();

  async function fetchData() {
    setFetchInProgress(true);
    const fetchMenu = new FetchMenu();
    const outputFetchMenu = await fetchMenu.execute(documentId as string);
    if (!outputFetchMenu.id) {
      navigate(`/plugins/${config.pluginId}/${module}`);
      return;
    }
    setData(outputFetchMenu);
    setFetchInProgress(false);
  }

  async function handleSave(data: RequestEditInput | null) {
    setEnableSaveButton(data ? true : false);
    setUnsavedData(data);
  }

  async function save() {
    if (unsavedData && documentId) {
      setSaveInProgress(true);
      const editMenu = new EditMenu();
      await editMenu.execute(documentId, {
        uid: unsavedData.uid,
        title: unsavedData.title,
        children: unsavedData.children,
      });
      setUnsavedData(null);
      setSaveInProgress(false);
      setEnableSaveButton(false);
    }
  }

  function cancel() {
    if (unsavedData) {
      setShowConfirmModal(true);
    } else {
      navigate(`/plugins/${config.pluginId}/${module}`);
    }
  }

  useEffect(() => {
    fetchData();
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
          { title: 'Menu', link: `/plugins/${config.pluginId}/${module}` },
          { title: 'Edit' },
        ]}
        description={formatMessage({ id: getTranslation(`module.${module}.description`) })}
      >
        <Button
          variant="tertiary"
          size="S"
          style={{ marginRight: '10px' }}
          disabled={saveInProgress}
          onClick={cancel}
        >
          {formatMessage({ id: getTranslation('app.cancel') })}
        </Button>
        <Button
          size="S"
          startIcon={saveInProgress ? <Loader small /> : <Check />}
          onClick={save}
          disabled={saveInProgress || !enableSaveButton}
        >
          {formatMessage({ id: getTranslation('app.save') })}
        </Button>
      </HeaderLayout>
      <Box style={{ display: 'flex', paddingTop: '40px', with: '100%' }}>
        {fetchInProgress && <Loader small />}
        {!fetchInProgress && data && <MenuDragDrop data={data} onSaveEvent={handleSave} />}
      </Box>
      <ConfirmModal
        open={showConfirmModal}
        title={formatMessage({
          id: getTranslation(`app.modal.confirm.title`),
          defaultMessage: 'Confirmation',
        })}
        text={formatMessage({
          id: getTranslation(`module.${module}.edit.cancel`),
          defaultMessage: 'Are you sure you want to cancel?',
        })}
        confirm={{
          action: () => {
            navigate(`/plugins/${config.pluginId}/${module}`);
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

export { MenuSettingsEditPage };
