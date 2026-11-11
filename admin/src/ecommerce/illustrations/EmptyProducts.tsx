import { DoodleSvg, Sparkle, Dot } from './doodle';

const EmptyProducts = ({ size = 160 }: { size?: number }) => (
  <DoodleSvg
    width={size}
    height={size}
    viewBox="0 0 200 200"
    strokeWidth={2.4}
    role="img"
    aria-label="A shopping bag and a t-shirt"
  >
    {/* ground */}
    <path d="M16 174c22-2.6 44 1.4 66-.6s42-2.2 62-.4 30 .8 40-.9" />

    {/* shopping bag, solid body */}
    <path
      fill="currentColor"
      d="M30.5 86.8c18.2-2.6 46.4-3.1 66.2-1.3l5.1 84.6c-24.4 2.3-50.6 2.1-76.2-.5l4.9-82.8z"
    />
    {/* handles */}
    <path d="M47.2 87.4c-2.4-17.8 3.1-31.6 15.8-31.9 12.1-.4 17.7 13.2 15.4 30.6" />
    <path d="M55.4 87c-.9-12.6 2.4-21.9 8.1-22.1" strokeWidth={1.6} />
    {/* bag rim */}
    <path d="M27.8 83.9c20.8-2.4 48.9-2.9 71.6-.6" />

    {/* t-shirt outline */}
    <path d="M128.6 70.4c4.6-1.6 8.8-2.9 12.9-4 2.4 7.9 18.3 8.7 22.4-.4 4.9 1.2 10.4 3.6 15.6 6.9l11.4 21.3c-4.3 3.6-9.6 5.6-15 6.1l-.8 66.9c-16.6 2.4-33.4 2.1-49.6-.3l1.3-66.3c-5.6-.4-10.8-2.6-14.8-6.4l16.6-23.8z" />
    {/* collar */}
    <path d="M141.7 66.9c3.3 6.3 15.4 6.6 21.8-.6" strokeWidth={1.6} />
    {/* sleeve seams */}
    <path d="M124.5 100c1.1-6.6 2.1-12.6 2.4-18.1" strokeWidth={1.6} />
    <path d="M174.9 100.6c-.6-6.2-1.6-12.1-1.4-17.5" strokeWidth={1.6} />
    {/* solid pocket */}
    <path
      fill="currentColor"
      d="M159.6 108.2c4.8-.6 9.4-.4 13.3.2l-.9 11.6c-4.3 2.4-8.6 2.1-12.6-.4l.2-11.4z"
    />
    {/* wavy stripe */}
    <path
      d="M125.7 139.6c6.4-3.8 11.8 3.5 17.9-.4 6.1-3.8 11.1 3.2 17.4-.2 5.6-3.1 10.2 2.6 14.5.4"
      strokeWidth={2}
    />

    {/* sparkles and doodles */}
    <Sparkle x={112} y={44} r={10} tilt={-6} />
    <Sparkle x={186} y={48} r={6} tilt={8} />
    <Sparkle x={20} y={62} r={7} tilt={12} />
    <Dot x={96} y={60} />
    <Dot x={176} y={30} r={1.8} />
    <Dot x={36} y={40} r={1.6} />
    <path d="M140 38c2.6-4.4 6.4-4.6 7.6-.8 1.1 3.6 5 3.5 7.2-.6" strokeWidth={1.8} />
    <path d="M10 120c1.6 3 1.2 6-1 8.4" strokeWidth={1.6} />
  </DoodleSvg>
);

export default EmptyProducts;
