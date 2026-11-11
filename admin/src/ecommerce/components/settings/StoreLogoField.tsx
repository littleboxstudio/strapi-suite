import { useRef, useState } from 'react';
import { useIntl } from 'react-intl';
import styled from 'styled-components';
import { useNotification } from '@strapi/strapi/admin';
import { Box, Button, Field, Flex } from '@strapi/design-system';
import ConfirmModal from '../../../components/ConfirmModal';
import { getTranslation } from '../../../core/utils/getTranslation';
import UploadStoreLogo from '../../usecases/settings/uploadStoreLogo';
import RemoveStoreLogo from '../../usecases/settings/removeStoreLogo';
import { LOGO_ACCEPT, buildLogoForm, logoFileError } from '../../utils/storeLogo';
import { extractErrorCode } from '../../utils/settingsForm';
import type { StoreSettings } from '../../settingsTypes';

const Thumb = styled.img`
  max-width: 160px;
  max-height: 48px;
  object-fit: contain;
  border: 1px solid ${({ theme }) => theme.colors.neutral200};
  border-radius: ${({ theme }) => theme.borderRadius};
  background: ${({ theme }) => theme.colors.neutral100};
  padding: 4px;
`;

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
      if (code === 'INVALID_IMAGE') fail('INVALID_IMAGE');
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
      <Field.Label>{t('store.logo')}</Field.Label>
      <Flex gap={3} alignItems="center" wrap="wrap">
        {logo && !broken && (
          <Thumb src={logo.url} alt={t('store.logoPreview')} onError={() => setBroken(true)} />
        )}
        {!readOnly && (
          <Flex gap={2}>
            <Button variant="secondary" size="S" loading={busy} onClick={() => input.current?.click()}>
              {t(logo ? 'store.logo.replace' : 'store.logo.upload')}
            </Button>
            {logo && (
              <Button variant="danger-light" size="S" disabled={busy} onClick={() => setConfirmRemove(true)}>
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
      </Flex>
      <Field.Hint />
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
