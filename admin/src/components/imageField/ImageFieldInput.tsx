import { forwardRef, useState, type DragEvent, type ReactNode } from 'react';
import { useIntl } from 'react-intl';
import { Box, Button, Field, Flex, Typography } from '@strapi/design-system';
import { Pencil, Plus, Trash, ArrowClockwise } from '@strapi/icons';
import { getTranslation } from '../../core/utils/getTranslation';
import {
  addImage,
  canAdd,
  fieldConfig,
  moveImage,
  removeImage,
  replaceImage,
  sameOrder,
  thumbnailUrl,
  toGallery,
  toSingle,
  type ImageFieldOptions,
  type MediaValue,
} from './imageFieldValue';
import { ImageFieldModal } from './ImageFieldModal';
import { ImageFieldDetailModal } from './ImageFieldDetailModal';
import { mediaSrc } from './backendUrl';

/** The props Strapi 5 passes to a custom field's Input (field props + `useField`). */
type Props = {
  name: string;
  value?: unknown;
  onChange: (eventOrPath: any, value?: any) => void;
  attribute?: { options?: ImageFieldOptions; required?: boolean };
  label?: ReactNode;
  labelAction?: ReactNode;
  hint?: ReactNode;
  error?: string;
  required?: boolean;
  disabled?: boolean;
};

const TILE_SIZE = 96;
const SINGLE_PREVIEW = 160;

const tileStyle = { width: TILE_SIZE, height: TILE_SIZE, padding: 0 } as const;

/**
 * The `ltbimage` field in the edit view: one image (empty box, or preview with Replace / Edit alt
 * text / Remove) or a gallery (thumbnails reordered by dragging, Add image up to the maximum).
 * The value is the Media Library file's snapshot; empty is null.
 */
const ImageFieldInput = forwardRef<HTMLDivElement, Props>(
  (
    {
      name,
      value,
      onChange,
      attribute,
      label,
      labelAction,
      hint,
      error,
      required = false,
      disabled = false,
    },
    ref
  ) => {
    const { formatMessage } = useIntl();
    const t = (id: string, values?: Record<string, any>) =>
      formatMessage({ id: getTranslation(id) }, values);

    const config = fieldConfig(attribute?.options);
    const gallery = config.mode === 'gallery';
    const images = gallery ? toGallery(value) : [];
    const single = gallery ? null : toSingle(value);

    /** The modal adds (gallery / empty single) or replaces the single image. */
    const [picking, setPicking] = useState(false);
    const [selectedId, setSelectedId] = useState<number | null>(null);
    const [dragId, setDragId] = useState<number | null>(null);
    const [preview, setPreview] = useState<MediaValue[] | null>(null);

    const all = gallery ? images : single ? [single] : [];
    const selected = all.find((i) => i.id === selectedId) ?? null;
    const shown = preview ?? images;

    const set = (next: MediaValue | MediaValue[] | null) =>
      onChange(name, Array.isArray(next) && next.length === 0 ? null : next);

    const uploaded = (image: MediaValue) => {
      setPicking(false);
      set(gallery ? addImage(images, image, config.maxImages) : image);
    };

    const altSaved = (image: MediaValue) => {
      setSelectedId(null);
      set(gallery ? replaceImage(images, image.id, image) : image);
    };

    const remove = (id: number) => {
      setSelectedId(null);
      set(gallery ? removeImage(images, id) : null);
    };

    const endDrag = () => {
      setDragId(null);
      setPreview(null);
    };
    const canDrag = !disabled && images.length > 1;
    const onDragStart = (e: DragEvent, id: number) => {
      e.dataTransfer.effectAllowed = 'move';
      // Firefox starts a drag only with some data set.
      e.dataTransfer.setData('text/plain', String(id));
      setDragId(id);
      setPreview(images);
    };
    const onDragOver = (e: DragEvent, overId: number) => {
      if (dragId === null) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (overId === dragId) return;
      const base = preview ?? images;
      setPreview(
        moveImage(
          base,
          dragId,
          base.findIndex((i) => i.id === overId)
        )
      );
    };
    const onDrop = (e: DragEvent) => {
      if (dragId === null) return;
      e.preventDefault();
      const next = preview;
      endDrag();
      if (next && !sameOrder(next, images)) set(next);
    };

    const addBox = (big: boolean) => (
      <Box
        tag="button"
        type="button"
        hasRadius
        background="neutral100"
        borderColor="neutral300"
        borderStyle="dashed"
        aria-label={t('image.field.add')}
        title={t('image.field.add')}
        onClick={() => setPicking(true)}
        style={
          big
            ? { width: '100%', padding: 24, cursor: 'pointer' }
            : { ...tileStyle, cursor: 'pointer' }
        }
      >
        <Flex direction="column" justifyContent="center" alignItems="center" gap={2} height="100%">
          <Plus fill="neutral600" width="2rem" height="2rem" />
          {big && (
            <Typography variant="omega" textColor="neutral600">
              {t('image.field.add')}
            </Typography>
          )}
        </Flex>
      </Box>
    );

    const renderSingle = () => {
      if (!single) {
        return disabled ? (
          <Typography variant="pi" textColor="neutral500">
            {t('image.field.empty')}
          </Typography>
        ) : (
          addBox(true)
        );
      }
      return (
        <Flex gap={4} alignItems="flex-start" wrap="wrap">
          <Box
            tag="button"
            type="button"
            hasRadius
            overflow="hidden"
            background="neutral150"
            borderColor="neutral200"
            aria-label={single.name ?? t('image.field.detail.title')}
            title={single.name ?? undefined}
            onClick={() => setSelectedId(single.id)}
            style={{ padding: 0, cursor: 'pointer', lineHeight: 0 }}
          >
            <img
              src={mediaSrc(thumbnailUrl(single)) ?? undefined}
              alt={single.alternativeText ?? ''}
              style={{
                maxWidth: SINGLE_PREVIEW,
                maxHeight: SINGLE_PREVIEW,
                display: 'block',
                objectFit: 'contain',
              }}
            />
          </Box>
          <Flex direction="column" alignItems="flex-start" gap={2} style={{ minWidth: 0, flex: 1 }}>
            <Typography variant="omega" fontWeight="semiBold" ellipsis style={{ maxWidth: '100%' }}>
              {single.name}
            </Typography>
            {single.width && single.height ? (
              <Typography variant="pi" textColor="neutral600">
                {`${single.width} × ${single.height} px`}
              </Typography>
            ) : null}
            {single.alternativeText ? (
              <Typography variant="pi" textColor="neutral600" ellipsis style={{ maxWidth: '100%' }}>
                {t('image.field.alt.current', { alt: single.alternativeText })}
              </Typography>
            ) : null}
            {!disabled && (
              <Flex gap={2} wrap="wrap">
                <Button
                  size="S"
                  variant="tertiary"
                  startIcon={<ArrowClockwise />}
                  onClick={() => setPicking(true)}
                >
                  {t('image.field.replace')}
                </Button>
                <Button
                  size="S"
                  variant="tertiary"
                  startIcon={<Pencil />}
                  onClick={() => setSelectedId(single.id)}
                >
                  {t('image.field.editAlt')}
                </Button>
                <Button
                  size="S"
                  variant="danger-light"
                  startIcon={<Trash />}
                  onClick={() => remove(single.id)}
                >
                  {t('image.field.remove')}
                </Button>
              </Flex>
            )}
          </Flex>
        </Flex>
      );
    };

    const renderGallery = () => {
      const full = !canAdd(images, config.maxImages);
      return (
        <Flex direction="column" alignItems="stretch" gap={2}>
          <Flex gap={2} wrap="wrap">
            {shown.map((image) => (
              <Box
                key={image.id}
                tag="button"
                type="button"
                hasRadius
                overflow="hidden"
                background="neutral150"
                borderColor={image.id === dragId ? 'primary600' : 'neutral200'}
                aria-label={image.name ?? t('image.field.detail.title')}
                title={image.name ?? undefined}
                draggable={canDrag}
                onDragStart={(e: DragEvent) => onDragStart(e, image.id)}
                onDragOver={(e: DragEvent) => onDragOver(e, image.id)}
                onDrop={onDrop}
                onDragEnd={endDrag}
                onClick={() => setSelectedId(image.id)}
                style={{
                  ...tileStyle,
                  cursor: canDrag ? 'grab' : 'pointer',
                  opacity: image.id === dragId ? 0.5 : 1,
                }}
              >
                <img
                  src={mediaSrc(thumbnailUrl(image)) ?? undefined}
                  alt=""
                  width={TILE_SIZE}
                  height={TILE_SIZE}
                  draggable={false}
                  style={{ objectFit: 'cover', display: 'block' }}
                />
              </Box>
            ))}
            {!disabled && !full && addBox(false)}
          </Flex>
          {images.length === 0 && (
            <Typography variant="pi" textColor="neutral500">
              {t('image.field.galleryEmpty')}
            </Typography>
          )}
          {canDrag && (
            <Typography variant="pi" textColor="neutral600">
              {t('image.field.reorderHint')}
            </Typography>
          )}
          {!disabled && full && config.maxImages !== null && (
            <Typography variant="pi" textColor="neutral600">
              {t('image.field.maxReached', { max: config.maxImages })}
            </Typography>
          )}
        </Flex>
      );
    };

    return (
      <Field.Root name={name} id={name} error={error} hint={hint} required={required} ref={ref}>
        <Flex direction="column" alignItems="stretch" gap={1}>
          <Field.Label action={labelAction}>{label}</Field.Label>
          {gallery ? renderGallery() : renderSingle()}
          <Field.Hint />
          <Field.Error />
        </Flex>

        {picking && !disabled && (
          <ImageFieldModal
            config={config}
            onClose={() => setPicking(false)}
            onUploaded={uploaded}
          />
        )}

        {selected && (
          <ImageFieldDetailModal
            image={selected}
            disabled={disabled}
            onClose={() => setSelectedId(null)}
            onAltSaved={altSaved}
            onRemove={() => remove(selected.id)}
          />
        )}
      </Field.Root>
    );
  }
);

export default ImageFieldInput;
