import { DoodleSvg, Sparkle, Dot } from './doodle';

const EmptyOrders = ({ size = 160 }: { size?: number }) => (
  <DoodleSvg
    width={size}
    height={size}
    viewBox="0 0 200 200"
    strokeWidth={2.4}
    role="img"
    aria-label="An empty shopping bag"
  >
    {/* ground */}
    <path d="M16 176c24-2 46 1.4 68-.4s44-2.2 62-.4 30 .8 40-.8" />

    {/* bag body: slightly tapered, hand-drawn sides */}
    <path d="M52.6 70.4c31.8-1.2 63.4-1.4 95.2-.2l6.8 101.2c-36.4 1.6-72.8 1.6-109.2.2l7.2-101.2z" />
    {/* solid fold band at the top of the bag */}
    <path
      fill="currentColor"
      d="M52.8 70.6c31.6-1.2 63.2-1.2 94.8-.2l.8 12.2c-32 .8-64 .8-96.2 0l.6-12z"
    />
    {/* handles */}
    <path d="M78.2 70.6c-.8-18.4 8.6-30.6 22.2-30.8 13.8-.2 23 11.8 22.2 30.4" />
    <path d="M86.4 70.2c-.2-12.2 5.2-20.4 14-20.4 8.8 0 14.2 8.4 13.8 20.6" strokeWidth={1.6} />

    {/* nothing inside: a dashed empty-tag */}
    <path
      d="M86.6 112.4c9.4-.6 18.6-.6 28 0l.4 24.8c-9.4.6-18.8.6-28.2 0l-.2-24.8z"
      strokeWidth={1.8}
      strokeDasharray="2 7"
    />
    <path d="M94.4 124.6c4-.2 8-.2 12 0" strokeWidth={1.8} />

    {/* sparkles and doodles */}
    <Sparkle x={160} y={44} r={10} tilt={-8} />
    <Sparkle x={34} y={60} r={7} tilt={10} />
    <Sparkle x={176} y={118} r={5} tilt={6} />
    <Dot x={30} y={120} />
    <Dot x={142} y={24} r={1.8} />
    <Dot x={184} y={80} r={1.6} />
    <path d="M24 30c2.6-4.4 6.4-4.6 7.6-.8 1.1 3.6 5 3.5 7.2-.6" strokeWidth={1.8} />
    <path d="M172 150c1.6 3 1.2 6-1 8.4" strokeWidth={1.6} />
  </DoodleSvg>
);

export default EmptyOrders;
