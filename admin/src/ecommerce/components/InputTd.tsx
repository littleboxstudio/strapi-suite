import type { CSSProperties, ReactNode } from 'react';

type Props = {
  children?: ReactNode;
  style?: CSSProperties;
  /** Set by the design system's Tr on its cells; not a DOM attribute. */
  coords?: unknown;
};

/**
 * A table cell for a text field inside the design system's Table. Its Td runs a keyboard grid:
 * a focused field puts its cell in an "editing" state that only Enter or Escape ends, and that
 * cell then pulls the focus back each time another cell becomes active — so after typing in a
 * second row, the first could no longer be focused. This cell keeps the Td's look (the row gives
 * the padding) without that navigation.
 */
const InputTd = ({ children, style, coords: _coords, ...rest }: Props) => (
  <td {...rest} style={{ verticalAlign: 'middle', textAlign: 'left', ...style }}>
    {children}
  </td>
);

export { InputTd };
