import { useIntl } from 'react-intl';
import styled from 'styled-components';
import { useNotification } from '@strapi/strapi/admin';
import { Box, Button, Flex, IconButton, Modal, Typography } from '@strapi/design-system';
import { Duplicate } from '@strapi/icons';
import { getTranslation } from '../../../core/utils/getTranslation';
import { listExample, variableTag } from '../../utils/emailTemplateEditor';
import type { VariableDef } from '../../settingsTypes';

type Props = {
  variables: VariableDef[];
  onClose: () => void;
};

const Tag = styled.code`
  padding: 2px 6px;
  border: 1px solid ${({ theme }) => theme.colors.neutral200};
  border-radius: ${({ theme }) => theme.borderRadius};
  background: ${({ theme }) => theme.colors.neutral100};
  color: ${({ theme }) => theme.colors.primary600};
  font-family: monospace;
  font-size: ${({ theme }) => theme.fontSizes[1]};
  word-break: break-all;
  user-select: all;
`;

const Example = styled.pre`
  margin: 0;
  padding: 6px 8px;
  border-radius: ${({ theme }) => theme.borderRadius};
  background: ${({ theme }) => theme.colors.neutral100};
  color: ${({ theme }) => theme.colors.neutral700};
  font-size: ${({ theme }) => theme.fontSizes[0]};
  white-space: pre-wrap;
  word-break: break-all;
`;

/** Rows separated by a line, like the other lists in the settings. */
const Row = styled.div`
  padding: 12px 0;

  & + & {
    border-top: 1px solid ${({ theme }) => theme.colors.neutral200};
  }
`;

/** The variable catalog of a template type: look up and copy, then paste in the subject or HTML. */
const VariablesModal = ({ variables, onClose }: Props) => {
  const { formatMessage } = useIntl();
  const { toggleNotification } = useNotification();
  const t = (id: string, values?: Record<string, any>) =>
    formatMessage({ id: getTranslation(id) }, values);

  const copy = async (snippet: string) => {
    try {
      await navigator.clipboard.writeText(snippet);
      toggleNotification({
        type: 'success',
        message: t('ecommerce.settings.emailTemplates.variables.copied'),
      });
    } catch {
      toggleNotification({
        type: 'danger',
        message: t('ecommerce.settings.emailTemplates.variables.copyError'),
      });
    }
  };

  return (
    <Modal.Root open onOpenChange={(next: boolean) => !next && onClose()}>
      <Modal.Content>
        <Modal.Header>
          <Modal.Title>{t('ecommerce.settings.emailTemplates.variables.title')}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Flex direction="column" alignItems="stretch" gap={2}>
            <Typography variant="pi" textColor="neutral600">
              {t('ecommerce.settings.emailTemplates.variables.hint')}
            </Typography>
            <Box>
              {variables.map((variable) => {
                const snippet =
                  variable.kind === 'list' ? listExample(variable) : variableTag(variable.path);
                return (
                  <Row key={variable.path}>
                    <Flex direction="column" alignItems="stretch" gap={2}>
                      <Flex justifyContent="space-between" alignItems="center" gap={2}>
                        <Flex
                          direction="column"
                          alignItems="flex-start"
                          gap={1}
                          style={{ minWidth: 0 }}
                        >
                          <Tag>{variableTag(variable.path)}</Tag>
                          <Typography variant="pi" textColor="neutral600">
                            {variable.description}
                          </Typography>
                        </Flex>
                        <IconButton
                          label={t('ecommerce.settings.emailTemplates.variables.copy', {
                            variable: variable.path,
                          })}
                          variant="ghost"
                          onClick={() => copy(snippet)}
                        >
                          <Duplicate />
                        </IconButton>
                      </Flex>
                      {variable.kind === 'list' && (
                        <Flex direction="column" alignItems="stretch" gap={1}>
                          <Typography variant="pi" textColor="neutral500">
                            {t('ecommerce.settings.emailTemplates.variables.listExample')}
                          </Typography>
                          <Example>{snippet}</Example>
                        </Flex>
                      )}
                    </Flex>
                  </Row>
                );
              })}
            </Box>
          </Flex>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="tertiary" onClick={onClose}>
            {t('ecommerce.settings.emailTemplates.close')}
          </Button>
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
};

export { VariablesModal };
