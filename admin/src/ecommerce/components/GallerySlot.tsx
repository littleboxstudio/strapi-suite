import { Box, Flex } from '@strapi/design-system';
import type { ImageRecord } from '../types';

export type GallerySlotProps = {
  /** Exactly one owner: the product or one of its saved variants. */
  owner: { productId: number } | { variantId: number };
  images: ImageRecord[];
  onChange?: (images: ImageRecord[]) => void;
};

const THUMBNAIL_SIZE = 72;

/**
 * PLACEHOLDER — Task 12 replaces this with the real `Gallery` (upload, crop/resize, delete).
 * For now it only shows the images the owner already has.
 */
const GallerySlot = ({ images }: GallerySlotProps) => (
  <Flex gap={2} wrap="wrap" data-gallery-placeholder>
    {images.map((image) => (
      <Box key={image.id} hasRadius overflow="hidden" background="neutral150">
        <img
          src={image.url}
          alt={image.name}
          width={THUMBNAIL_SIZE}
          height={THUMBNAIL_SIZE}
          style={{ objectFit: 'cover', display: 'block' }}
        />
      </Box>
    ))}
  </Flex>
);

export { GallerySlot };
