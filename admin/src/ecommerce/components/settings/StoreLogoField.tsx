import { useRef, useState, type DragEvent } from 'react';
import { useIntl } from 'react-intl';
import styled from 'styled-components';
import { useNotification } from '@strapi/strapi/admin';
import { Box, Button, Field, Flex, Typography, VisuallyHidden } from '@strapi/design-system';
import ConfirmModal from '../../../components/ConfirmModal';
import { getTranslation } from '../../../core/utils/getTranslation';
import ImageDrop from '../../illustrations/ImageDrop';
import UploadStoreLogo from '../../usecases/settings/uploadStoreLogo';
import RemoveStoreLogo from '../../usecases/settings/removeStoreLogo';
import { LOGO_ACCEPT, buildLogoForm, logoFileError } from '../../utils/storeLogo';
import { extractErrorCode } from '../../utils/settingsForm';
import type { StoreSettings } from '../../settingsTypes';

/** 55px tall, width from the logo's proportions (never wider than the drop area). */
const Thumb = styled.img`
  height: 55px;
  width: auto;
  max-width: 100%;
  object-fit: contain;
`;

/** Dashed drop area: the logo (or an illustration), the instructions and the buttons. */
const Zone = styled.div<{ $active: boolean }>`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 24px 16px;
  border: 2px dashed
    ${({ theme, $active }) => ($active ? theme.colors.primary600 : theme.colors.neutral300)};
  border-radius: ${({ theme }) => theme.borderRadius};
  background: ${({ theme, $active }) => ($active ? theme.colors.primary100 : 'transparent')};
  text-align: center;
  transition:
    border-color 120ms ease,
    background 120ms ease;
`;

/** The dragged items include a file (not text or a link). */
const hasFiles = (event: DragEvent) =>
  Array.from(event.dataTransfer?.types ?? []).includes('Files');

type Props = {
  logo: StoreSettings['logo'];
  readOnly: boolean;
  onChange: (settings: StoreSettings) => void;
};

/** Logo upload: saves on its own (not with the form's Save), the server converts it to PNG. */
const StoreLogoField = ({ logo, readOnly, onChange }: Props) => {
  const { formatMessage } = useIntl();
  const { toggleNotification } = useNotification();
  const t = (id: string) => formatMessage({ id: getTranslation(`ecommerce.settings.${id}`) });
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [broken, setBroken] = useState(false);
  const [dragging, setDragging] = useState(false);
  /** dragenter/dragleave also fire for children: count them so the highlight does not flicker. */
  const depth = useRef(0);
  const canDrop = !readOnly && !busy;

  const fail = (code: string) =>
    toggleNotification({ type: 'danger', message: t(`store.logo.errors.${code}`) });

  const pick = async (file: File | undefined) => {
    if (input.current) input.current.value = '';
    if (!file || busy || readOnly) return;
    const problem = logoFileError(file);
    if (problem) return fail(problem);
    setBusy(true);
    try {
      const saved = await new UploadStoreLogo().execute(buildLogoForm(file));
      setBroken(false);
      onChange(saved);
      toggleNotification({ type: 'success', message: t('store.logo.uploaded') });
    } catch (err) {
      const code = extractErrorCode(err);
      if (code === 'INVALID_IMAGE' || code === 'UPLOAD_FAILED') fail(code);
      else toggleNotification({ type: 'danger', message: t('saveError') });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      const saved = await new RemoveStoreLogo().execute();
      onChange(saved);
      toggleNotification({ type: 'success', message: t('store.logo.removed') });
    } catch {
      toggleNotification({ type: 'danger', message: t('saveError') });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Field.Root name="logo" hint={t('store.logo.hint')}>
      {/* The section title shows it; kept for screen readers. */}
      <VisuallyHidden>
        <Field.Label>{t('store.logo')}</Field.Label>
      </VisuallyHidden>
      <Zone
        $active={dragging}
        onDragEnter={(e) => {
          if (!canDrop || !hasFiles(e)) return;
          e.preventDefault();
          depth.current += 1;
          setDragging(true);
        }}
        onDragOver={(e) => {
          if (!canDrop || !hasFiles(e)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        }}
        onDragLeave={() => {
          depth.current = Math.max(0, depth.current - 1);
          if (depth.current === 0) setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          depth.current = 0;
          setDragging(false);
          if (canDrop) pick(e.dataTransfer?.files?.[0]);
        }}
      >
        {logo && !broken ? (
          <Thumb src={logo.url} alt={t('store.logoPreview')} onError={() => setBroken(true)} />
        ) : (
          <ImageDrop size={112} />
        )}
        <Flex direction="column" gap={1}>
          {!readOnly && (
            <Typography variant="omega" fontWeight="semiBold">
              {t(logo ? 'store.logo.dropReplace' : 'store.logo.drop')}
            </Typography>
          )}
          <Field.Hint />
        </Flex>
        {!readOnly && (
          <Flex gap={2}>
            <Button variant="secondary" loading={busy} onClick={() => input.current?.click()}>
              {t(logo ? 'store.logo.replace' : 'store.logo.select')}
            </Button>
            {logo && (
              <Button variant="danger-light" disabled={busy} onClick={() => setConfirmRemove(true)}>
                {t('store.logo.remove')}
              </Button>
            )}
          </Flex>
        )}
        <Box display="none">
          <input
            ref={input}
            type="file"
            accept={LOGO_ACCEPT}
            data-testid="store-logo-input"
            onChange={(e) => pick(e.target.files?.[0])}
          />
        </Box>
      </Zone>
      <ConfirmModal
        open={confirmRemove}
        title={t('store.logo.removeConfirm.title')}
        text={t('store.logo.removeConfirm.text')}
        confirm={{
          button: t('store.logo.remove'),
          action: () => {
            setConfirmRemove(false);
            remove();
          },
        }}
        cancel={{ button: t('cancel'), action: () => setConfirmRemove(false) }}
      />
    </Field.Root>
  );
};

export { StoreLogoField };
