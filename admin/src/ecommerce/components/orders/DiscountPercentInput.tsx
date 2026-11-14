import { TextInput } from '@strapi/design-system';
import { discountPercentFromInput } from '../../utils/lineDiscount';

type Props = {
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
};

/**
 * A line's manual discount percent (spec 4.1): a plain text field (no stepper arrows) that takes
 * digits and one decimal separator, at most 2 decimals. Empty = no discount.
 */
const DiscountPercentInput = ({ value, disabled, onChange }: Props) => (
  <TextInput
    size="S"
    type="text"
    inputMode="decimal"
    autoComplete="off"
    maxLength={6}
    value={value}
    disabled={disabled}
    onChange={(e: any) => onChange(discountPercentFromInput(e.target.value))}
  />
);

export default DiscountPercentInput;
