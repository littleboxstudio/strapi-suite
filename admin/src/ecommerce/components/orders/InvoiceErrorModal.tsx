import { useIntl } from 'react-intl';
import { Button, Flex, Modal, Typography } from '@strapi/design-system';
import { getTranslation } from '../../../core/utils/getTranslation';

type Props = {
  /** What failed, translated (the error code's sentence). */
  message: string;
  /** The billing provider's own message (rejected fields and rules), when it gave one. */
  detail: string | null;
  /** The server refused it, so nothing was issued (otherwise the outcome is not known). */
  refused: boolean;
  /** Translation id of the title (an invoice by default). */
  titleId?: string;
  onClose: () => void;
};

/** Shown in place of the issue modal when an attempt fails: what happened and what to do. */
const InvoiceErrorModal = ({
  message,
  detail,
  refused,
  titleId = 'ecommerce.orders.invoices.issue.errorTitle',
  onClose,
}: Props) => {
  const { formatMessage } = useIntl();
  const t = (id: string) => formatMessage({ id: getTranslation(id) });

  return (
    <Modal.Root open onOpenChange={(next: boolean) => !next && onClose()}>
      <Modal.Content>
        <Modal.Header>
          <Modal.Title>{t(titleId)}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Flex direction="column" alignItems="stretch" gap={3}>
            <Typography variant="omega" textColor="neutral800">
              {message}
            </Typography>
            {refused && (
              <Typography variant="omega" textColor="neutral800">
                {t('ecommerce.orders.invoices.issue.errorNext')}
              </Typography>
            )}
            {detail && (
              <Typography variant="omega" textColor="danger600">
                {detail}
              </Typography>
            )}
          </Flex>
        </Modal.Body>
        <Modal.Footer>
          <Flex justifyContent="flex-end" width="100%">
            <Button variant="tertiary" onClick={onClose}>
              {t('ecommerce.orders.invoices.close')}
            </Button>
          </Flex>
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
};

export default InvoiceErrorModal;
