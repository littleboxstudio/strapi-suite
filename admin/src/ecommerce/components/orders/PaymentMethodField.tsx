import { useId, useMemo, useState, type FocusEvent, type KeyboardEvent } from 'react';
import styled from 'styled-components';
import { IconButton, TextInput } from '@strapi/design-system';
import { Trash } from '@strapi/icons';
import { filterPaymentMethodSuggestions } from '../../utils/paymentMethodSuggestions';

type Props = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Method texts written before; empty → a plain text field. */
  suggestions: string[];
  /** Trash button on an option: hides that suggestion (the parent removes it optimistically). */
  onRemove: (name: string) => void;
  listLabel: string;
  removeLabel: string;
};

const List = styled.div`
  margin-top: ${({ theme }) => theme.spaces[1]};
  max-height: 200px;
  overflow-y: auto;
  border: 1px solid ${({ theme }) => theme.colors.neutral200};
  border-radius: ${({ theme }) => theme.borderRadius};
  background: ${({ theme }) => theme.colors.neutral0};
`;

const Row = styled.div<{ $active: boolean }>`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spaces[2]};
  padding: ${({ theme }) => `${theme.spaces[1]} ${theme.spaces[2]} ${theme.spaces[1]} ${theme.spaces[4]}`};
  background: ${({ theme, $active }) => ($active ? theme.colors.primary100 : 'transparent')};
  &:hover {
    background: ${({ theme, $active }) => ($active ? theme.colors.primary100 : theme.colors.neutral100)};
  }
`;

const Option = styled.div`
  flex: 1;
  min-width: 0;
  cursor: pointer;
  padding: ${({ theme }) => `${theme.spaces[2]} 0`};
  font-size: ${({ theme }) => theme.fontSizes[2]};
  color: ${({ theme }) => theme.colors.neutral800};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

/**
 * Add payment's "Payment method": always free text, with the methods written before as a
 * filtered list below it (Combobox options cannot host a button). Picking one only copies its
 * text; each option has a trash button. Keyboard: ↓/↑ move, Enter picks, Escape closes.
 */
const PaymentMethodField = ({
  value,
  onChange,
  placeholder,
  suggestions,
  onRemove,
  listLabel,
  removeLabel,
}: Props) => {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const options = useMemo(
    () => filterPaymentMethodSuggestions(suggestions, value),
    [suggestions, value]
  );
  const shown = open && options.length > 0;
  const optionId = (i: number) => `${listId}-option-${i}`;

  const pick = (name: string) => {
    onChange(name);
    setOpen(false);
    setActive(-1);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!options.length) return;
      e.preventDefault();
      setOpen(true);
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((i) => (i + step + options.length) % options.length);
    } else if (e.key === 'Enter' && shown && active >= 0 && active < options.length) {
      e.preventDefault();
      pick(options[active]);
    } else if (e.key === 'Escape' && shown) {
      // Closes the list first.
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      setActive(-1);
    }
  };

  // Focus moving to a trash button keeps the list open; leaving the field closes it.
  const onBlur = (e: FocusEvent<HTMLDivElement>) => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setOpen(false);
    setActive(-1);
  };

  return (
    <div onBlur={onBlur}>
      <TextInput
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        role={suggestions.length ? 'combobox' : undefined}
        aria-autocomplete={suggestions.length ? 'list' : undefined}
        aria-expanded={suggestions.length ? shown : undefined}
        aria-controls={shown ? listId : undefined}
        aria-activedescendant={shown && active >= 0 ? optionId(active) : undefined}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onKeyDown={onKeyDown}
        onChange={(e: any) => {
          onChange(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
      />
      {shown && (
        <List id={listId} role="listbox" aria-label={listLabel}>
          {options.map((name, i) => (
            <Row key={name} role="presentation" $active={i === active}>
              <Option
                id={optionId(i)}
                role="option"
                aria-selected={i === active}
                title={name}
                // Keeps the focus in the input, so the blur does not close the list first.
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(name)}
              >
                {name}
              </Option>
              <IconButton
                label={removeLabel}
                variant="ghost"
                size="S"
                withTooltip={false}
                onMouseDown={(e: any) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onClick={(e: any) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setActive(-1);
                  onRemove(name);
                }}
              >
                <Trash />
              </IconButton>
            </Row>
          ))}
        </List>
      )}
    </div>
  );
};

export default PaymentMethodField;
