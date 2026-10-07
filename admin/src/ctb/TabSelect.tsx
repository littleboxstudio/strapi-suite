import { Field, SingleSelect, SingleSelectOption } from '@strapi/design-system';
import { useIntl } from 'react-intl';

type IntlMessage = { id: string; defaultMessage: string };

type TabSelectOption = {
  key: string;
  value: string;
  metadatas: { intlLabel: IntlMessage; disabled?: boolean; hidden?: boolean };
};

type TabSelectProps = {
  name: string;
  value?: string | null;
  error?: string;
  intlLabel: IntlMessage;
  description?: IntlMessage;
  options?: TabSelectOption[];
  onChange: (event: { target: { name: string; value: string; type: string } }) => void;
};

/** Tab select for the field advanced settings; the built-in select does not allow styling its label. */
const TabSelect = ({
  name,
  value,
  error,
  intlLabel,
  description,
  options = [],
  onChange,
}: TabSelectProps) => {
  const { formatMessage } = useIntl();

  return (
    <Field.Root
      name={name}
      id={name}
      error={error}
      hint={description ? formatMessage(description) : undefined}
    >
      <Field.Label style={{ fontSize: '1.6rem', paddingTop: '11px', paddingBottom: '12px' }}>
        {formatMessage(intlLabel)}
      </Field.Label>
      <SingleSelect
        value={value ?? ''}
        onChange={(next: string | number) =>
          onChange({ target: { name, value: String(next), type: 'select' } })
        }
      >
        {options.map(({ key, value: optionValue, metadatas }) => (
          <SingleSelectOption
            key={key}
            value={optionValue}
            disabled={metadatas.disabled}
            hidden={metadatas.hidden}
          >
            {formatMessage(metadatas.intlLabel)}
          </SingleSelectOption>
        ))}
      </SingleSelect>
      <Field.Hint />
      <Field.Error />
    </Field.Root>
  );
};

export default TabSelect;
