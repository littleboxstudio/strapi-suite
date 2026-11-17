import {
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type KeyboardEvent,
} from 'react';
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

/**
 * Floats over the content below the field instead of pushing it down. `fixed`, placed from the
 * field's box (`floatingPosition`), so the modal's scrolling panels never clip it.
 */
const List = styled.div`
  position: fixed;
  z-index: 10;
  box-shadow: ${({ theme }) => theme.shadows.popupShadow};
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

/** Gap between the field and the list, in px. */
const GAP = 4;

/**
 * Where the fixed list goes, below `field`. A transformed ancestor (the modal is centred with a
 * transform) becomes the containing block of `position: fixed`, so the box is taken relative to it.
 */
function floatingPosition(field: HTMLElement): CSSProperties {
  const box = field.getBoundingClientRect();
  let origin = { top: 0, left: 0 };
  for (let el = field.parentElement; el; el = el.parentElement) {
    const style = getComputedStyle(el);
    if (style.transform !== 'none' || style.filter !== 'none' || style.perspective !== 'none') {
      const r = el.getBoundingClientRect();
      origin = { top: r.top, left: r.left };
      break;
    }
  }
  return { top: box.bottom - origin.top + GAP, left: box.left - origin.left, width: box.width };
}

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
  const fieldRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<CSSProperties>({});

  // Follows the field while the list is open (modal scroll, window resize).
  useLayoutEffect(() => {
    if (!shown || !fieldRef.current) return undefined;
    const place = () => fieldRef.current && setPosition(floatingPosition(fieldRef.current));
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [shown]);

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
      <div ref={fieldRef}>
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
      </div>
      {shown && (
        <List id={listId} role="listbox" aria-label={listLabel} style={position}>
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
