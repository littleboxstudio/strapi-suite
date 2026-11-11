import { useRef, useState, type DragEvent } from 'react';
import { useIntl } from 'react-intl';
import styled from 'styled-components';
import { Button, Flex, Typography } from '@strapi/design-system';
import { getTranslation } from '../../core/utils/getTranslation';
import ImageDrop from '../illustrations/ImageDrop';

type Props = {
  /** Called with the dropped or selected file (the caller validates it). */
  onFile: (file: File) => void;
  disabled?: boolean;
};

const Zone = styled.div<{ $active: boolean; $disabled: boolean }>`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 24px 16px;
  border: 2px dashed
    ${({ theme, $active }) => ($active ? theme.colors.primary600 : theme.colors.neutral300)};
  border-radius: ${({ theme }) => theme.borderRadius};
  background: ${({ theme, $active }) => ($active ? theme.colors.primary100 : theme.colors.neutral100)};
  opacity: ${({ $disabled }) => ($disabled ? 0.6 : 1)};
  text-align: center;
  transition: border-color 120ms ease, background 120ms ease;
`;

/** The dragged items include a file (not text or a link). */
const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes('Files');

/**
 * Dashed drop area for one image: drag a file onto it, or pick one with the button. Any image
 * format the browser can read is accepted; the caller checks size and readability.
 */
const ImageDropzone = ({ onFile, disabled = false }: Props) => {
  const { formatMessage } = useIntl();
  const t = (id: string) => formatMessage({ id: getTranslation(id) });
  const input = useRef<HTMLInputElement>(null);
  const [active, setActive] = useState(false);
  /** dragenter/dragleave also fire for children: count them so the highlight does not flicker. */
  const depth = useRef(0);

  const take = (files: FileList | null | undefined) => {
    const file = files?.[0];
    if (file) onFile(file);
  };

  return (
    <Zone
      $active={active}
      $disabled={disabled}
      onDragEnter={(e) => {
        if (disabled || !hasFiles(e)) return;
        e.preventDefault();
        depth.current += 1;
        setActive(true);
      }}
      onDragOver={(e) => {
        if (disabled || !hasFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDragLeave={() => {
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setActive(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        depth.current = 0;
        setActive(false);
        if (!disabled) take(e.dataTransfer?.files);
      }}
    >
      <ImageDrop size={112} />
      <Typography variant="omega" fontWeight="semiBold">
        {t('ecommerce.image.upload.drop')}
      </Typography>
      <Button variant="secondary" disabled={disabled} onClick={() => input.current?.click()}>
        {t('ecommerce.image.upload.select')}
      </Button>
      <Flex direction="column" gap={1}>
        <Typography variant="pi" textColor="neutral600">
          {t('ecommerce.image.upload.fileHint')}
        </Typography>
      </Flex>
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        disabled={disabled}
        onChange={(e) => {
          take(e.target.files);
          // Picking the same file again must fire onChange again.
          e.target.value = '';
        }}
      />
    </Zone>
  );
};

export { ImageDropzone };
