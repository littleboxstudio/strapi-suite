import { TextInput } from '@strapi/design-system';
import { QUANTITY_MAX_DIGITS, quantityFromInput } from '../../utils/orderEditing';

type Props = {
  value: number;
  disabled?: boolean;
  onChange: (quantity: number) => void;
};

/** A line quantity: a plain text field that takes digits only (no stepper arrows). */
const QuantityInput = ({ value, disabled, onChange }: Props) => (
  <TextInput
    size="S"
    type="text"
    inputMode="numeric"
    pattern="[0-9]*"
    autoComplete="off"
    maxLength={QUANTITY_MAX_DIGITS}
    value={value > 0 ? String(value) : ''}
    disabled={disabled}
    onChange={(e: any) => onChange(quantityFromInput(e.target.value))}
  />
);

export default QuantityInput;
