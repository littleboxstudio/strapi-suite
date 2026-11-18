import { useState, type DragEvent } from 'react';
import { useIntl } from 'react-intl';
import { Box, Flex, Typography } from '@strapi/design-system';
import { Plus } from '@strapi/icons';
import { getTranslation } from '../../core/utils/getTranslation';
import ReorderProductImages from '../usecases/reorderProductImages';
import { moveImage, sameOrder, withCover, withoutImage } from '../utils/gallery';
import { ImageUploadModal } from './ImageUploadModal';
import { ImageDetailModal } from './ImageDetailModal';
import { ToneBadge } from './orders/StatusBadges';
import type { ImageOwner } from '../utils/imageUpload';
import type { ImageRecord } from '../types';

type Props = {
  /** Exactly one of them: the product or one of its saved variants. */
  owner: ImageOwner;
  images: ImageRecord[];
  onChange: (images: ImageRecord[]) => void;
};

const TILE_SIZE = 96;

const tileStyle = {
  width: TILE_SIZE,
  height: TILE_SIZE,
  padding: 0,
  cursor: 'pointer',
} as const;

/**
 * A product's or variant's gallery: the images in their order, the cover badged. Dragging a tile
 * onto another moves it there and saves the order at once; clicking opens the image (Set as cover,
 * Delete).
 */
const Gallery = ({ owner, images, onChange }: Props) => {
  const { formatMessage } = useIntl();
  const t = (id: string, values?: Record<string, any>) =>
    formatMessage({ id: getTranslation(id) }, values);

  const [uploading, setUploading] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const selected = images.find((image) => image.id === selectedId) ?? null;
  // While dragging: the dragged image and the order shown (committed on drop).
  const [dragId, setDragId] = useState<number | null>(null);
  const [preview, setPreview] = useState<ImageRecord[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shown = preview ?? images;

  const endDrag = () => {
    setDragId(null);
    setPreview(null);
  };

  const save = async (next: ImageRecord[]) => {
    const previous = images;
    onChange(next);
    setSaving(true);
    setError(null);
    try {
      const { coverId } = await new ReorderProductImages().execute(
        owner,
        next.map((i) => i.id)
      );
      onChange(withCover(next, coverId));
    } catch {
      onChange(previous);
      setError(t('ecommerce.image.reorderError'));
    } finally {
      setSaving(false);
    }
  };

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
    setPreview(moveImage(base, dragId, base.findIndex((i) => i.id === overId)));
  };

  const onDrop = (e: DragEvent) => {
    if (dragId === null) return;
    e.preventDefault();
    const next = preview;
    endDrag();
    if (next && !sameOrder(next, images)) void save(next);
  };

  const canDrag = images.length > 1 && !saving;

  return (
    <>
      <Flex gap={2} wrap="wrap">
        {shown.map((image) => (
          <Box
            key={image.id}
            tag="button"
            type="button"
            position="relative"
            hasRadius
            overflow="hidden"
            background="neutral150"
            borderColor={image.id === dragId ? 'primary600' : 'neutral200'}
            aria-label={image.name}
            title={image.name}
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
              src={image.url}
              alt=""
              width={TILE_SIZE}
              height={TILE_SIZE}
              draggable={false}
              style={{ objectFit: 'cover', display: 'block' }}
            />
            {image.cover && (
              <Box position="absolute" top={1} left={1}>
                <ToneBadge variant="primary">{t('ecommerce.image.cover')}</ToneBadge>
              </Box>
            )}
          </Box>
        ))}
        <Box
          tag="button"
          type="button"
          hasRadius
          background="neutral100"
          borderColor="neutral300"
          borderStyle="dashed"
          aria-label={t('ecommerce.image.add')}
          title={t('ecommerce.image.add')}
          onClick={() => setUploading(true)}
          style={tileStyle}
        >
          <Flex justifyContent="center" alignItems="center" height="100%">
            <Plus fill="neutral600" width="2rem" height="2rem" />
          </Flex>
        </Box>
      </Flex>
      {images.length === 0 && (
        <Typography variant="pi" textColor="neutral500">
          {t('ecommerce.image.empty')}
        </Typography>
      )}
      {images.length > 1 && (
        <Typography variant="pi" textColor="neutral600">
          {t('ecommerce.image.reorderHint')}
        </Typography>
      )}
      {error && (
        <Typography variant="pi" textColor="danger600" role="alert">
          {error}
        </Typography>
      )}

      {uploading && (
        <ImageUploadModal
          owner={owner}
          onClose={() => setUploading(false)}
          onUploaded={(image) => {
            onChange([...images, image]);
            setUploading(false);
          }}
        />
      )}

      {selected && (
        <ImageDetailModal
          image={selected}
          onClose={() => setSelectedId(null)}
          onCoverSet={(id) => {
            onChange(withCover(images, id));
            setSelectedId(null);
          }}
          onDeleted={(id) => {
            onChange(withoutImage(images, id));
            setSelectedId(null);
          }}
        />
      )}
    </>
  );
};

export { Gallery };
