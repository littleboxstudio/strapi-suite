import { Flex, Typography } from '@strapi/design-system';
import { useIntl } from 'react-intl';
import { getTranslation } from '../../core/utils/getTranslation';
import ComingSoon from '../illustrations/ComingSoon';

const EcommerceComingSoon = () => {
  const { formatMessage } = useIntl();

  return (
    <Flex direction="column" alignItems="center" gap={3} paddingTop={10} paddingBottom={10}>
      <ComingSoon />
      <Typography variant="beta" tag="h2">
        {formatMessage({ id: getTranslation('ecommerce.comingSoon') })}
      </Typography>
      <Typography variant="omega" textColor="neutral600">
        {formatMessage({ id: getTranslation('ecommerce.comingSoon.description') })}
      </Typography>
    </Flex>
  );
};

export default EcommerceComingSoon;
