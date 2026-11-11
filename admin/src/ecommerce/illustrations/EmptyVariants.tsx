import { DoodleSvg, Sparkle, Dot } from './doodle';

/**
 * One clothing tag hanging from the string at (x, y).
 * `solid` draws a black tag with its eyelet punched out (even-odd fill).
 */
const Tag = ({
  x,
  y,
  tilt,
  solid = false,
  lines = 2,
}: {
  x: number;
  y: number;
  tilt: number;
  solid?: boolean;
  lines?: number;
}) => {
  const top = y + 22;
  const body = `M${x - 0.6} ${top}c6.3 5.4 13.4 11.2 20.6 17.6l-1.3 64.1c-13.4 1.3-26.7 1.1-39.6-.4l-.6-63.3c6.6-6.6 13.4-12.6 20.9-18z`;
  const eyelet = `M${x + 4.4} ${top + 14.6}a4.6 4.4 0 1 0-9.2.4 4.6 4.4 0 1 0 9.2-.4z`;

  return (
    <g transform={`rotate(${tilt} ${x} ${y})`}>
      {/* little loop of thread from the string to the eyelet */}
      <path d={`M${x} ${y}c-4.2 6.8-4.6 15.2-.6 ${top + 14.4 - y}`} strokeWidth={1.6} />
      {solid ? (
        <path fill="currentColor" fillRule="evenodd" d={`${body} ${eyelet}`} />
      ) : (
        <>
          <path d={body} />
          <path d={eyelet} strokeWidth={1.8} />
          {Array.from({ length: lines }).map((_, index) => (
            <path
              key={index}
              d={`M${x - 11} ${top + 38 + index * 12}c5.2-1.2 13.6-.8 ${index === lines - 1 ? 14.8 : 22.4} .4`}
              strokeWidth={2}
            />
          ))}
        </>
      )}
    </g>
  );
};

const EmptyVariants = ({ size = 160 }: { size?: number }) => (
  <DoodleSvg
    width={size}
    height={size}
    viewBox="0 0 200 200"
    strokeWidth={2.4}
    role="img"
    aria-label="Three clothing tags hanging on a string"
  >
    {/* string with its two pins */}
    <path d="M12.2 48.4C58.8 70.6 139.4 71.8 187.6 43.6" />
    <path
      fill="currentColor"
      d="M8.4 44.6c2.6-2.1 6.2-1.9 7.8.6 1.5 2.6.2 5.8-2.6 6.6-3 .8-6-.9-6.5-3.6-.2-1.4.3-2.7 1.3-3.6z"
    />
    <path
      fill="currentColor"
      d="M184.6 40.2c2.7-1.8 6.3-1.2 7.6 1.4 1.3 2.7-.2 5.8-3.1 6.4-3 .6-5.8-1.3-6.1-4-.1-1.5.4-2.9 1.6-3.8z"
    />

    <Tag x={53} y={60.3} tilt={6} lines={3} />
    <Tag x={100} y={64} tilt={-2} solid />
    <Tag x={147} y={58.7} tilt={-7} lines={2} />

    {/* sparkles and doodles */}
    <Sparkle x={22} y={180} r={7} tilt={-10} />
    <Sparkle x={182} y={178} r={9} tilt={6} />
    <Sparkle x={100} y={26} r={6} tilt={4} />
    <Dot x={70} y={28} />
    <Dot x={130} y={22} r={1.7} />
    <Dot x={16} y={118} r={1.8} />
    <path d="M92 188c3.2-3.4 6.8-3 8 .2 1.2 3.2 4.8 3.4 7.4.2" strokeWidth={1.8} />
    <path d="M186 98c2 2.6 2.4 5.8.8 8.6" strokeWidth={1.6} />
  </DoodleSvg>
);

export default EmptyVariants;
