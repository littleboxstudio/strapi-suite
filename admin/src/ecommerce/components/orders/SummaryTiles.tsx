import styled from 'styled-components';

export type TileTone = 'warning' | 'success';

/** Figures side by side: four per row (or `$columns`), two on narrow screens. */
export const Tiles = styled.div<{ $columns?: number }>`
  display: grid;
  grid-template-columns: repeat(${({ $columns }) => $columns ?? 4}, minmax(0, 1fr));
  gap: 12px;

  @media (max-width: 1100px) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
`;

/** One figure: label, the amount large, and its small print; a tone colours the left border. */
export const Tile = styled.div<{ $tone?: TileTone; $compact?: boolean; $surface?: boolean }>`
  display: flex;
  flex-direction: column;
  gap: ${({ $compact }) => ($compact ? '0' : '6px')};
  padding: ${({ $compact }) => ($compact ? '6px 12px' : '16px')};
  transition: padding 120ms ease, gap 120ms ease;
  border: 1px solid ${({ theme }) => theme.colors.neutral200};
  border-left: 4px solid
    ${({ theme, $tone }) =>
      $tone === 'warning'
        ? theme.colors.warning500
        : $tone === 'success'
          ? theme.colors.success500
          : theme.colors.neutral200};
  border-radius: ${({ theme }) => theme.borderRadius};
  /* $surface: the sections' white card colour (Create order's sticky totals), else tinted. */
  background: ${({ theme, $surface }) => ($surface ? theme.colors.neutral0 : theme.colors.neutral100)};
`;
