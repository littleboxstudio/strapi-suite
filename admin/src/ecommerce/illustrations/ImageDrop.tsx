import styled from 'styled-components';
import { DoodleSvg, Sparkle, Dot } from './doodle';

/** Paper colour of the front photo: follows the theme, so it hides the back photo in dark mode too. */
const Paper = styled.path`
  fill: ${({ theme }) => theme.colors.neutral0};
`;

/** A hand-drawn photo with a mountain and a solid sun, an arrow dropping into it, and sparkles. */
const ImageDrop = ({ size = 120 }: { size?: number }) => (
  <DoodleSvg
    width={size}
    height={size}
    viewBox="0 0 200 200"
    strokeWidth={2.4}
    role="img"
    aria-label="A photo with an arrow dropping into it"
  >
    {/* back photo, tilted, solid */}
    <path
      fill="currentColor"
      d="M52.6 78.2c26.4-6.8 53.2-12.4 80.4-17.2l12.6 64.2c-27 5.6-53.8 10.6-80.8 15.4L52.6 78.2z"
    />
    {/* front photo frame */}
    <Paper d="M40.4 92.6c31.6-1.8 63.4-2.6 95.2-2.2l.8 70.4c-31.8.8-63.4.4-95.4-.8l-.6-67.4z" />
    <path d="M40.4 92.6c31.6-1.8 63.4-2.6 95.2-2.2l.8 70.4c-31.8.8-63.4.4-95.4-.8l-.6-67.4z" />
    {/* inner border */}
    <path d="M49.2 101.4c25.8-1 51.8-1.4 77.8-1.2l.4 51.6c-26 .6-51.8.4-77.6-.6l-.6-49.8z" strokeWidth={1.6} />
    {/* mountains */}
    <path d="M51.4 146.2c8.6-11.2 17.4-21.8 26.6-31.4 7.4 8.4 14.4 17.4 21.2 26.8" />
    <path d="M90.6 131.4c5.8-6.8 11.6-13 17.8-18.8 6.6 9.8 12.8 20.2 18.4 31.2" />
    {/* sun */}
    <path
      fill="currentColor"
      d="M66.8 108.6c3.8-2.6 9-1.6 11.4 2.2 2.4 3.6 1.2 8.6-2.6 11-3.8 2.4-8.8 1.2-11.2-2.6-2.2-3.6-1.2-8.2 2.4-10.6z"
    />
    {/* arrow dropping in */}
    <path d="M152.2 22.4c-.6 18.2-.2 36.6 1.2 55" strokeWidth={3} />
    <path d="M139.4 64.8c4.8 4.6 9.4 9.4 14 14.6 4.2-5.4 8.8-10.6 13.6-15.4" strokeWidth={3} />
    {/* motion squiggles */}
    <path d="M168.4 30.6c3.4 3.2 3.6 7.4.6 10.8" strokeWidth={1.8} />
    <path d="M136.2 34.2c-3.4 3.6-3.2 7.8.2 11" strokeWidth={1.8} />
    {/* decoration */}
    <Sparkle x={30} y={56} r={9} tilt={-8} />
    <Sparkle x={176} y={102} r={6} tilt={12} />
    <Sparkle x={160} y={170} r={4.5} />
    <Dot x={24} y={130} />
    <Dot x={186} y={136} r={1.8} />
    <Dot x={112} y={40} r={1.8} />
  </DoodleSvg>
);

export default ImageDrop;
