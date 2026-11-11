import { DoodleSvg, Sparkle, Dot } from './doodle';

const EmptyCustomerOrders = ({ size = 140 }: { size?: number }) => (
  <DoodleSvg
    width={size}
    height={size}
    viewBox="0 0 200 200"
    strokeWidth={2.4}
    role="img"
    aria-label="An empty receipt"
  >
    {/* ground */}
    <path d="M22 180c22-2 42 1.2 62-.4s40-2 58-.4 26 .6 36-.8" />

    {/* receipt: straight top, torn zigzag bottom */}
    <path d="M58.4 30.6c27.8-1.4 55.6-1.6 83.4-.4l1.4 128.2-7.6 7.4-7.8-7.2-7.6 7.6-7.8-7.4-7.6 7.6-7.8-7.6-7.6 7.4-7.8-7.4-7.6 7.6-7.6-7.6-7.4 7.2.4-129.4z" />
    {/* solid header band */}
    <path
      fill="currentColor"
      d="M70.2 44.6c19.8-.8 39.8-.8 59.6-.2l.2 12.6c-20 .6-40 .6-60 0l.2-12.4z"
    />
    {/* blank item lines, drawn as dashes */}
    <path d="M70.6 78.4c19.4-.4 38.8-.4 58.4 0" strokeWidth={1.8} strokeDasharray="2 8" />
    <path d="M70.6 94.2c19.4-.4 38.8-.4 58.4 0" strokeWidth={1.8} strokeDasharray="2 8" />
    <path d="M70.6 110c19.4-.4 38.8-.4 58.4 0" strokeWidth={1.8} strokeDasharray="2 8" />
    {/* total line with an empty amount */}
    <path d="M69.8 128.6c20-.8 40-.8 60 0" strokeWidth={1.6} />
    <path d="M70.6 141.2c8-.4 16-.4 24 0" strokeWidth={2} />
    <path d="M110.4 136.4c6.4-.4 12.6-.4 18.8.2l-.2 9.4c-6.2.4-12.4.4-18.6 0l0-9.6z" strokeWidth={1.8} />

    {/* sparkles and doodles */}
    <Sparkle x={162} y={52} r={10} tilt={-6} />
    <Sparkle x={36} y={70} r={7} tilt={10} />
    <Sparkle x={166} y={128} r={5} tilt={6} />
    <Dot x={38} y={124} />
    <Dot x={178} y={90} r={1.8} />
    <Dot x={150} y={20} r={1.6} />
    <path d="M24 38c2.6-4.4 6.4-4.6 7.6-.8 1.1 3.6 5 3.5 7.2-.6" strokeWidth={1.8} />
  </DoodleSvg>
);

export default EmptyCustomerOrders;
