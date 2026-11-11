import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import { useNavigate } from 'react-router-dom';
import {
  Badge,
  Box,
  Button,
  Flex,
  Loader,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  Typography,
  VisuallyHidden,
} from '@strapi/design-system';
import { Pencil } from '@strapi/icons';
import config from '../../../core/config';
import { getTranslation } from '../../../core/utils/getTranslation';
import FetchEmailTemplates from '../../usecases/settings/fetchEmailTemplates';
import FetchEcommerceLocales from '../../usecases/fetchEcommerceLocales';
import { EMAIL_TEMPLATE_TYPES } from '../../utils/emailTemplateEditor';
import type { EmailTemplateSummary } from '../../settingsTypes';

/** Used when the locales cannot be read (they need the products read permission). */
const FALLBACK_LOCALE = 'en';

const EmailTemplatesSection = () => {
  const { formatMessage } = useIntl();
  const navigate = useNavigate();
  const t = (id: string) => formatMessage({ id: getTranslation(id) });

  const [summaries, setSummaries] = useState<EmailTemplateSummary[] | null>(null);
  const [defaultLocale, setDefaultLocale] = useState(FALLBACK_LOCALE);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [rows, info] = await Promise.allSettled([
        new FetchEmailTemplates().execute(),
        new FetchEcommerceLocales().execute(),
      ]);
      if (cancelled) return;
      if (rows.status === 'rejected') {
        setLoadError(true);
        return;
      }
      setSummaries(rows.value);
      if (info.status === 'fulfilled') setDefaultLocale(info.value.defaultLocale);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loadError) {
    return <Typography textColor="danger600">{t('ecommerce.settings.loadError')}</Typography>;
  }
  if (!summaries) {
    return (
      <Flex justifyContent="center" padding={8}>
        <Loader />
      </Flex>
    );
  }

  const customLocales = (type: string) =>
    summaries.find((s) => s.type === type)?.customLocales ?? [];
  const editorPath = (type: string) =>
    `/plugins/${config.pluginId}/ecommerce/settings/email-templates/${type}/${encodeURIComponent(defaultLocale)}`;

  return (
    <Box background="neutral0" shadow="tableShadow" hasRadius padding={6}>
      <Flex direction="column" alignItems="stretch" gap={5}>
        <Flex direction="column" alignItems="flex-start" gap={1}>
          <Typography variant="delta" tag="h2">
            {t('ecommerce.settings.emailTemplates.title')}
          </Typography>
          <Typography variant="omega" textColor="neutral600">
            {t('ecommerce.settings.emailTemplates.description')}
          </Typography>
        </Flex>

        <Table colCount={3} rowCount={EMAIL_TEMPLATE_TYPES.length + 1}>
          <Thead>
            <Tr>
              <Th>
                <Typography variant="sigma">
                  {t('ecommerce.settings.emailTemplates.table.name')}
                </Typography>
              </Th>
              <Th>
                <Typography variant="sigma">
                  {t('ecommerce.settings.emailTemplates.table.customized')}
                </Typography>
              </Th>
              <Th>
                <VisuallyHidden>{t('ecommerce.settings.emailTemplates.table.actions')}</VisuallyHidden>
              </Th>
            </Tr>
          </Thead>
          <Tbody>
            {EMAIL_TEMPLATE_TYPES.map((type) => {
              const locales = customLocales(type);
              return (
                <Tr key={type}>
                  <Td style={{ whiteSpace: 'normal' }}>
                    <Flex direction="column" alignItems="flex-start" gap={1} paddingTop={2} paddingBottom={2}>
                      <Typography fontWeight="semiBold" textColor="neutral800">
                        {t(`ecommerce.settings.emailTemplates.types.${type}.name`)}
                      </Typography>
                      <Typography variant="pi" textColor="neutral600">
                        {t(`ecommerce.settings.emailTemplates.types.${type}.description`)}
                      </Typography>
                    </Flex>
                  </Td>
                  <Td>
                    {locales.length ? (
                      <Flex gap={1} wrap="wrap">
                        {locales.map((code) => (
                          <Badge key={code} backgroundColor="primary100" textColor="primary600">
                            {code}
                          </Badge>
                        ))}
                      </Flex>
                    ) : (
                      <Typography variant="pi" textColor="neutral500">
                        {t('ecommerce.settings.emailTemplates.table.notCustomized')}
                      </Typography>
                    )}
                  </Td>
                  <Td>
                    <Flex justifyContent="flex-end">
                      <Button
                        size="S"
                        variant="tertiary"
                        startIcon={<Pencil />}
                        onClick={() => navigate(editorPath(type))}
                      >
                        {t('ecommerce.settings.emailTemplates.edit')}
                      </Button>
                    </Flex>
                  </Td>
                </Tr>
              );
            })}
          </Tbody>
        </Table>
      </Flex>
    </Box>
  );
};

export { EmailTemplatesSection };
