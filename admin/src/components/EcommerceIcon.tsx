/** The "Ec" letters (drawn on a 48 × 48 square). */
const LETTERS =
  'M9.81461 33V12.6289H23.5412V16.1836H14.1076V20.9688H22.8166V24.4551H14.1076V29.4453H23.5685V33H9.81461ZM32.0877 33.3008C30.52 33.3008 29.1756 32.9681 28.0545 32.3027C26.9334 31.6374 26.0721 30.7122 25.4705 29.5273C24.8781 28.3424 24.5819 26.9753 24.5819 25.4258C24.5819 23.8581 24.8827 22.4818 25.4842 21.2969C26.0949 20.112 26.9608 19.1868 28.0819 18.5215C29.203 17.8561 30.5337 17.5234 32.0741 17.5234C33.4048 17.5234 34.5715 17.765 35.5741 18.248C36.5767 18.7311 37.3696 19.4102 37.953 20.2852C38.5363 21.1602 38.8553 22.1901 38.91 23.375H34.9178C34.7993 22.6185 34.5031 22.0078 34.0291 21.543C33.5552 21.069 32.9263 20.832 32.1424 20.832C31.158 20.832 30.3696 21.2285 29.7772 22.0215C29.1847 22.8053 28.8885 23.9219 28.8885 25.3711C28.8885 26.8294 29.1802 27.9642 29.7635 28.7754C30.356 29.5866 31.1489 29.9922 32.1424 29.9922C32.8716 29.9922 33.4868 29.7643 33.9881 29.3086C34.4894 28.8529 34.7993 28.2148 34.9178 27.3945H38.91C38.8462 28.5612 38.5317 29.5911 37.9666 30.4844C37.4015 31.3685 36.6177 32.0612 35.6151 32.5625C34.6216 33.0547 33.4458 33.3008 32.0877 33.3008Z';

const ICON_STYLES = `
  .ltb-ecommerce-icon .ltb-ecommerce-icon-bg { fill: url(#ltb-ecommerce-icon-bg) !important; }
  .ltb-ecommerce-icon .ltb-ecommerce-icon-fg { fill: #101828 !important; }
  .ltb-ecommerce-icon .ltb-ecommerce-icon-shade { fill: none !important; }
  .ltb-ecommerce-icon .ltb-ecommerce-icon-mask { fill: black !important; }
  nav a:hover .ltb-ecommerce-icon .ltb-ecommerce-icon-bg,
  nav a.active .ltb-ecommerce-icon .ltb-ecommerce-icon-bg { fill: #ffffff !important; }
`;

/**
 * The e-commerce menu icon: dark "Ec" on a blue-to-violet square. Like the plugin icon, its colours
 * are fixed against the main menu's single-colour hover and active paint, and the square turns
 * white on hover and when active (the letters keep their colour).
 */
const EcommerceIcon = () => (
  <svg
    className="ltb-ecommerce-icon"
    width="26"
    height="26"
    viewBox="0 0 48 48"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <style>{ICON_STYLES}</style>
    <defs>
      <linearGradient
        id="ltb-ecommerce-icon-bg"
        x1="0.923076"
        y1="1.84615"
        x2="43.3846"
        y2="47.0769"
        gradientUnits="userSpaceOnUse"
      >
        <stop stopColor="#6DD5FA" />
        <stop offset="1" stopColor="#7F7FD5" />
      </linearGradient>
      <linearGradient
        id="ltb-ecommerce-icon-shade"
        x1="0.923077"
        y1="1.84615"
        x2="46.1538"
        y2="48"
        gradientUnits="userSpaceOnUse"
      >
        <stop stopColor="#7F7FD5" />
        <stop offset="1" stopColor="#6DD5FA" />
      </linearGradient>
      {/* Keeps the outline outside the letters. */}
      <mask
        id="ltb-ecommerce-icon-outline"
        maskUnits="userSpaceOnUse"
        x="8"
        y="11"
        width="32"
        height="24"
      >
        <rect fill="white" x="8" y="11" width="32" height="24" />
        <path className="ltb-ecommerce-icon-mask" d={LETTERS} fill="black" />
      </mask>
    </defs>
    <path
      className="ltb-ecommerce-icon-bg"
      d="M0 3C0 1.34315 1.34315 0 3 0H45C46.6569 0 48 1.34315 48 3V45C48 46.6569 46.6569 48 45 48H3C1.34315 48 0 46.6569 0 45V3Z"
      fill="url(#ltb-ecommerce-icon-bg)"
    />
    <path className="ltb-ecommerce-icon-fg" d={LETTERS} fill="#101828" />
    <path
      className="ltb-ecommerce-icon-shade"
      d={LETTERS}
      fill="none"
      strokeWidth="2"
      stroke="url(#ltb-ecommerce-icon-shade)"
      strokeOpacity="0.3"
      mask="url(#ltb-ecommerce-icon-outline)"
    />
  </svg>
);

export { EcommerceIcon };
