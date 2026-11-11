import styled from 'styled-components';

/**
 * Wraps a tab list inside the e-commerce content area: it scrolls up with the page and then sticks
 * right under the top bar. The negative margins and matching padding let its background cover the
 * content's side padding so rows scrolling underneath don't show at the edges.
 */
const StickyTabs = styled.div`
  position: sticky;
  top: 0;
  z-index: 2;
  margin: 0 -40px;
  padding: 8px 40px 0;
  background: ${({ theme }) => theme.colors.neutral100};
`;

export default StickyTabs;
