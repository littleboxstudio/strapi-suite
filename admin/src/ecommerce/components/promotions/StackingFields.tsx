import { useIntl } from 'react-intl';
import { Checkbox, Flex, Typography } from '@strapi/design-system';
import { getTranslation } from '../../../core/utils/getTranslation';
import { setStacking } from '../../utils/promotionForm';
import type { PromotionStacking } from '../../promotionTypes';

type Props = {
  stacking: PromotionStacking;
  onChange: (stacking: PromotionStacking) => void;
  disabled?: boolean;
};

const CLASSES = ['withProduct', 'withOrder', 'withShipping'] as const;

/** "Exclusive" disables the three class options (the server forces them off too). */
const StackingFields = ({ stacking, onChange, disabled }: Props) => {
  const { formatMessage } = useIntl();
  const t = (id: string) => formatMessage({ id: getTranslation(id) });
  const p = 'ecommerce.promotions.form.stacking';

  return (
    <Flex direction="column" alignItems="stretch" gap={3}>
      <Flex direction="column" alignItems="flex-start" gap={1}>
        <Checkbox
          checked={stacking.exclusive}
          disabled={disabled}
          onCheckedChange={(checked: boolean | 'indeterminate') =>
            onChange(setStacking(stacking, 'exclusive', checked === true))
          }
        >
          {t(`${p}.exclusive`)}
        </Checkbox>
        <Typography variant="pi" textColor="neutral600">
          {t(`${p}.exclusive.hint`)}
        </Typography>
      </Flex>
      {CLASSES.map((key) => (
        <Checkbox
          key={key}
          checked={stacking[key]}
          disabled={disabled || stacking.exclusive}
          onCheckedChange={(checked: boolean | 'indeterminate') =>
            onChange(setStacking(stacking, key, checked === true))
          }
        >
          {t(`${p}.${key}`)}
        </Checkbox>
      ))}
      <Typography variant="pi" textColor="neutral600">
        {t(`${p}.hint`)}
      </Typography>
    </Flex>
  );
};

export default StackingFields;
