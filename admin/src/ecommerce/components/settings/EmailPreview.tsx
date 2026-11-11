import { useIntl } from 'react-intl';
import styled from 'styled-components';
import { Box, Flex, Loader, Typography } from '@strapi/design-system';
import { getTranslation } from '../../../core/utils/getTranslation';
import type { EmailPreview as EmailPreviewData } from '../../settingsTypes';

type Props = {
  preview: EmailPreviewData | null;
  loading: boolean;
  error: boolean;
};

const Frame = styled.iframe`
  display: block;
  width: 100%;
  min-height: 480px;
  height: 100%;
  border: 1px solid ${({ theme }) => theme.colors.neutral200};
  border-radius: ${({ theme }) => theme.borderRadius};
  /* E-mails are designed on white; keep it in the dark admin theme too. */
  background: #ffffff;
`;

/** The rendered e-mail in a sandboxed iframe (no scripts, no same-origin access). */
const EmailPreview = ({ preview, loading, error }: Props) => {
  const { formatMessage } = useIntl();
  const t = (id: string) => formatMessage({ id: getTranslation(id) });

  return (
    <Flex direction="column" alignItems="stretch" gap={3} style={{ height: '100%' }}>
      <Flex justifyContent="space-between" alignItems="center" gap={2}>
        <Typography variant="sigma" textColor="neutral600">
          {t('ecommerce.settings.emailTemplates.preview.title')}
        </Typography>
        {loading && <Loader small />}
      </Flex>

      {error && (
        <Typography variant="omega" textColor="danger600">
          {t('ecommerce.settings.emailTemplates.preview.error')}
        </Typography>
      )}

      {preview && preview.issues.length > 0 && (
        <Box
          background="warning100"
          borderColor="warning200"
          hasRadius
          padding={3}
          role="status"
        >
          <Flex direction="column" alignItems="stretch" gap={1}>
            <Typography variant="omega" fontWeight="semiBold" textColor="warning700">
              {t('ecommerce.settings.emailTemplates.preview.issues')}
            </Typography>
            {preview.issues.map((issue, i) => (
              <Typography key={`${issue.code}-${i}`} variant="pi" textColor="warning700">
                {`${t(`ecommerce.settings.emailTemplates.issues.${issue.code}`)}: ${issue.detail}`}
              </Typography>
            ))}
          </Flex>
        </Box>
      )}

      {preview && (
        <Box>
          <Typography variant="pi" textColor="neutral600">
            {t('ecommerce.settings.emailTemplates.preview.subject')}
          </Typography>{' '}
          <Typography variant="omega" fontWeight="semiBold">
            {preview.subject}
          </Typography>
        </Box>
      )}

      <Frame
        sandbox=""
        srcDoc={preview?.html ?? ''}
        title={t('ecommerce.settings.emailTemplates.preview.frameTitle')}
      />
    </Flex>
  );
};

export { EmailPreview };
