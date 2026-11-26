import { useEffect, useState, type ReactNode } from 'react';
import { useIntl } from 'react-intl';
import { Box, Button, Flex, Modal, Typography } from '@strapi/design-system';
import { getTranslation } from '../../core/utils/getTranslation';
import { warningOrder } from '../../core/utils/imageCrop';
import type { CropZoomState } from './CropZoomStep';

type Warning = 'mustCover' | 'deformed' | 'upscale';

type Props = {
  /** The crop step's state, or null while no image is being cropped (no warnings). */
  crop: CropZoomState | null;
  cancelLabel: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
  canConfirm: boolean;
  loading?: boolean;
  /** Shown next to Cancel (e.g. "Choose another image"). */
  extraAction?: ReactNode;
};

/**
 * The upload modal's footer. The crop warnings live here so they never change the modal's height
 * (which would move the image under the pointer while dragging). Only the latest active warning is
 * shown, between the buttons; when it is resolved the previous one (if still active) comes back.
 * "The image must fill the crop area" keeps Confirm disabled (the caller's `canConfirm`).
 */
const CropFooter = ({
  crop,
  cancelLabel,
  confirmLabel,
  onCancel,
  onConfirm,
  canConfirm,
  loading = false,
  extraAction,
}: Props) => {
  const { formatMessage } = useIntl();
  const t = (id: string) => formatMessage({ id: getTranslation(id) });

  const mustCover = !!crop && !crop.covers;
  const deformed = !!crop && crop.deformed;
  const upscale = !!crop && crop.upscale;

  const [order, setOrder] = useState<Warning[]>([]);
  useEffect(() => {
    // Listed last so that, when several appear at once, the blocking one is the one shown.
    setOrder((previous) => warningOrder(previous, { deformed, upscale, mustCover }));
  }, [mustCover, deformed, upscale]);

  const latest = order[order.length - 1];

  return (
    // The design-system footer grows (flex: 1); in a full-screen modal it must keep its own height.
    <Modal.Footer style={{ flex: '0 0 auto' }}>
      <Flex gap={2} shrink={0}>
        <Button variant="tertiary" onClick={onCancel} disabled={loading}>
          {cancelLabel}
        </Button>
        {extraAction}
      </Flex>
      {latest && (
        <Box paddingLeft={4} paddingRight={4} style={{ flex: 1, minWidth: 0 }}>
          <Typography
            variant="pi"
            // Blocking (must fill the frame) in red; the others are warnings.
            textColor={latest === 'mustCover' ? 'danger600' : 'warning600'}
            role={latest === 'mustCover' ? 'alert' : 'status'}
            style={{
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              textAlign: 'center',
            }}
          >
            {t(`image.crop.${latest}`)}
          </Typography>
        </Box>
      )}
      <Button variant="secondary" onClick={onConfirm} loading={loading} disabled={!canConfirm}>
        {confirmLabel}
      </Button>
    </Modal.Footer>
  );
};

export { CropFooter };
