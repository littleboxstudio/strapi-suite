import { useEffect, useRef, useState } from 'react';
import { useIntl } from 'react-intl';
import Cropper, { type Area } from 'react-easy-crop';
import {
  Box,
  Button,
  Field,
  Flex,
  IconButton,
  Loader,
  Modal,
  Tabs,
  TextInput,
  Typography,
} from '@strapi/design-system';
import { Link } from '@strapi/icons';
import { getTranslation } from '../../core/utils/getTranslation';
import UploadProductImage from '../usecases/uploadProductImage';
import { ImageDropzone } from './ImageDropzone';
import { lockedHeight, toPixelCrop } from '../utils/cropMath';
import {
  MAX_IMAGE_BYTES,
  MAX_IMAGE_DIMENSION,
  buildUploadForm,
  imageErrorCode,
  isValidDimension,
  parseDimension,
  type ImageOwner,
  type ImageTransform,
} from '../utils/imageUpload';
import type { ImageRecord } from '../types';

type Mode = 'crop' | 'resize';
type Size = { width: number; height: number };

type Props = {
  owner: ImageOwner;
  onClose: () => void;
  onUploaded: (image: ImageRecord) => void;
};

const CROP_AREA_HEIGHT = 320;

/** Fits the original into the allowed range, keeping its proportion. */
const initialSize = (natural: Size): Size => {
  const ratio = natural.width / natural.height;
  const width = Math.min(natural.width, MAX_IMAGE_DIMENSION);
  const height = Math.max(1, Math.min(lockedHeight(width, ratio), MAX_IMAGE_DIMENSION));
  return { width, height };
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
  const [mode, setMode] = useState<Mode>('crop');
  const [widthText, setWidthText] = useState('');
  const [heightText, setHeightText] = useState('');
  const [locked, setLocked] = useState(true);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [cropArea, setCropArea] = useState<Area | null>(null);
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

  const width = parseDimension(widthText);
  const height = parseDimension(heightText);
  const widthValid = isValidDimension(width);
  const heightValid = isValidDimension(height);
  const ratio = natural ? natural.width / natural.height : 1;
  const aspect = widthValid && heightValid ? width / height : ratio;

  const resetFile = () => {
    setFile(null);
    setPreviewUrl(null);
    setNatural(null);
    setCropArea(null);
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
      const size = { width: probe.naturalWidth, height: probe.naturalHeight };
      const start = initialSize(size);
      setFile(chosen);
      setPreviewUrl(url);
      setNatural(size);
      setWidthText(String(start.width));
      setHeightText(String(start.height));
      setCrop({ x: 0, y: 0 });
      setZoom(1);
    };
    probe.onerror = () => {
      URL.revokeObjectURL(url);
      if (pending.current !== chosen) return;
      setError(t('ecommerce.image.upload.invalidImage'));
    };
    probe.src = url;
  };

  const changeWidth = (value: string) => {
    setWidthText(value);
    const next = parseDimension(value);
    if (mode === 'resize' && locked && isValidDimension(next)) {
      setHeightText(String(Math.max(1, lockedHeight(next, ratio))));
    }
  };

  const changeHeight = (value: string) => {
    setHeightText(value);
    const next = parseDimension(value);
    if (mode === 'resize' && locked && isValidDimension(next)) {
      setWidthText(String(Math.max(1, lockedHeight(next, 1 / ratio))));
    }
  };

  const changeMode = (next: Mode) => {
    setMode(next);
    if (next === 'resize' && locked && widthValid) {
      setHeightText(String(Math.max(1, lockedHeight(width, ratio))));
    }
  };

  const toggleLock = () => {
    const next = !locked;
    setLocked(next);
    if (next && widthValid) setHeightText(String(Math.max(1, lockedHeight(width, ratio))));
  };

  const canUpload =
    !!file && !!natural && widthValid && heightValid && (mode === 'resize' || !!cropArea);

  const upload = async () => {
    if (!canUpload || !file || !natural || uploading) return;
    const transform: ImageTransform =
      mode === 'crop'
        ? { mode, width, height, crop: toPixelCrop(cropArea as Area, natural) }
        : { mode, width, height };
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

  const dimensionError = (valid: boolean, text: string) =>
    !valid && text !== '' ? t('ecommerce.image.upload.dimensionError') : undefined;

  const dimensions = (
    <Flex gap={2} alignItems="flex-end">
      <Box style={{ flex: 1 }}>
        <Field.Root name="width" required error={dimensionError(widthValid, widthText)}>
          <Field.Label>{t('ecommerce.image.upload.width')}</Field.Label>
          <TextInput
            inputMode="numeric"
            value={widthText}
            disabled={uploading}
            onChange={(e: any) => changeWidth(e.target.value)}
          />
          <Field.Error />
        </Field.Root>
      </Box>
      <Box paddingBottom={2}>
        <Typography textColor="neutral600">×</Typography>
      </Box>
      <Box style={{ flex: 1 }}>
        <Field.Root name="height" required error={dimensionError(heightValid, heightText)}>
          <Field.Label>{t('ecommerce.image.upload.height')}</Field.Label>
          <TextInput
            inputMode="numeric"
            value={heightText}
            disabled={uploading}
            onChange={(e: any) => changeHeight(e.target.value)}
          />
          <Field.Error />
        </Field.Root>
      </Box>
      {mode === 'resize' && (
        <IconButton
          label={t(locked ? 'ecommerce.image.upload.unlock' : 'ecommerce.image.upload.lock')}
          variant={locked ? 'secondary' : 'tertiary'}
          aria-pressed={locked}
          disabled={uploading}
          onClick={toggleLock}
        >
          <Link />
        </IconButton>
      )}
    </Flex>
  );

  return (
    <Modal.Root open onOpenChange={(next: boolean) => !next && !uploading && onClose()}>
      <Modal.Content>
        <Modal.Header>
          <Modal.Title>{t('ecommerce.image.upload.title')}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Flex direction="column" alignItems="stretch" gap={4}>
            {!(file && natural && previewUrl) && (
              <ImageDropzone onFile={chooseFile} disabled={uploading} />
            )}

            {file && natural && previewUrl && (
              <>
                <Flex justifyContent="space-between" alignItems="center" gap={4} wrap="wrap">
                  <Typography variant="pi" textColor="neutral600">
                    {t('ecommerce.image.upload.original', {
                      width: natural.width,
                      height: natural.height,
                    })}
                  </Typography>
                  <Button variant="tertiary" size="S" onClick={resetFile} disabled={uploading}>
                    {t('ecommerce.image.upload.change')}
                  </Button>
                </Flex>
                <Tabs.Root
                  variant="simple"
                  value={mode}
                  onValueChange={(value: string) => changeMode(value as Mode)}
                >
                  <Tabs.List aria-label={t('ecommerce.image.upload.mode')}>
                    <Tabs.Trigger value="crop" disabled={uploading}>
                      {t('ecommerce.image.upload.crop')}
                    </Tabs.Trigger>
                    <Tabs.Trigger value="resize" disabled={uploading}>
                      {t('ecommerce.image.upload.resize')}
                    </Tabs.Trigger>
                  </Tabs.List>
                  <Tabs.Content value="crop">
                    <Flex direction="column" alignItems="stretch" gap={4} paddingTop={4}>
                      {dimensions}
                      <Box
                        position="relative"
                        hasRadius
                        overflow="hidden"
                        background="neutral800"
                        style={{ height: CROP_AREA_HEIGHT }}
                      >
                        <Cropper
                          image={previewUrl}
                          crop={crop}
                          zoom={zoom}
                          aspect={aspect}
                          onCropChange={setCrop}
                          onZoomChange={setZoom}
                          onCropComplete={(area: Area) => setCropArea(area)}
                        />
                      </Box>
                      <Typography variant="pi" textColor="neutral600">
                        {t('ecommerce.image.upload.cropHint')}
                      </Typography>
                    </Flex>
                  </Tabs.Content>
                  <Tabs.Content value="resize">
                    <Flex direction="column" alignItems="stretch" gap={4} paddingTop={4}>
                      {dimensions}
                      <Flex justifyContent="center" background="neutral100" hasRadius padding={2}>
                        <img
                          src={previewUrl}
                          alt={file.name}
                          style={{ maxWidth: '100%', maxHeight: CROP_AREA_HEIGHT, display: 'block' }}
                        />
                      </Flex>
                    </Flex>
                  </Tabs.Content>
                </Tabs.Root>
              </>
            )}

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
          </Flex>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="tertiary" onClick={onClose} disabled={uploading}>
            {t('ecommerce.image.upload.cancel')}
          </Button>
          <Button onClick={upload} loading={uploading} disabled={!canUpload || uploading}>
            {t('ecommerce.image.upload.submit')}
          </Button>
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
};

export { ImageUploadModal };
