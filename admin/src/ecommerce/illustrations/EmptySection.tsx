import { DoodleSvg, Sparkle } from './doodle';

/** Small open, empty tray: a section with nothing to show yet. */
const EmptySection = ({ size = 72 }: { size?: number }) => (
  <DoodleSvg
    width={size}
    height={size}
    viewBox="0 0 120 120"
    strokeWidth={2.6}
    role="img"
    aria-label="An empty tray"
  >
    {/* tray: back rim, front rim and sides */}
    <path d="M18.4 62.6c27.6-1.4 55.6-1.6 83.4-.4" />
    <path d="M14.2 76.4c30.4 1.2 61 1 91.4-.6" />
    <path d="M18.4 62.6c-1.6 4.6-3 9.2-4.2 13.8M101.8 62.2c1.4 4.4 2.6 9 3.8 13.6" />
    {/* base */}
    <path d="M14.2 76.4c.6 7.2 1.8 14.2 3.6 21 28.2 1.4 56.4 1.2 84.4-.4 1.6-6.8 2.8-13.8 3.4-20.8" />
    {/* inner floor line */}
    <path d="M30.2 87.4c19.8.8 39.8.6 59.6-.4" strokeWidth={1.8} />
    {/* dust puffs */}
    <path d="M46.4 46.6c1.2-4.4 6.4-5.2 8.6-1.8M64.2 42.8c2.4-3.6 7.4-2.4 7.8 1.6" strokeWidth={1.8} />
    <Sparkle x={88} y={30} r={6.4} tilt={10} />
    <Sparkle x={30} y={34} r={4} tilt={-12} />
  </DoodleSvg>
);

export default EmptySection;
