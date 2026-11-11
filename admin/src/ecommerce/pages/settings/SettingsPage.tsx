import { useIntl } from 'react-intl';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { Flex, Loader, Tabs, Typography } from '@strapi/design-system';
import config from '../../../core/config';
import { getTranslation } from '../../../core/utils/getTranslation';
import type { ProviderCategory } from '../../settingsTypes';
import { useSettingsPermissions } from './useSettingsPermissions';
import { GeneralSettings } from './GeneralSettings';
import { IntegrationsSection } from './IntegrationsSection';
import { EmailTemplatesSection } from './EmailTemplatesSection';
import StripeWebhookInfo from '../../components/settings/StripeWebhookInfo';

export const SETTINGS_SECTIONS = [
  'general',
  'payments',
  'billing',
  'shipping',
  'email-service',
  'email-templates',
] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

/** Provider category shown by each integrations section. */
const SECTION_CATEGORY: Partial<Record<SettingsSection, ProviderCategory>> = {
  payments: 'payment',
  billing: 'billing',
  shipping: 'carrier',
  'email-service': 'email',
};

const isSection = (value: string | undefined): value is SettingsSection =>
  SETTINGS_SECTIONS.includes(value as SettingsSection);

const SettingsPage = () => {
  const { formatMessage } = useIntl();
  const navigate = useNavigate();
  const params = useParams<{ section: string }>();
  const { isLoading, canUpdate } = useSettingsPermissions();
  const basePath = `/plugins/${config.pluginId}/ecommerce/settings`;
  const t = (id: string) => formatMessage({ id: getTranslation(id) });

  if (params.section !== undefined && !isSection(params.section)) {
    return <Navigate to={basePath} replace />;
  }
  const section: SettingsSection = params.section ?? 'general';
  const category = SECTION_CATEGORY[section];

  return (
    <Flex direction="column" alignItems="stretch" gap={6}>
      <Typography variant="beta" tag="h1">
        {t('ecommerce.settings.title')}
      </Typography>

      <Tabs.Root
        variant="simple"
        value={section}
        onValueChange={(value: string) => navigate(`${basePath}/${value}`)}
      >
        <Tabs.List aria-label={t('ecommerce.settings.title')}>
          {SETTINGS_SECTIONS.map((key) => (
            <Tabs.Trigger key={key} value={key}>
              {t(`ecommerce.settings.sections.${key}`)}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
      </Tabs.Root>

      {isLoading ? (
        <Flex justifyContent="center" padding={8}>
          <Loader />
        </Flex>
      ) : (
        <>
          {!canUpdate && (
            <Typography variant="omega" textColor="neutral600">
              {t('ecommerce.settings.readOnly')}
            </Typography>
          )}
          {section === 'general' && <GeneralSettings readOnly={!canUpdate} />}
          {category && <IntegrationsSection key={category} category={category} readOnly={!canUpdate} />}
          {section === 'payments' && <StripeWebhookInfo />}
          {section === 'email-templates' && <EmailTemplatesSection />}
        </>
      )}
    </Flex>
  );
};

export { SettingsPage };
