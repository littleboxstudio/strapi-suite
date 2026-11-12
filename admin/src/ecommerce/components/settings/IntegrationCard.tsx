import type { ReactNode } from 'react';
import { useIntl } from 'react-intl';
import { Badge, Box, Button, Flex, Typography } from '@strapi/design-system';
import { Cog, Play } from '@strapi/icons';
import { getTranslation } from '../../../core/utils/getTranslation';
import type { ConnectionResult, IntegrationView } from '../../settingsTypes';
import { ActiveToggleButton } from './ActiveToggleButton';

/** `error` is a failed request (not a connection result). */
export type TestState =
  | { status: 'idle' }
  | { status: 'testing' }
  | { status: 'done'; result: ConnectionResult }
  | { status: 'error' };

type Props = {
  integration: IntegrationView;
  readOnly: boolean;
  /** True while the activation request runs. */
  toggling: boolean;
  test: TestState;
  onConfigure: () => void;
  onTest: () => void;
  onToggleActive: (active: boolean) => void;
  /**
   * The Enable/Disable button is placed by the children (e.g. next to "Add shipping method")
   * instead of before Configure.
   */
  toggleInChildren?: boolean;
  /** Extra buttons after Configure / Test (e.g. Stripe's Webhook); shown even when read-only. */
  extraActions?: ReactNode;
  /** Extra content inside the card, after the actions (e.g. the manual shipping methods). */
  children?: ReactNode;
};

const IntegrationCard = ({
  integration,
  readOnly,
  toggling,
  test,
  onConfigure,
  onTest,
  onToggleActive,
  extraActions,
  toggleInChildren = false,
  children,
}: Props) => {
  const { formatMessage } = useIntl();
  const t = (id: string, values?: Record<string, any>, defaultMessage?: string) =>
    formatMessage({ id: getTranslation(id), defaultMessage }, values);

  const { id, active, fields, secretsStatus } = integration;
  const name = t(`ecommerce.settings.providers.${id}.name`, undefined, integration.name);
  const description = t(`ecommerce.settings.providers.${id}.description`, undefined, ' ').trim();
  const configurable = fields.length > 0;
  const hasSecrets = fields.some((f) => f.type === 'secret');

  const credentials = () => {
    if (!hasSecrets) return null;
    if (secretsStatus === 'ok') {
      return (
        <Typography variant="pi" textColor="success600">
          {t('ecommerce.settings.integrations.credentials.ok')}
        </Typography>
      );
    }
    if (secretsStatus === 'unreadable') {
      return (
        <Typography variant="pi" textColor="danger600">
          {t('ecommerce.settings.integrations.credentials.unreadable')}
        </Typography>
      );
    }
    return (
      <Typography variant="pi" textColor="neutral600">
        {t('ecommerce.settings.integrations.credentials.missing')}
      </Typography>
    );
  };

  const testResult = () => {
    if (test.status === 'error') {
      return (
        <Typography variant="pi" textColor="danger600">
          {t('ecommerce.settings.integrations.test.failed')}
        </Typography>
      );
    }
    if (test.status !== 'done') return null;
    const { ok, code, message } = test.result;
    const label = t(`ecommerce.settings.integrations.test.${ok ? 'ok' : (code ?? 'failed')}`);
    return (
      <Typography variant="pi" textColor={ok ? 'success600' : 'danger600'} role="status">
        {/* A successful test may carry a qualifier (e.g. a restricted / sending-only key). */}
        {ok && message ? `${label} (${message})` : label}
      </Typography>
    );
  };

  return (
    <Box background="neutral0" shadow="tableShadow" hasRadius padding={6}>
      <Flex direction="column" alignItems="stretch" gap={4}>
        <Flex justifyContent="space-between" alignItems="flex-start" gap={4} wrap="wrap">
          <Flex direction="column" alignItems="flex-start" gap={2}>
            <Flex gap={2} alignItems="center" wrap="wrap">
              <Typography variant="delta" tag="h2">
                {name}
              </Typography>
              {active ? (
                <Badge backgroundColor="success100" textColor="success700">
                  {t('ecommerce.settings.integrations.active')}
                </Badge>
              ) : (
                <Badge>{t('ecommerce.settings.integrations.inactive')}</Badge>
              )}
            </Flex>
            {description && (
              <Typography variant="omega" textColor="neutral600">
                {description}
              </Typography>
            )}
            {credentials()}
          </Flex>
        </Flex>

        {((configurable && !readOnly) || extraActions || (!readOnly && !toggleInChildren)) && (
          <Flex gap={2} alignItems="center" wrap="wrap">
            {!readOnly && !toggleInChildren && (
              <ActiveToggleButton
                name={name}
                active={active}
                busy={toggling}
                onChange={onToggleActive}
              />
            )}
            {configurable && !readOnly && (
              <Button variant="secondary" startIcon={<Cog />} onClick={onConfigure}>
                {t('ecommerce.settings.integrations.configure')}
              </Button>
            )}
            {extraActions}
            {configurable && !readOnly && (
              <>
                <Button
                  variant="tertiary"
                  startIcon={<Play />}
                  onClick={onTest}
                  loading={test.status === 'testing'}
                >
                  {t('ecommerce.settings.integrations.test')}
                </Button>
                {testResult()}
              </>
            )}
          </Flex>
        )}

        {children}
      </Flex>
    </Box>
  );
};

export { IntegrationCard };
