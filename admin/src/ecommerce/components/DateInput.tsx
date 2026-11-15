import type { ComponentProps } from 'react';
import { TextInput } from '@strapi/design-system';
import { useTheme } from 'styled-components';
import { isDarkColor } from '../utils/statusBadges';

type Props = Omit<ComponentProps<typeof TextInput>, 'type'> & {
  type: 'date' | 'datetime-local' | 'time';
};

/** Opens the browser's picker; some browsers refuse without a user gesture, and then nothing happens. */
const openPicker = (input: HTMLInputElement) => {
  try {
    (input as HTMLInputElement & { showPicker?: () => void }).showPicker?.();
  } catch {
    // Not allowed here (no user gesture, or unsupported): the field still takes typing.
  }
};

/**
 * A native date/time field that opens its calendar on focus and on click, and follows the admin
 * theme (`color-scheme`), so the calendar icon and the picker are light on the dark theme.
 */
const DateInput = ({ onFocus, onClick, style, ...props }: Props) => {
  const theme: any = useTheme();
  const dark = isDarkColor(theme?.colors?.neutral0);
  return (
    <TextInput
      {...props}
      style={{ colorScheme: dark ? 'dark' : 'light', ...style }}
      onFocus={(e: React.FocusEvent<HTMLInputElement>) => {
        openPicker(e.currentTarget);
        onFocus?.(e);
      }}
      onClick={(e: React.MouseEvent<HTMLInputElement>) => {
        openPicker(e.currentTarget);
        onClick?.(e);
      }}
    />
  );
};

export { DateInput };
