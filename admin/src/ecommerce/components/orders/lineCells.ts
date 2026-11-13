import type { CSSProperties } from 'react';

/**
 * Cells of the editable line tables: the row grows with its content (a wrapped product name,
 * badges) instead of the design system's fixed row height, with padding above and below.
 */
export const LINE_CELL: CSSProperties = { height: 'auto', paddingTop: 12, paddingBottom: 12 };

/**
 * The product cell takes the space the other (fit) columns leave; its name wraps instead of being
 * cut (the design system's cells are `nowrap`). No explicit width: `100%` would push the table
 * wider than the modal.
 */
export const PRODUCT_CELL: CSSProperties = { ...LINE_CELL, whiteSpace: 'normal', wordBreak: 'break-word' };

/** The other columns shrink to their content. */
export const FIT_CELL: CSSProperties = { ...LINE_CELL, width: '1%', whiteSpace: 'nowrap' };
