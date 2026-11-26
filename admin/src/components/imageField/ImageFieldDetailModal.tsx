import { useState } from 'react';
import { useIntl } from 'react-intl';
import { Button, Field, Flex, Modal, TextInput, Typography } from '@strapi/design-system';
import { getTranslation } from '../../core/utils/getTranslation';
import { formatBytes } from '../../ecommerce/utils/imageUpload';
import type { MediaValue } from './imageFieldValue';
import { useImageFieldApi } from './useImageFieldApi';
import { mediaSrc } from './backendUrl';

type Props = {
  image: MediaValue;
  /** Read-only: no alt text edit, no Remove. */
  disabled?: boolean;
  onClose: () => void;
  /** The image with its new alt text (already saved on the Media Library file). */
  onAltSaved: (image: MediaValue) => void;
  /** Takes the image out of the field (the file is cleaned up once the entry is saved). */
  onRemove: () => void;
};

const PREVIEW_MAX_HEIGHT = 360;

/** One image of the field: preview, size, alt text (saved on the file) and Remove. */
const ImageFieldDetailModal = ({
  image,
  disabled = false,
  onClose,
  onAltSaved,
  onRemove,
}: Props) => {
  const { formatMessage } = useIntl();
  const t = (id: string, values?: Record<string, any>) =>
    formatMessage({ id: getTranslation(id) }, values);
  const api = useImageFieldApi();

  const initialAlt = image.alternativeText ?? '';
  const [alt, setAlt] = useState(initialAlt);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const altChanged = alt.trim() !== initialAlt.trim();

  const saveAlt = async () => {
    if (!altChanged || saving) return;
    setSaving(true);
    setError(null);
    try {
      const trimmed = alt.trim();
      const updated = await api.updateAlt(image.id, trimmed === '' ? null : trimmed);
      onAltSaved(updated);
    } catch {
      setError(t('image.field.alt.error'));
      setSaving(false);
    }
  };

  const details = [
    image.width && image.height ? `${image.width} × ${image.height} px` : null,
    typeof image.size === 'number' ? formatBytes(image.size * 1024) : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Modal.Root open onOpenChange={(next: boolean) => !next && !saving && onClose()}>
      <Modal.Content>
        <Modal.Header>
          <Modal.Title>{t('image.field.detail.title')}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Flex direction="column" alignItems="stretch" gap={4}>
            <Flex justifyContent="center" background="neutral100" hasRadius padding={2}>
              <img
                src={mediaSrc(image.url) ?? undefined}
                alt={image.alternativeText ?? ''}
                style={{ maxWidth: '100%', maxHeight: PREVIEW_MAX_HEIGHT, display: 'block' }}
              />
            </Flex>
            <Flex direction="column" alignItems="flex-start" gap={1}>
              <Typography variant="omega" fontWeight="bold" ellipsis style={{ maxWidth: '100%' }}>
                {image.name}
              </Typography>
              {details && (
                <Typography variant="pi" textColor="neutral600">
                  {details}
                </Typography>
              )}
            </Flex>
            <Field.Root name="alternativeText" hint={t('image.field.alt.hint')}>
              <Field.Label>{t('image.field.alt.label')}</Field.Label>
              <TextInput
                value={alt}
                disabled={saving}
                readOnly={disabled}
                style={{ height: 38 }}
                onChange={(e: any) => setAlt(e.target.value)}
                onKeyDown={(e: any) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void saveAlt();
                  }
                }}
              />
              <Field.Hint />
            </Field.Root>
            {error && (
              <Typography variant="omega" textColor="danger600" role="alert">
                {error}
              </Typography>
            )}
          </Flex>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="tertiary" onClick={onClose} disabled={saving}>
            {t('image.field.detail.close')}
          </Button>
          {!disabled && (
            <Flex gap={2}>
              <Button variant="danger-light" onClick={onRemove} disabled={saving}>
                {t('image.field.remove')}
              </Button>
              <Button
                variant="secondary"
                onClick={saveAlt}
                loading={saving}
                disabled={!altChanged || saving}
              >
                {t('image.field.alt.save')}
              </Button>
            </Flex>
          )}
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
};

export { ImageFieldDetailModal };
