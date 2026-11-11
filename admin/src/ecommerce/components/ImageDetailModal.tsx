import { useState } from 'react';
import { useIntl } from 'react-intl';
import { Button, Flex, Modal, Typography } from '@strapi/design-system';
import { Trash } from '@strapi/icons';
import ConfirmModal from '../../components/ConfirmModal';
import { getTranslation } from '../../core/utils/getTranslation';
import DeleteProductImage from '../usecases/deleteProductImage';
import { formatBytes } from '../utils/imageUpload';
import type { ImageRecord } from '../types';

type Props = {
  image: ImageRecord;
  onClose: () => void;
  onDeleted: (id: number) => void;
};

const PREVIEW_MAX_HEIGHT = 360;

const ImageDetailModal = ({ image, onClose, onDeleted }: Props) => {
  const { formatMessage } = useIntl();
  const t = (id: string, values?: Record<string, any>) =>
    formatMessage({ id: getTranslation(id) }, values);

  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remove = async () => {
    setConfirming(false);
    setDeleting(true);
    setError(null);
    try {
      await new DeleteProductImage().execute(image.id);
      onDeleted(image.id);
    } catch {
      setError(t('ecommerce.image.detail.deleteError'));
      setDeleting(false);
    }
  };

  return (
    <>
      <Modal.Root open onOpenChange={(next: boolean) => !next && !deleting && onClose()}>
        <Modal.Content>
          <Modal.Header>
            <Modal.Title>{t('ecommerce.image.detail.title')}</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <Flex direction="column" alignItems="stretch" gap={4}>
              <Flex justifyContent="center" background="neutral100" hasRadius padding={2}>
                <img
                  src={image.url}
                  alt={image.name}
                  style={{ maxWidth: '100%', maxHeight: PREVIEW_MAX_HEIGHT, display: 'block' }}
                />
              </Flex>
              <Flex direction="column" alignItems="flex-start" gap={1}>
                <Typography variant="omega" fontWeight="bold" ellipsis style={{ maxWidth: '100%' }}>
                  {image.name}
                </Typography>
                <Typography variant="pi" textColor="neutral600">
                  {`${image.width} × ${image.height} px · ${formatBytes(image.sizeBytes)}`}
                </Typography>
              </Flex>
              {error && (
                <Typography variant="omega" textColor="danger600" role="alert">
                  {error}
                </Typography>
              )}
            </Flex>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="tertiary" onClick={onClose} disabled={deleting}>
              {t('ecommerce.image.detail.close')}
            </Button>
            <Button
              variant="danger-light"
              startIcon={<Trash />}
              onClick={() => setConfirming(true)}
              loading={deleting}
              disabled={deleting}
            >
              {t('ecommerce.image.detail.delete')}
            </Button>
          </Modal.Footer>
        </Modal.Content>
      </Modal.Root>
      <ConfirmModal
        open={confirming}
        title={t('ecommerce.image.detail.confirmTitle')}
        text={t('ecommerce.image.detail.confirmText')}
        confirm={{ button: t('ecommerce.image.detail.delete'), action: remove }}
        cancel={{ button: t('ecommerce.image.detail.cancel'), action: () => setConfirming(false) }}
      />
    </>
  );
};

export { ImageDetailModal };
