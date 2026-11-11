import { DoodleSvg, Sparkle, Dot } from './doodle';

const EmptyCustomers = ({ size = 160 }: { size?: number }) => (
  <DoodleSvg
    width={size}
    height={size}
    viewBox="0 0 200 200"
    strokeWidth={2.4}
    role="img"
    aria-label="Two simple people side by side"
  >
    {/* ground */}
    <path d="M14 174c24-2.2 46 1.4 68-.4s44-2.4 64-.4 30 .8 42-.8" />

    {/* person on the left: solid head and body */}
    <path
      fill="currentColor"
      d="M70.4 62.6c10.8-.4 18.6 7.4 18.4 18-.2 10.4-8.2 17.8-18.6 17.6-10.2-.2-17.6-8-17.4-18 .2-10 7.4-17.2 17.6-17.6z"
    />
    <path
      fill="currentColor"
      d="M38.6 171.4c-1.4-23.8 3.6-45.6 17.8-56.2 9-6.6 22.6-6.8 31.6-.4 14.4 10.2 19.6 32.6 18.4 56.4-22.4 1.6-45.2 1.6-67.8.2z"
    />

    {/* person on the right: outline only, slightly smaller */}
    <path d="M133.8 74.4c9.4-.6 16.4 6.2 16.4 15.4 0 9-6.8 15.6-15.8 15.8-9 .2-15.8-6.4-16-15.2-.2-8.8 6.4-15.6 15.4-16z" />
    <path d="M107.6 171.2c-1-20.6 3-39.4 15-48.6 7.8-5.8 19.6-6 27.4-.4 12.4 9 16.8 28.4 15.8 49-19.4 1.4-38.8 1.4-58.2 0z" />
    {/* collar and a little button line */}
    <path d="M127.2 120.4c3.6 4.2 10.6 4.4 14.6.2" strokeWidth={1.6} />
    <path d="M135.6 132.6l.4 28" strokeWidth={1.6} strokeDasharray="1 7" />

    {/* sparkles and doodles */}
    <Sparkle x={104} y={42} r={10} tilt={-6} />
    <Sparkle x={178} y={62} r={7} tilt={8} />
    <Sparkle x={24} y={78} r={6} tilt={12} />
    <Dot x={156} y={36} />
    <Dot x={40} y={44} r={1.8} />
    <Dot x={186} y={120} r={1.6} />
    <path d="M118 26c2.6-4.4 6.4-4.6 7.6-.8 1.1 3.6 5 3.5 7.2-.6" strokeWidth={1.8} />
    <path d="M14 128c1.6 3 1.2 6-1 8.4" strokeWidth={1.6} />
  </DoodleSvg>
);

export default EmptyCustomers;
