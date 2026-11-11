import styled from 'styled-components';

/**
 * Wraps a tab list inside the e-commerce content area: it scrolls up with the page and then sticks
 * right under the top bar. Sticky offsets are measured from the scroll area's padding edge, so
 * `top` cancels the content's 32px top padding to touch the bar. The negative side margins and
 * matching padding let its background cover the content's side padding.
 */
const StickyTabs = styled.div`
  position: sticky;
  top: -32px;
  z-index: 2;
  margin: 0 -40px;
  padding: 0 40px;
  background: ${({ theme }) => theme.colors.neutral100};
`;

export default StickyTabs;
