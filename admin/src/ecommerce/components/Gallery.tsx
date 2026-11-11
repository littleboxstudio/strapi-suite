import { useState } from 'react';
import { useIntl } from 'react-intl';
import { Box, Flex, Typography } from '@strapi/design-system';
import { Plus } from '@strapi/icons';
import { getTranslation } from '../../core/utils/getTranslation';
import { ImageUploadModal } from './ImageUploadModal';
import { ImageDetailModal } from './ImageDetailModal';
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

const Gallery = ({ owner, images, onChange }: Props) => {
  const { formatMessage } = useIntl();
  const t = (id: string, values?: Record<string, any>) =>
    formatMessage({ id: getTranslation(id) }, values);

  const [uploading, setUploading] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const selected = images.find((image) => image.id === selectedId) ?? null;

  return (
    <>
      <Flex gap={2} wrap="wrap">
        {images.map((image) => (
          <Box
            key={image.id}
            tag="button"
            type="button"
            hasRadius
            overflow="hidden"
            background="neutral150"
            borderColor="neutral200"
            aria-label={image.name}
            title={image.name}
            onClick={() => setSelectedId(image.id)}
            style={tileStyle}
          >
            <img
              src={image.url}
              alt=""
              width={TILE_SIZE}
              height={TILE_SIZE}
              style={{ objectFit: 'cover', display: 'block' }}
            />
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
          onDeleted={(id) => {
            onChange(images.filter((image) => image.id !== id));
            setSelectedId(null);
          }}
        />
      )}
    </>
  );
};

export { Gallery };
