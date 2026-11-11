import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import { useNotification } from '@strapi/strapi/admin';
import { Box, Button, Field, Flex, Loader, Modal, TextInput, Typography } from '@strapi/design-system';
import { getTranslation } from '../../../core/utils/getTranslation';
import FetchStripeWebhook from '../../usecases/settings/fetchStripeWebhook';
import type { StripeWebhookInfo as WebhookInfo } from '../../settingsTypes';

type Props = { onClose: () => void };

/** Stripe integration → Webhook: the URL and events to configure in the Stripe dashboard (design 4.14). */
const StripeWebhookModal = ({ onClose }: Props) => {
  const { formatMessage } = useIntl();
  const { toggleNotification } = useNotification();
  const t = (id: string) => formatMessage({ id: getTranslation(id) });

  const [info, setInfo] = useState<WebhookInfo | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    new FetchStripeWebhook()
      .execute()
      .then((data) => {
        if (!cancelled) setInfo(data);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const url = info ? `${window.location.origin}${info.path}` : '';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toggleNotification({ type: 'success', message: t('ecommerce.settings.stripeWebhook.copied') });
    } catch {
      toggleNotification({ type: 'danger', message: t('ecommerce.settings.stripeWebhook.copyError') });
    }
  };

  return (
    <Modal.Root open onOpenChange={(next: boolean) => !next && onClose()}>
      <Modal.Content>
        <Modal.Header>
          <Modal.Title>{t('ecommerce.settings.stripeWebhook.title')}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Flex direction="column" alignItems="stretch" gap={4}>
            <Typography variant="omega" textColor="neutral600">
              {t('ecommerce.settings.stripeWebhook.description')}
            </Typography>
            {error && (
              <Typography textColor="danger600">{t('ecommerce.settings.stripeWebhook.loadError')}</Typography>
            )}
            {!info && !error && (
              <Flex justifyContent="center" padding={4}>
                <Loader small />
              </Flex>
            )}
            {info && (
              <>
                <Flex gap={2} alignItems="flex-start">
                  <Box style={{ flex: 1, minWidth: 0 }}>
                    <Field.Root name="stripeWebhookUrl" hint={t('ecommerce.settings.stripeWebhook.urlHint')}>
                      <Field.Label>{t('ecommerce.settings.stripeWebhook.url')}</Field.Label>
                      <TextInput value={url} readOnly onFocus={(e: any) => e.target.select()} />
                      <Field.Hint />
                    </Field.Root>
                  </Box>
                  <Box paddingTop={6}>
                    <Button variant="secondary" onClick={copy}>
                      {t('ecommerce.settings.stripeWebhook.copy')}
                    </Button>
                  </Box>
                </Flex>
                <Flex direction="column" alignItems="flex-start" gap={2}>
                  <Typography variant="sigma" textColor="neutral600">
                    {t('ecommerce.settings.stripeWebhook.events')}
                  </Typography>
                  <Flex direction="column" alignItems="flex-start" gap={1} tag="ul">
                    {info.events.map((event) => (
                      <Typography key={event} tag="li" variant="omega" style={{ fontFamily: 'monospace' }}>
                        {event}
                      </Typography>
                    ))}
                  </Flex>
                </Flex>
              </>
            )}
          </Flex>
        </Modal.Body>
        <Modal.Footer>
          <Box />
          <Button variant="tertiary" onClick={onClose}>
            {t('ecommerce.settings.stripeWebhook.close')}
          </Button>
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
};

export default StripeWebhookModal;
