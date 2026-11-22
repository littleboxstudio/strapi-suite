import { useIntl } from 'react-intl';
import { Box, Field, Flex, TextInput } from '@strapi/design-system';
import { getTranslation } from '../../../core/utils/getTranslation';
import type { PromotionErrors } from '../../utils/promotionForm';

export type LimitKey = 'usageLimit' | 'perCustomerLimit' | 'perOrderLimit';

type Props = {
  values: Record<LimitKey, string>;
  onChange: (key: LimitKey, value: string) => void;
  errors: PromotionErrors;
  disabled?: boolean;
};

const KEYS: LimitKey[] = ['usageLimit', 'perCustomerLimit', 'perOrderLimit'];

/** Global, per-customer and per-order limits; empty means no limit. */
const LimitsFields = ({ values, onChange, errors, disabled }: Props) => {
  const { formatMessage } = useIntl();
  const t = (id: string) => formatMessage({ id: getTranslation(id) });
  const p = 'ecommerce.promotions.form';

  return (
    // One field per line, full width (the section takes half the page, beside Stacking).
    <Flex direction="column" alignItems="stretch" gap={4}>
      {KEYS.map((key) => (
        <Box key={key}>
          <Field.Root
            name={key}
            error={errors[key] ? t(`${p}.errors.${errors[key]}`) : undefined}
            hint={t(`${p}.limits.hint`)}
          >
            <Field.Label>{t(`${p}.limits.${key}`)}</Field.Label>
            <TextInput
              value={values[key]}
              inputMode="numeric"
              disabled={disabled}
              onChange={(e: any) => onChange(key, e.target.value)}
            />
            <Field.Error />
            <Field.Hint />
          </Field.Root>
        </Box>
      ))}
    </Flex>
  );
};

export default LimitsFields;
