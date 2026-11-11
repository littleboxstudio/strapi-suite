import { useIntl } from 'react-intl';
import { Button, Flex, Modal, Typography } from '@strapi/design-system';
import { getTranslation } from '../../../core/utils/getTranslation';

type Props = {
  /** The field's label, used as the title. */
  title: string;
  /** i18n key of the help text; blank lines separate paragraphs. */
  textKey: string;
  onClose: () => void;
};

/** Plain-text explanation of where to find an integration field's value. */
const FieldHelpModal = ({ title, textKey, onClose }: Props) => {
  const { formatMessage } = useIntl();
  const t = (id: string) => formatMessage({ id: getTranslation(id) });
  const paragraphs = t(textKey)
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  return (
    <Modal.Root open onOpenChange={(next: boolean) => !next && onClose()}>
      <Modal.Content>
        <Modal.Header>
          <Modal.Title>{title}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Flex direction="column" alignItems="stretch" gap={3}>
            {paragraphs.map((paragraph, index) => (
              <Typography key={index} variant="omega" style={{ whiteSpace: 'pre-line' }}>
                {paragraph}
              </Typography>
            ))}
          </Flex>
        </Modal.Body>
        <Modal.Footer>
          <span />
          <Button variant="tertiary" onClick={onClose}>
            {t('ecommerce.settings.integrations.help.close')}
          </Button>
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
};

export { FieldHelpModal };
