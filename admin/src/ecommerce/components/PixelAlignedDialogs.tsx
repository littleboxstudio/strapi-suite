import { createGlobalStyle } from 'styled-components';

/**
 * The design system centres its modals and dialogs with `top: 50%` and `translate(-50%, -50%)`.
 * With a height of 90vh that lands on fractions of a pixel (e.g. top 48.15px), and every 1px
 * field border inside sits between device pixels: on a Retina screen some of them stop being
 * drawn once a field loses focus. Rounding the position to whole pixels keeps them drawn; a
 * browser without CSS `round()` ignores these rules and keeps the default placement. Mounted by
 * the e-commerce layout only, so it applies while the e-commerce pages are open.
 */
const PixelAlignedDialogs = createGlobalStyle`
  [role='dialog'][data-state='open'],
  [role='alertdialog'][data-state='open'] {
    top: round(nearest, 50%, 1px);
    left: round(nearest, 50%, 1px);
    transform: translate(round(nearest, -50%, 1px), round(nearest, -50%, 1px));
  }
`;

export default PixelAlignedDialogs;
