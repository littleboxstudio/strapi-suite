import { useState } from 'react';
import { useIntl } from 'react-intl';
import { Link as RouterLink } from 'react-router-dom';
import { Box, Button, Field, Flex, Link, Modal, TextInput, Typography } from '@strapi/design-system';
import config from '../../../core/config';
import { getTranslation } from '../../../core/utils/getTranslation';
import SendTestEmail from '../../usecases/settings/sendTestEmail';
import { extractFieldErrors } from '../../utils/productForm';
import { extractErrorCode } from '../../utils/settingsForm';
import type { EmailTemplateType } from '../../settingsTypes';

type Props = {
  type: EmailTemplateType;
  locale: string;
  /** Pre-filled recipient: the current admin user's e-mail. */
  defaultTo: string;
  onClose: () => void;
};

type Result = { status: 'ok' } | { status: 'error'; code: string | null };

const TestEmailModal = ({ type, locale, defaultTo, onClose }: Props) => {
  const { formatMessage } = useIntl();
  const t = (id: string) => formatMessage({ id: getTranslation(id) });

  const [to, setTo] = useState(defaultTo);
  const [toError, setToError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const send = async () => {
    setSending(true);
    setResult(null);
    setToError(null);
    try {
      await new SendTestEmail().execute(type, locale, to.trim());
      setResult({ status: 'ok' });
    } catch (err) {
      const toField = extractFieldErrors(err)?.find((e: any) => e.path === 'to');
      if (toField) setToError((toField as any).code ?? 'invalid_email');
      else setResult({ status: 'error', code: extractErrorCode(err) });
    } finally {
      setSending(false);
    }
  };

  const emailServicePath = `/plugins/${config.pluginId}/ecommerce/settings/email-service`;

  return (
    <Modal.Root open onOpenChange={(next: boolean) => !next && onClose()}>
      <Modal.Content>
        <Modal.Header>
          <Modal.Title>{t('ecommerce.settings.emailTemplates.test.title')}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Flex direction="column" alignItems="stretch" gap={4}>
            <Field.Root
              name="to"
              required
              error={toError ? t(`ecommerce.settings.errors.${toError}`) : undefined}
              hint={t('ecommerce.settings.emailTemplates.test.hint')}
            >
              <Field.Label>{t('ecommerce.settings.emailTemplates.test.to')}</Field.Label>
              <TextInput
                type="email"
                value={to}
                onChange={(e: any) => {
                  setTo(e.target.value);
                  setToError(null);
                }}
              />
              <Field.Hint />
              <Field.Error />
            </Field.Root>

            {result?.status === 'ok' && (
              <Box background="success100" hasRadius padding={3} role="status">
                <Typography textColor="success700">
                  {t('ecommerce.settings.emailTemplates.test.sent')}
                </Typography>
              </Box>
            )}
            {result?.status === 'error' && (
              <Box background="danger100" hasRadius padding={3} role="alert">
                <Flex direction="column" alignItems="flex-start" gap={2}>
                  <Typography textColor="danger700">
                    {result.code === 'EMAIL_NOT_CONFIGURED' || result.code === 'EMAIL_SEND_FAILED'
                      ? t(`ecommerce.settings.errors.${result.code}`)
                      : t('ecommerce.settings.emailTemplates.test.failed')}
                  </Typography>
                  {result.code === 'EMAIL_NOT_CONFIGURED' && (
                    <Link tag={RouterLink} to={emailServicePath}>
                      {t('ecommerce.settings.emailTemplates.test.openEmailService')}
                    </Link>
                  )}
                </Flex>
              </Box>
            )}
          </Flex>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="tertiary" onClick={onClose}>
            {t('ecommerce.settings.emailTemplates.close')}
          </Button>
          <Button onClick={send} loading={sending} disabled={to.trim() === ''}>
            {t('ecommerce.settings.emailTemplates.test.send')}
          </Button>
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
};

export { TestEmailModal };
