import styled from 'styled-components';

export type TileTone = 'warning' | 'success';

/** Figures side by side: four per row, two on narrow screens. */
export const Tiles = styled.div`
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;

  @media (max-width: 1100px) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
`;

/** One figure: label, the amount large, and its small print; a tone colours the left border. */
export const Tile = styled.div<{ $tone?: TileTone }>`
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 16px;
  border: 1px solid ${({ theme }) => theme.colors.neutral200};
  border-left: 4px solid
    ${({ theme, $tone }) =>
      $tone === 'warning'
        ? theme.colors.warning500
        : $tone === 'success'
          ? theme.colors.success500
          : theme.colors.neutral200};
  border-radius: ${({ theme }) => theme.borderRadius};
  background: ${({ theme }) => theme.colors.neutral100};
`;
