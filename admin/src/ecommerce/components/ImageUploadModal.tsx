import { useEffect, useRef, useState } from 'react';
import { useIntl } from 'react-intl';
import { Button, Flex, Loader, Modal, Typography } from '@strapi/design-system';
import { getTranslation } from '../../core/utils/getTranslation';
import UploadProductImage from '../usecases/uploadProductImage';
import { ImageDropzone } from './ImageDropzone';
import { CropZoomStep, type CropZoomState } from '../../components/image/CropZoomStep';
import { CropFooter } from '../../components/image/CropFooter';
import { CROP_BODY, FULL_SCREEN_MODAL } from '../../components/image/fullScreen';
import { startSize, type Size } from '../../core/utils/imageCrop';
import {
  MAX_IMAGE_BYTES,
  buildUploadForm,
  imageErrorCode,
  type ImageOwner,
} from '../utils/imageUpload';
import type { ImageRecord } from '../types';

type Props = {
  owner: ImageOwner;
  onClose: () => void;
  onUploaded: (image: ImageRecord) => void;
};

const EMPTY_CROP: CropZoomState = {
  transform: null,
  covers: true,
  upscale: false,
  deformed: false,
};

/** Mount it only while open: the object URL of the chosen file is revoked on unmount. */
const ImageUploadModal = ({ owner, onClose, onUploaded }: Props) => {
  const { formatMessage } = useIntl();
  const t = (id: string, values?: Record<string, any>) =>
    formatMessage({ id: getTranslation(id) }, values);

  /** The file being probed; a slower probe of an earlier pick is ignored. */
  const pending = useRef<File | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [natural, setNatural] = useState<Size | null>(null);
  const [size, setSize] = useState<Size>({ width: 1, height: 1 });
  const [cropState, setCropState] = useState<CropZoomState>(EMPTY_CROP);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(
    () => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl]
  );
  useEffect(
    () => () => {
      pending.current = null;
    },
    []
  );

  const resetFile = () => {
    setFile(null);
    setPreviewUrl(null);
    setNatural(null);
    setCropState(EMPTY_CROP);
  };

  const chooseFile = (chosen: File | undefined) => {
    setError(null);
    resetFile();
    pending.current = chosen ?? null;
    if (!chosen) return;
    if (chosen.size > MAX_IMAGE_BYTES) {
      setError(t('ecommerce.image.upload.tooLarge'));
      return;
    }
    const url = URL.createObjectURL(chosen);
    const probe = new Image();
    probe.onload = () => {
      if (pending.current !== chosen) {
        URL.revokeObjectURL(url);
        return;
      }
      const dimensions = { width: probe.naturalWidth, height: probe.naturalHeight };
      setFile(chosen);
      setPreviewUrl(url);
      setNatural(dimensions);
      setSize(startSize(dimensions, {}));
    };
    probe.onerror = () => {
      URL.revokeObjectURL(url);
      if (pending.current !== chosen) return;
      setError(t('ecommerce.image.upload.invalidImage'));
    };
    probe.src = url;
  };

  const { transform, covers } = cropState;
  const canUpload = !!file && !!natural && !!transform && covers;

  const upload = async () => {
    if (!canUpload || !file || !transform || uploading) return;
    setUploading(true);
    setError(null);
    try {
      const image = await new UploadProductImage().execute(buildUploadForm(file, transform, owner));
      onUploaded(image);
    } catch (err) {
      setError(
        imageErrorCode(err) === 'INVALID_IMAGE'
          ? t('ecommerce.image.upload.invalidImage')
          : t('ecommerce.image.upload.error')
      );
      setUploading(false);
    }
  };

  const cropping = !!(file && natural && previewUrl);

  /** Upload progress and errors, below the editor or the dropzone. */
  const status = (
    <>
      {uploading && (
        <Flex gap={2} alignItems="center" role="status">
          <Loader small />
          <Typography variant="omega">{t('ecommerce.image.upload.uploading')}</Typography>
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
      <Modal.Content style={cropping ? FULL_SCREEN_MODAL : undefined}>
        <Modal.Header>
          <Modal.Title>{t('ecommerce.image.upload.title')}</Modal.Title>
        </Modal.Header>
        {cropping && file && natural && previewUrl ? (
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
              src={previewUrl}
              natural={natural}
              size={size}
              sizeLocked={false}
              onSizeChange={setSize}
              onChange={setCropState}
              disabled={uploading}
              fill
              info={t('ecommerce.image.upload.original', {
                width: natural.width,
                height: natural.height,
              })}
            />
            {status}
          </Flex>
        ) : (
          <Modal.Body>
            <Flex direction="column" alignItems="stretch" gap={4}>
              <ImageDropzone onFile={chooseFile} disabled={uploading} />
              {status}
            </Flex>
          </Modal.Body>
        )}
        <CropFooter
          crop={file && natural ? cropState : null}
          cancelLabel={t('ecommerce.image.upload.cancel')}
          confirmLabel={t('ecommerce.image.upload.submit')}
          onCancel={onClose}
          onConfirm={upload}
          canConfirm={canUpload && !uploading}
          loading={uploading}
          extraAction={
            cropping ? (
              <Button variant="tertiary" onClick={resetFile} disabled={uploading}>
                {t('ecommerce.image.upload.change')}
              </Button>
            ) : undefined
          }
        />
      </Modal.Content>
    </Modal.Root>
  );
};

export { ImageUploadModal };
