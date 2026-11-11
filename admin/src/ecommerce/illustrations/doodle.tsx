import styled from 'styled-components';

/**
 * Shared bits for the hand-drawn, black-and-white e-commerce illustrations.
 * Everything paints with `currentColor`, and the svg takes the theme's neutral800,
 * so the drawings invert automatically in Strapi's dark mode.
 */
const DoodleSvg = styled.svg.attrs({
  xmlns: 'http://www.w3.org/2000/svg',
  fill: 'none',
  stroke: 'currentColor',
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
})`
  display: block;
  color: ${({ theme }) => theme.colors.neutral800};
`;

/** Four-point sparkle with slightly uneven arms, filled solid. */
const Sparkle = ({ x, y, r, tilt = 0 }: { x: number; y: number; r: number; tilt?: number }) => {
  const k = r * 0.18;
  return (
    <path
      transform={`rotate(${tilt} ${x} ${y})`}
      fill="currentColor"
      stroke="none"
      d={`M${x} ${y - r} C${x + k} ${y - k * 1.3} ${x + k * 1.2} ${y - k} ${x + r * 0.92} ${y + 0.4}
        C${x + k * 1.1} ${y + k} ${x + k} ${y + k * 1.2} ${x - 0.3} ${y + r * 1.04}
        C${x - k} ${y + k * 1.1} ${x - k * 1.3} ${y + k} ${x - r * 0.96} ${y - 0.2}
        C${x - k * 1.2} ${y - k} ${x - k} ${y - k * 1.2} ${x} ${y - r} Z`}
    />
  );
};

/** Tiny filled dot. */
const Dot = ({ x, y, r = 2.2 }: { x: number; y: number; r?: number }) => (
  <circle cx={x} cy={y} r={r} fill="currentColor" stroke="none" />
);

export { DoodleSvg, Sparkle, Dot };
