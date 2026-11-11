import { useIntl } from 'react-intl';
import styled from 'styled-components';
import { useNotification } from '@strapi/strapi/admin';
import { Box, Flex, IconButton, Typography } from '@strapi/design-system';
import { Duplicate } from '@strapi/icons';
import { getTranslation } from '../../../core/utils/getTranslation';
import { listExample, variableTag } from '../../utils/emailTemplateEditor';
import type { VariableDef } from '../../settingsTypes';

type Props = {
  variables: VariableDef[];
  /** Absent in read-only mode: the variables can still be copied. */
  onInsert?: (snippet: string) => void;
};

const VariableButton = styled.button`
  padding: 2px 6px;
  border: 1px solid ${({ theme }) => theme.colors.neutral200};
  border-radius: ${({ theme }) => theme.borderRadius};
  background: ${({ theme }) => theme.colors.neutral100};
  color: ${({ theme }) => theme.colors.primary600};
  font-family: monospace;
  font-size: ${({ theme }) => theme.fontSizes[1]};
  text-align: left;
  word-break: break-all;
  cursor: pointer;

  &:disabled {
    cursor: default;
    color: ${({ theme }) => theme.colors.neutral800};
  }
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

/** The variable catalog of a template type: click inserts at the cursor, the icon copies. */
const VariablesPanel = ({ variables, onInsert }: Props) => {
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
    <Box background="neutral0" shadow="tableShadow" hasRadius padding={4}>
      <Flex direction="column" alignItems="stretch" gap={3}>
        <Flex direction="column" alignItems="flex-start" gap={1}>
          <Typography variant="delta" tag="h2">
            {t('ecommerce.settings.emailTemplates.variables.title')}
          </Typography>
          <Typography variant="pi" textColor="neutral600">
            {t(
              onInsert
                ? 'ecommerce.settings.emailTemplates.variables.hint'
                : 'ecommerce.settings.emailTemplates.variables.hintReadOnly'
            )}
          </Typography>
        </Flex>

        {variables.map((variable) => {
          const snippet =
            variable.kind === 'list' ? listExample(variable) : variableTag(variable.path);
          return (
            <Flex key={variable.path} direction="column" alignItems="stretch" gap={1}>
              <Flex justifyContent="space-between" alignItems="center" gap={2}>
                <Flex direction="column" alignItems="flex-start" gap={1} style={{ minWidth: 0 }}>
                  <VariableButton
                    type="button"
                    disabled={!onInsert}
                    onClick={() => onInsert?.(snippet)}
                    title={
                      onInsert
                        ? t('ecommerce.settings.emailTemplates.variables.insert')
                        : undefined
                    }
                  >
                    {variableTag(variable.path)}
                  </VariableButton>
                  <Typography variant="pi" textColor="neutral600">
                    {variable.description}
                  </Typography>
                </Flex>
                <IconButton
                  label={t('ecommerce.settings.emailTemplates.variables.copy', {
                    variable: variable.path,
                  })}
                  variant="ghost"
                  size="S"
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
          );
        })}
      </Flex>
    </Box>
  );
};

export { VariablesPanel };
