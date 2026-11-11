import { DoodleSvg, Sparkle, Dot } from './doodle';

const ComingSoon = ({ size = 160 }: { size?: number }) => (
  <DoodleSvg
    width={size}
    height={size}
    viewBox="0 0 200 200"
    strokeWidth={2.4}
    role="img"
    aria-label="An hourglass"
  >
    {/* top and bottom caps */}
    <path d="M61.4 47.6c25.8-2.4 52-2.8 77.6.6" strokeWidth={6} />
    <path d="M61.8 153.4c26.2 2 51.8 1.8 77.2-1" strokeWidth={6} />
    {/* side posts */}
    <path d="M66.4 50.8c-.8 33.6-.4 67.4 1 100.6" />
    <path d="M134.2 51c1.2 33.4.8 66.8-.6 100.2" />

    {/* glass */}
    <path d="M76.2 51.6c-1.2 18.6 6.8 32.2 21.4 47.6-15.2 14.8-22.8 30.8-21 51.6M124.6 51.2c1.6 19.4-6.2 33.2-21.2 48.4 14.6 14.4 21.4 30.4 20.4 51" />
    {/* sand on top */}
    <path
      fill="currentColor"
      d="M83.6 71.8c10.6 3.6 23.6 3.2 33.4-.8-3.4 9.8-9.4 17.6-16.6 25.2-7.6-7.2-13.6-14.6-16.8-24.4z"
    />
    {/* falling grains */}
    <Dot x={100.4} y={106} r={1.6} />
    <Dot x={99.8} y={113} r={1.6} />
    <Dot x={100.6} y={120} r={1.6} />
    {/* sand pile at the bottom */}
    <path
      fill="currentColor"
      d="M80.2 149.6c3.8-12.2 11.4-20.2 20.4-23.8 9.2 3.4 16.4 11.6 20 23.6-13.6 1.6-27 1.6-40.4.2z"
    />

    {/* motion squiggles */}
    <path d="M150 88c4.2-2.2 6.8.6 5.4 3.6-1.4 3.2 1.6 5.6 5.6 3.4" strokeWidth={1.8} />
    <path d="M48 112c-3.8 1.8-6.4-.8-5.2-3.6 1.2-3-1.4-5.4-5.2-3.6" strokeWidth={1.8} />

    {/* sparkles */}
    <Sparkle x={156} y={44} r={10} tilt={8} />
    <Sparkle x={40} y={62} r={7} tilt={-12} />
    <Sparkle x={160} y={150} r={6} tilt={4} />
    <Dot x={176} y={70} />
    <Dot x={30} y={150} r={1.8} />
    <Dot x={48} y={30} r={1.6} />
    <path d="M24 178c22-1.8 46 1.2 68-.4 24-1.6 56 .8 84-.8" strokeWidth={2} />
  </DoodleSvg>
);

export default ComingSoon;
