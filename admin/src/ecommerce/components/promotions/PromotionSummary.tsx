import { useIntl } from 'react-intl';
import { Box, Flex, Typography } from '@strapi/design-system';
import { getTranslation } from '../../../core/utils/getTranslation';
import { formatCents } from '../../utils/money';
import { describePromotion, type PromotionForm } from '../../utils/promotionForm';

/** The promotion in plain words (`describePromotion`), updated as the form changes. */
const PromotionSummary = ({ form }: { form: PromotionForm }) => {
  const { formatMessage, locale } = useIntl();
  const t = (id: string, values?: Record<string, any>) => formatMessage({ id: getTranslation(id) }, values);
  const lines = describePromotion(form, (cents) => formatCents(cents, locale), t);

  return (
    <Box padding={4} background="neutral100" hasRadius>
      <Flex direction="column" alignItems="stretch" gap={1} tag="ul" style={{ listStyle: 'disc', paddingLeft: 16 }}>
        {lines.map((line, i) => (
          <Typography key={i} tag="li" variant="omega" textColor="neutral800">
            {line}
          </Typography>
        ))}
      </Flex>
    </Box>
  );
};

export default PromotionSummary;
