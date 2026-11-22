import { useIntl } from 'react-intl';
import { Box, Flex, Typography } from '@strapi/design-system';
import { getTranslation } from '../../../core/utils/getTranslation';
import EmptyNote from '../../components/orders/EmptyNote';

/** Placeholder for the collections pages (list, new, edit). */
const CollectionListPage = () => {
  const { formatMessage } = useIntl();
  const t = (id: string) => formatMessage({ id: getTranslation(id) });
  return (
    <Box background="neutral0" shadow="tableShadow" hasRadius padding={6}>
      <Flex direction="column" alignItems="stretch" gap={5}>
        <Typography variant="delta" tag="h2">
          {t('ecommerce.organization.collections.title')}
        </Typography>
        <EmptyNote>{t('ecommerce.organization.collections.empty')}</EmptyNote>
      </Flex>
    </Box>
  );
};

export { CollectionListPage };
