import { useIntl } from 'react-intl';
import { useNotification } from '@strapi/strapi/admin';
import { Box, Button, Field, Flex, Modal, TextInput, Typography } from '@strapi/design-system';
import { getTranslation } from '../../../core/utils/getTranslation';

type Props = {
  /** The plain token, shown this one time only. */
  accessKey: string;
  /** Regenerate only: the previous token could not be deleted. */
  previousTokenDeleted?: boolean;
  onClose: () => void;
};

/** Shows a freshly generated storefront token once, with a copy button. */
const StorefrontTokenKeyModal = ({ accessKey, previousTokenDeleted, onClose }: Props) => {
  const { formatMessage } = useIntl();
  const { toggleNotification } = useNotification();
  const t = (id: string) => formatMessage({ id: getTranslation(id) });

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(accessKey);
      toggleNotification({ type: 'success', message: t('ecommerce.settings.storefrontApi.key.copied') });
    } catch {
      toggleNotification({ type: 'danger', message: t('ecommerce.settings.storefrontApi.key.copyError') });
    }
  };

  return (
    <Modal.Root open onOpenChange={(next: boolean) => !next && onClose()}>
      <Modal.Content>
        <Modal.Header>
          <Modal.Title>{t('ecommerce.settings.storefrontApi.key.title')}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Flex direction="column" alignItems="stretch" gap={4}>
            <Box background="warning100" borderColor="warning200" hasRadius padding={3} role="note">
              <Typography textColor="neutral800">{t('ecommerce.settings.storefrontApi.key.explanation')}</Typography>
            </Box>
            {previousTokenDeleted === false && (
              <Box background="danger100" borderColor="danger200" hasRadius padding={3} role="alert">
                <Typography textColor="danger700">
                  {t('ecommerce.settings.storefrontApi.key.previousNotDeleted')}
                </Typography>
              </Box>
            )}
            <Flex gap={2} alignItems="flex-end">
              <Box style={{ flex: 1, minWidth: 0 }}>
                <Field.Root name="storefrontApiTokenKey">
                  <Field.Label>{t('ecommerce.settings.storefrontApi.key.label')}</Field.Label>
                  <TextInput
                    value={accessKey}
                    readOnly
                    style={{ fontFamily: 'monospace' }}
                    onFocus={(e: any) => e.target.select()}
                  />
                </Field.Root>
              </Box>
              <Button variant="secondary" onClick={copy}>
                {t('ecommerce.settings.storefrontApi.key.copy')}
              </Button>
            </Flex>
          </Flex>
        </Modal.Body>
        <Modal.Footer>
          <Flex justifyContent="flex-end" width="100%">
            <Button onClick={onClose}>{t('ecommerce.settings.storefrontApi.key.done')}</Button>
          </Flex>
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
};

export default StorefrontTokenKeyModal;
