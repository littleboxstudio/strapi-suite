/** The "St" letters (drawn on a 49 × 49 square). */
const LETTERS =
  'M19.924 33.2871C17.4539 33.2871 15.4806 32.722 14.0041 31.5918C12.5366 30.4616 11.771 28.7982 11.7072 26.6016H15.8771C15.95 27.6224 16.3511 28.3926 17.0802 28.9121C17.8185 29.4225 18.7482 29.6777 19.8693 29.6777C20.963 29.6777 21.838 29.4453 22.4943 28.9805C23.1597 28.5156 23.4923 27.9095 23.4923 27.1621C23.4923 26.4785 23.1916 25.9544 22.59 25.5898C21.9884 25.2161 21.1317 24.8971 20.0197 24.6328L17.7912 24.0859C16.0776 23.6758 14.7241 23.0241 13.7306 22.1309C12.7463 21.2285 12.2541 20.0254 12.2541 18.5215C12.2541 17.291 12.5867 16.2155 13.2521 15.2949C13.9175 14.3652 14.8289 13.6452 15.9865 13.1348C17.1532 12.6152 18.4793 12.3555 19.965 12.3555C21.478 12.3555 22.7996 12.6152 23.9298 13.1348C25.0601 13.6543 25.9396 14.3743 26.5685 15.2949C27.2065 16.2155 27.5347 17.2773 27.5529 18.4805H23.3966C23.3237 17.6875 22.9865 17.0677 22.3849 16.6211C21.7834 16.1745 20.9676 15.9512 19.9377 15.9512C18.8895 15.9512 18.0828 16.1699 17.5177 16.6074C16.9526 17.0358 16.6701 17.5827 16.6701 18.248C16.6701 18.9681 16.9845 19.515 17.6134 19.8887C18.2423 20.2533 18.9989 20.5404 19.883 20.75L21.7013 21.2012C22.8862 21.4655 23.939 21.8529 24.8595 22.3633C25.7801 22.8646 26.5047 23.5117 27.0334 24.3047C27.562 25.0885 27.8263 26.0456 27.8263 27.1758C27.8263 29.0443 27.1291 30.5299 25.7345 31.6328C24.34 32.7357 22.4032 33.2871 19.924 33.2871ZM37.0838 17.7148V20.9141H34.1854V28.2969C34.1854 29.2904 34.6685 29.7871 35.6346 29.7871C35.7987 29.7871 35.9764 29.7734 36.1678 29.7461C36.3683 29.7188 36.5415 29.6868 36.6873 29.6504L37.3573 32.8223C36.4549 33.0866 35.5799 33.2188 34.7323 33.2188C33.2192 33.2188 32.0435 32.8359 31.2049 32.0703C30.3755 31.3047 29.9608 30.2337 29.9608 28.8574V20.9141H27.8827V17.7148H29.9608V14.0781H34.1854V17.7148H37.0838Z';

const ICON_STYLES = `
  .ltb-plugin-icon .ltb-plugin-icon-bg { fill: url(#ltb-plugin-icon-bg) !important; }
  .ltb-plugin-icon .ltb-plugin-icon-fg { fill: #101828 !important; }
  .ltb-plugin-icon .ltb-plugin-icon-shade { fill: none !important; }
  .ltb-plugin-icon .ltb-plugin-icon-mask { fill: black !important; }
  nav a:hover .ltb-plugin-icon .ltb-plugin-icon-bg,
  nav a.active .ltb-plugin-icon .ltb-plugin-icon-bg { fill: #ffffff !important; }
  /* The plugin link matches every plugin page, e-commerce included: there the e-commerce link is
     the active one, so this one shows as not active (unless hovered). */
  nav:has(a.active .ltb-ecommerce-icon) a.active:has(.ltb-plugin-icon):not(:hover) {
    background: transparent !important;
  }
  nav:has(a.active .ltb-ecommerce-icon) a.active:not(:hover) .ltb-plugin-icon .ltb-plugin-icon-bg {
    fill: url(#ltb-plugin-icon-bg) !important;
  }
`;

/**
 * The plugin's icon: dark "St" on a light yellow-to-purple square.
 *
 * The admin's main menu paints every path of a menu icon in one colour on hover and when the link
 * is active, which would turn this icon into a plain square. The colours are fixed here, and in the
 * menu the square turns white on hover and when active (the letters keep their colour).
 */
const PluginIcon = () => (
  <svg
    className="ltb-plugin-icon"
    width="26"
    height="26"
    viewBox="0 0 49 49"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <style>{ICON_STYLES}</style>
    <defs>
      <linearGradient
        id="ltb-plugin-icon-bg"
        x1="0.937499"
        y1="1.875"
        x2="44.0625"
        y2="47.8125"
        gradientUnits="userSpaceOnUse"
      >
        <stop stopColor="#FFF1BE" />
        <stop offset="1" stopColor="#BD7AFF" />
      </linearGradient>
      <linearGradient
        id="ltb-plugin-icon-shade"
        x1="0.937501"
        y1="1.875"
        x2="46.875"
        y2="48.75"
        gradientUnits="userSpaceOnUse"
      >
        <stop stopColor="#C080FC" />
        <stop offset="0.948558" stopColor="#FCECC1" />
      </linearGradient>
      {/* Keeps the outline outside the letters. */}
      <mask
        id="ltb-plugin-icon-outline"
        maskUnits="userSpaceOnUse"
        x="10"
        y="11"
        width="29"
        height="24"
      >
        <rect fill="white" x="10" y="11" width="29" height="24" />
        <path className="ltb-plugin-icon-mask" d={LETTERS} fill="black" />
      </mask>
    </defs>
    <path
      className="ltb-plugin-icon-bg"
      d="M0 3C0 1.34315 1.34315 0 3 0H45.75C47.4069 0 48.75 1.34315 48.75 3V45.75C48.75 47.4069 47.4069 48.75 45.75 48.75H3C1.34315 48.75 0 47.4069 0 45.75V3Z"
      fill="url(#ltb-plugin-icon-bg)"
    />
    <path className="ltb-plugin-icon-fg" d={LETTERS} fill="#101828" />
    <path
      className="ltb-plugin-icon-shade"
      d={LETTERS}
      fill="none"
      strokeWidth="2"
      stroke="url(#ltb-plugin-icon-shade)"
      strokeOpacity="0.15"
      mask="url(#ltb-plugin-icon-outline)"
    />
  </svg>
);

export { PluginIcon };
