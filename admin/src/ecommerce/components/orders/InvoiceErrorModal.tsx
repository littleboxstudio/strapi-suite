import { useIntl } from 'react-intl';
import styled from 'styled-components';
import { Button, Flex, Modal, Typography } from '@strapi/design-system';
import { WarningCircle } from '@strapi/icons';
import { getTranslation } from '../../../core/utils/getTranslation';

type Props = {
  /** What failed, translated (the error code's sentence). */
  message: string;
  /** The billing provider's own message (rejected fields and rules), when it gave one. */
  detail: string | null;
  /** The server refused it, so nothing was issued (otherwise the outcome is not known). */
  refused: boolean;
  onClose: () => void;
};

const Icon = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: ${({ theme }) => theme.colors.danger100};
  color: ${({ theme }) => theme.colors.danger600};

  svg {
    width: 24px;
    height: 24px;
  }
`;

/** The provider's message, as it came. */
const Detail = styled.pre`
  margin: 0;
  padding: 12px 16px;
  border: 1px solid ${({ theme }) => theme.colors.neutral200};
  border-radius: ${({ theme }) => theme.borderRadius};
  background: ${({ theme }) => theme.colors.neutral100};
  color: ${({ theme }) => theme.colors.neutral800};
  font-size: ${({ theme }) => theme.fontSizes[1]};
  line-height: 1.6;
  text-align: left;
  white-space: pre-wrap;
  word-break: break-word;
`;

/** Shown in place of the issue modal when an attempt fails: what happened and what to do. */
const InvoiceErrorModal = ({ message, detail, refused, onClose }: Props) => {
  const { formatMessage } = useIntl();
  const t = (id: string) => formatMessage({ id: getTranslation(id) });

  return (
    <Modal.Root open onOpenChange={(next: boolean) => !next && onClose()}>
      <Modal.Content>
        <Modal.Header>
          <Modal.Title>{t('ecommerce.orders.invoices.issue.errorTitle')}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Flex direction="column" alignItems="stretch" gap={5}>
            <Flex direction="column" alignItems="center" gap={3}>
              <Icon aria-hidden>
                <WarningCircle fill="currentColor" />
              </Icon>
              <Typography variant="delta" tag="p" textAlign="center">
                {message}
              </Typography>
              {refused && (
                <Typography variant="omega" textColor="neutral600" textAlign="center">
                  {t('ecommerce.orders.invoices.issue.errorNext')}
                </Typography>
              )}
            </Flex>
            {detail && (
              <Flex direction="column" alignItems="stretch" gap={2}>
                <Typography variant="sigma" textColor="neutral600">
                  {t('ecommerce.orders.invoices.issue.providerMessage')}
                </Typography>
                <Detail>{detail}</Detail>
              </Flex>
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
