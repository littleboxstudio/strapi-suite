import { useIntl } from 'react-intl';
import { Typography } from '@strapi/design-system';
import { getTranslation } from '../../../core/utils/getTranslation';
import { promotionDisplayName, type PromotionLocales } from '../../utils/orderDetail';
import type { DiscountRowBlock } from '../../orderTypes';

type Props = { block: DiscountRowBlock; locales: PromotionLocales };

/**
 * Why a promotion cannot be checked: the stacking rule that fails (exclusive, or a class not
 * allowed) and what it does not stack with (a promotion's name, or the manual discount).
 */
const StackingReason = ({ block, locales }: Props) => {
  const { formatMessage } = useIntl();
  const t = (id: string, values?: Record<string, any>) =>
    formatMessage({ id: getTranslation(id) }, values);
  const name =
    block.kind === 'MANUAL'
      ? t('ecommerce.orders.discounts.manualDiscountName')
      : promotionDisplayName(block, locales.locale, locales.defaultLocale) ?? block.name;
  return (
    <Typography variant="pi" textColor="warning700">
      {t(`ecommerce.orders.discounts.stacking.${block.conflict.rule}`, {
        name,
        discountClass: block.conflict.discountClass
          ? t(`ecommerce.orders.discounts.stackingClass.${block.conflict.discountClass}`)
          : '',
      })}
    </Typography>
  );
};

export default StackingReason;
