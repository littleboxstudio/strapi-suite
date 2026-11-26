import { useEffect, useRef, useState } from 'react';
import { useIntl } from 'react-intl';
import { Button, Field, Flex, Loader, Modal, TextInput, Typography } from '@strapi/design-system';
import { Folder } from '@strapi/icons';
import { useRBAC, useStrapiApp } from '@strapi/strapi/admin';
import { getTranslation } from '../../core/utils/getTranslation';
import { startSize, type Size } from '../../core/utils/imageCrop';
import { CropZoomStep, type CropZoomState } from '../image/CropZoomStep';
import { CropFooter } from '../image/CropFooter';
import { CROP_BODY, FULL_SCREEN_MODAL } from '../image/fullScreen';
import { ImageDropzone } from '../../ecommerce/components/ImageDropzone';
import { MAX_IMAGE_BYTES } from '../../ecommerce/utils/imageUpload';
import { rbacKey } from '../../ecommerce/utils/rbac';
import {
  buildFieldUploadForm,
  isImageAsset,
  uploadErrorKey,
  type ImageFieldConfig,
  type MediaValue,
  type UploadSource,
} from './imageFieldValue';
import { errorStatus, imageErrorCode, useImageFieldApi } from './useImageFieldApi';
import { mediaSrc } from './backendUrl';

type Props = {
  config: ImageFieldConfig;
  onClose: () => void;
  /** The created Media Library file, as the field stores it. */
  onUploaded: (image: MediaValue) => void;
};

/** What is being cropped: a file from the computer or a Media Library file (read by the server). */
type Source = {
  upload: UploadSource;
  /** What the crop step shows: an object url (file) or the file's url (Media Library). */
  src: string;
  /** Revoked when the source changes or the modal closes. */
  objectUrl: boolean;
};

const EMPTY_CROP: CropZoomState = {
  transform: null,
  covers: true,
  upscale: false,
  deformed: false,
};

const UPLOAD_READ_ACTION = 'plugin::upload.read';
// Stable reference: useRBAC re-checks whenever the permissions array changes.
const LIBRARY_PERMISSIONS = [{ action: UPLOAD_READ_ACTION, subject: null }];
const LIBRARY_KEY = rbacKey(UPLOAD_READ_ACTION);

/**
 * The field's picker: a file (drop / choose) or a Media Library image, then the crop with zoom
 * and the alt text. Confirm creates the WebP result in the Media Library. Mount it only while open.
 */
const ImageFieldModal = ({ config, onClose, onUploaded }: Props) => {
  const { formatMessage } = useIntl();
  const t = (id: string, values?: Record<string, any>) =>
    formatMessage({ id: getTranslation(id) }, values);
  const api = useImageFieldApi();

  const MediaLibraryDialog = useStrapiApp(
    'ImageFieldModal',
    (state: any) => state.components?.['media-library']
  ) as React.ComponentType<any> | undefined;
  const { isLoading: permissionsLoading, allowedActions } = useRBAC(LIBRARY_PERMISSIONS);
  const canReadLibrary =
    !permissionsLoading && !!allowedActions[LIBRARY_KEY] && !!MediaLibraryDialog;

  /** The source being probed; a slower probe of an earlier pick is ignored. */
  const pending = useRef<Source | null>(null);
  const [source, setSource] = useState<Source | null>(null);
  const [natural, setNatural] = useState<Size | null>(null);
  const [size, setSize] = useState<Size>({ width: 1, height: 1 });
  const [cropState, setCropState] = useState<CropZoomState>(EMPTY_CROP);
  const [alternativeText, setAlternativeText] = useState('');
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [loadingSource, setLoadingSource] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(
    () => () => {
      if (source?.objectUrl) URL.revokeObjectURL(source.src);
    },
    [source]
  );
  useEffect(
    () => () => {
      pending.current = null;
    },
    []
  );

  const resetSource = () => {
    pending.current = null;
    setSource(null);
    setNatural(null);
    setCropState(EMPTY_CROP);
    setLoadingSource(false);
  };

  const probe = (next: Source, invalidMessage: string) => {
    pending.current = next;
    setLoadingSource(true);
    const image = new Image();
    image.onload = () => {
      if (pending.current !== next) {
        if (next.objectUrl) URL.revokeObjectURL(next.src);
        return;
      }
      const dimensions = { width: image.naturalWidth, height: image.naturalHeight };
      setLoadingSource(false);
      setSource(next);
      setNatural(dimensions);
      setSize(startSize(dimensions, { width: config.width, height: config.height }));
    };
    image.onerror = () => {
      if (next.objectUrl) URL.revokeObjectURL(next.src);
      if (pending.current !== next) return;
      pending.current = null;
      setLoadingSource(false);
      setError(invalidMessage);
    };
    image.src = next.src;
  };

  const chooseFile = (file: File | undefined) => {
    setError(null);
    resetSource();
    if (!file) return;
    if (file.size > MAX_IMAGE_BYTES) {
      setError(t('image.field.upload.tooLarge'));
      return;
    }
    probe(
      { upload: { file }, src: URL.createObjectURL(file), objectUrl: true },
      t('image.field.upload.invalidImage')
    );
  };

  const chooseAsset = (assets: any[] | undefined) => {
    setLibraryOpen(false);
    const asset = assets?.[0];
    if (!asset) return;
    setError(null);
    resetSource();
    if (!isImageAsset(asset)) {
      setError(t('image.field.library.notImage'));
      return;
    }
    // Strapi stores the size in KB.
    if (typeof asset.size === 'number' && asset.size * 1024 > MAX_IMAGE_BYTES) {
      setError(t('image.field.upload.tooLarge'));
      return;
    }
    const src = mediaSrc(asset.url);
    if (!src) {
      setError(t('image.field.upload.sourceError'));
      return;
    }
    if (!alternativeText && typeof asset.alternativeText === 'string') {
      setAlternativeText(asset.alternativeText);
    }
    probe(
      { upload: { sourceFileId: asset.id }, src, objectUrl: false },
      t('image.field.upload.sourceError')
    );
  };

  const { transform, covers } = cropState;
  const canUpload = !!source && !!natural && !!transform && covers && !uploading;

  const upload = async () => {
    if (!canUpload || !source || !transform) return;
    setUploading(true);
    setError(null);
    try {
      const image = await api.upload(
        buildFieldUploadForm(source.upload, transform, alternativeText)
      );
      onUploaded(image);
    } catch (err) {
      setError(t(`image.field.${uploadErrorKey(errorStatus(err), imageErrorCode(err))}`));
      setUploading(false);
    }
  };

  const busy = uploading || loadingSource;
  const ready = !!source && !!natural;

  /** Upload progress and errors, below the editor or the sources. */
  const status = (
    <>
      {uploading && (
        <Flex gap={2} alignItems="center" role="status">
          <Loader small />
          <Typography variant="omega">{t('image.field.uploading')}</Typography>
        </Flex>
      )}
      {error && (
        <Typography variant="omega" textColor="danger600" role="alert">
          {error}
        </Typography>
      )}
    </>
  );

  return (
    <Modal.Root open onOpenChange={(next: boolean) => !next && !uploading && onClose()}>
      <Modal.Content style={ready ? FULL_SCREEN_MODAL : undefined}>
        <Modal.Header>
          <Modal.Title>{t('image.field.modal.title')}</Modal.Title>
        </Modal.Header>
        {ready && source && natural ? (
          <Flex
            direction="column"
            alignItems="stretch"
            gap={4}
            paddingTop={6}
            paddingBottom={6}
            paddingLeft={7}
            paddingRight={7}
            style={CROP_BODY}
          >
            <CropZoomStep
              src={source.src}
              natural={natural}
              size={size}
              sizeLocked={config.sizeLocked}
              onSizeChange={setSize}
              onChange={setCropState}
              disabled={uploading}
              fill
              info={t('image.field.original', { width: natural.width, height: natural.height })}
            />
            <Field.Root name="alternativeText" hint={t('image.field.alt.hint')}>
              <Field.Label>{t('image.field.alt.label')}</Field.Label>
              <TextInput
                value={alternativeText}
                disabled={uploading}
                style={{ height: 38 }}
                onChange={(e: any) => setAlternativeText(e.target.value)}
              />
              <Field.Hint />
            </Field.Root>
            {status}
          </Flex>
        ) : (
          <Modal.Body>
            <Flex direction="column" alignItems="stretch" gap={4}>
              <ImageDropzone onFile={chooseFile} disabled={busy} />
              {canReadLibrary && (
                <Flex justifyContent="center">
                  <Button
                    variant="tertiary"
                    startIcon={<Folder />}
                    onClick={() => setLibraryOpen(true)}
                    disabled={busy}
                  >
                    {t('image.field.library.choose')}
                  </Button>
                </Flex>
              )}
              {loadingSource && (
                <Flex gap={2} alignItems="center" role="status">
                  <Loader small />
                  <Typography variant="omega">{t('image.field.loading')}</Typography>
                </Flex>
              )}
              {status}
            </Flex>
          </Modal.Body>
        )}

        {libraryOpen && MediaLibraryDialog && (
          <MediaLibraryDialog
            allowedTypes={['images']}
            multiple={false}
            onClose={() => setLibraryOpen(false)}
            onSelectAssets={chooseAsset}
          />
        )}
        <CropFooter
          crop={source && natural ? cropState : null}
          cancelLabel={t('image.field.cancel')}
          confirmLabel={t('image.field.confirm')}
          onCancel={onClose}
          onConfirm={upload}
          canConfirm={canUpload}
          loading={uploading}
          extraAction={
            ready ? (
              <Button variant="tertiary" onClick={resetSource} disabled={uploading}>
                {t('image.field.change')}
              </Button>
            ) : undefined
          }
        />
      </Modal.Content>
    </Modal.Root>
  );
};

export { ImageFieldModal };
