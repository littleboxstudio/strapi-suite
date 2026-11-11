import { DoodleSvg, Sparkle, Dot } from './doodle';

const EmptyShipping = ({ size = 160 }: { size?: number }) => (
  <DoodleSvg
    width={size}
    height={size}
    viewBox="0 0 200 200"
    strokeWidth={2.4}
    role="img"
    aria-label="A parcel and a little delivery truck"
  >
    {/* ground */}
    <path d="M12 174c24-2.4 46 1.2 70-.6s44-2 64-.2 30 .6 42-1" />

    {/* parcel: front face, side face and lid */}
    <path d="M22.4 104.2c22.6-1.6 45.2-2 67.8-1.6l1.6 67.4c-23.4 1.4-47 1.4-70.6.4l1.2-66.2z" />
    <path d="M90.2 102.6c6.4-5 12.8-9.8 19.6-14.6l1.4 66.2c-6.2 5.4-12.6 10.6-19.4 15.8" />
    <path d="M22.4 104.2c6.6-5.2 13.4-10.2 20.4-15.2 22.4-.8 44.6-1.2 67-1" />
    {/* solid tape down the front and across the lid */}
    <path
      fill="currentColor"
      d="M50.6 103.4c4-.2 8-.2 12 0l.6 67c-4.2.2-8.4.2-12.6 0l0-67z"
    />
    <path d="M54.6 103.2c6.2-4.8 12.4-9.6 18.8-14.4M62.4 103.4c6.4-4.8 12.6-9.6 19-14.6" strokeWidth={1.8} />
    {/* "this side up" arrows on the side face */}
    <path d="M97.6 128.4l.2-12.6m-3.4 3.6 3.4-3.8 3.2 3.4" strokeWidth={1.6} />
    <path d="M104.2 123.2l.2-12.4m-3.4 3.6 3.4-3.8 3.2 3.4" strokeWidth={1.6} />

    {/* little truck: solid cargo box */}
    <path
      fill="currentColor"
      d="M134.2 131.4c11.6-.8 23.4-.8 35-.2l.4 32.6c-11.8.4-23.6.4-35.4 0l0-32.4z"
    />
    {/* cab with its window */}
    <path d="M169.6 140.6c5.6-.2 10.4.2 13.8 1.2 2.6 4.8 4.6 10 5.8 15.6l-.2 6.4c-6.4.4-12.8.4-19.2 0" />
    <path d="M173.6 145.2c2.6-.2 5.2 0 7.4.4 1.2 2.6 2.2 5.2 2.8 7.8-3.4.4-6.8.4-10.2.2l0-8.4z" strokeWidth={1.8} />
    {/* wheels */}
    <circle cx={145.4} cy={166.6} r={6.2} />
    <circle cx={178.6} cy={166.8} r={6.2} />
    <Dot x={145.4} y={166.6} r={1.8} />
    <Dot x={178.6} y={166.8} r={1.8} />
    {/* speed lines behind the truck */}
    <path d="M118.4 138.6c3.6-.4 7.4-.4 10.8 0" strokeWidth={1.8} />
    <path d="M114.6 148.4c4.6-.4 9.4-.4 14.4 0" strokeWidth={1.8} />
    <path d="M119.8 157.8c3.2-.2 6.2-.2 9.2.2" strokeWidth={1.8} />

    {/* sparkles and doodles */}
    <Sparkle x={150} y={56} r={10} tilt={-6} />
    <Sparkle x={28} y={60} r={7} tilt={10} />
    <Sparkle x={184} y={104} r={6} tilt={6} />
    <Dot x={126} y={40} />
    <Dot x={176} y={32} r={1.8} />
    <Dot x={56} y={36} r={1.6} />
    <path d="M78 52c2.6-4.4 6.4-4.6 7.6-.8 1.1 3.6 5 3.5 7.2-.6" strokeWidth={1.8} />
  </DoodleSvg>
);

export default EmptyShipping;
