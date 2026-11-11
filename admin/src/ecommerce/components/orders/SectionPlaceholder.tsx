import { useIntl } from 'react-intl';
import { Flex, Typography } from '@strapi/design-system';
import { getTranslation } from '../../../core/utils/getTranslation';
import EmptySection from '../../illustrations/EmptySection';
import OrderSection from './OrderSection';

/** A section whose content arrives in a later plan (invoices, shipments, refunds, promotions). */
const SectionPlaceholder = ({ title }: { title: string }) => {
  const { formatMessage } = useIntl();
  return (
    <OrderSection title={title}>
      <Flex direction="column" alignItems="center" gap={2} paddingTop={2} paddingBottom={2}>
        <EmptySection />
        <Typography variant="pi" textColor="neutral600">
          {formatMessage({ id: getTranslation('ecommerce.orders.detail.sections.empty') })}
        </Typography>
      </Flex>
    </OrderSection>
  );
};

export default SectionPlaceholder;
