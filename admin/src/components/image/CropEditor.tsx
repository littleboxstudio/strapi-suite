import { useEffect, useRef, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import styled from 'styled-components';
import {
  HANDLES,
  resizeWithHandle,
  snapToCenter,
  zoomAt,
  zoomLimits,
  type Box,
  type Handle,
  type Point,
} from '../../core/utils/cropEditor';
import type { Size } from '../../core/utils/imageCrop';

export const CROP_EDITOR_HEIGHT = 320;
/** Smallest height of the editor when it fills the remaining space (full-screen modal). */
const MIN_FILL_HEIGHT = 240;

/** Distance (screen px) at which a dragged image snaps to the frame centre. */
const SNAP_THRESHOLD = 6;
const HANDLE_SIZE = 10;

type Props = {
  src: string;
  natural: Size;
  frame: Box | null;
  image: Box | null;
  onViewportChange: (viewport: Size) => void;
  onImageChange: (image: Box) => void;
  label: string;
  disabled?: boolean;
  /** Grow to fill the parent column instead of the fixed height. */
  fill?: boolean;
  /** Floating content drawn over the editor (e.g. the original's size). */
  overlay?: ReactNode;
};

type Gesture =
  | { kind: 'move'; start: Point; startImage: Box }
  | { kind: 'resize'; handle: Handle; start: Point; startImage: Box }
  | { kind: 'pinch'; distance: number; mid: Point; startImage: Box };

const Viewport = styled.div<{ $disabled: boolean; $fill: boolean }>`
  position: relative;
  ${({ $fill }) =>
    $fill ? `flex: 1; min-height: ${MIN_FILL_HEIGHT}px;` : `height: ${CROP_EDITOR_HEIGHT}px;`}
  overflow: hidden;
  border-radius: ${({ theme }) => theme.borderRadius};
  background: ${({ theme }) => theme.colors.neutral800};
  cursor: ${({ $disabled }) => ($disabled ? 'not-allowed' : 'move')};
  touch-action: none;
  user-select: none;

  &:focus-visible {
    outline: 2px solid ${({ theme }) => theme.colors.primary600};
    outline-offset: 2px;
  }
`;

const Layer = styled.div`
  position: absolute;
  pointer-events: none;
`;

const Picture = styled.img`
  position: absolute;
  max-width: none;
  pointer-events: none;
`;

/** The frame: outlined, with everything outside it darkened. */
const Frame = styled(Layer)`
  outline: 1px solid rgba(255, 255, 255, 0.9);
  box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.55);
`;

const Guide = styled(Layer)`
  background: ${({ theme }) => theme.colors.danger600};
`;

const Outline = styled(Layer)`
  border: 1px dashed rgba(255, 255, 255, 0.7);
`;

const HandleSquare = styled.div<{ $handle: Handle }>`
  position: absolute;
  width: ${HANDLE_SIZE}px;
  height: ${HANDLE_SIZE}px;
  margin: -${HANDLE_SIZE / 2}px 0 0 -${HANDLE_SIZE / 2}px;
  background: ${({ theme }) => theme.colors.neutral0};
  border: 1px solid ${({ theme }) => theme.colors.neutral500};
  pointer-events: auto;
  cursor: ${({ $handle }) => `${$handle}-resize`};
`;

const handlePosition = (handle: Handle) => ({
  left: handle.includes('w') ? '0%' : handle.includes('e') ? '100%' : '50%',
  top: handle.includes('n') ? '0%' : handle.includes('s') ? '100%' : '50%',
});

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const midpoint = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/**
 * The crop editor: the image under a fixed frame. Drag to move (snaps to the centre with red guides),
 * handles to resize (corners keep the proportion, edges stretch one axis), wheel / pinch to zoom at the
 * pointer, arrow keys to nudge (Shift = 10 px). Controlled: the parent owns the image box.
 */
const CropEditor = ({
  src,
  natural,
  frame,
  image,
  onViewportChange,
  onImageChange,
  label,
  disabled = false,
  fill = false,
  overlay,
}: Props) => {
  const viewportRef = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<Gesture | null>(null);

  /** Latest values for the native wheel listener and pointer handlers. */
  const latest = useRef({ frame, image, natural, disabled, onImageChange });
  latest.current = { frame, image, natural, disabled, onImageChange };

  const onViewportRef = useRef(onViewportChange);
  onViewportRef.current = onViewportChange;

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const report = () =>
      onViewportRef.current({ width: element.clientWidth, height: element.clientHeight });
    report();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(report);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  /** Wheel zoom at the cursor; ctrl + wheel is a trackpad pinch (finer deltas, faster factor). */
  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      const { frame: f, image: img, natural: n, disabled: off } = latest.current;
      if (off || !f || !img) return;
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const factor = Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.002));
      latest.current.onImageChange(
        zoomAt(
          img,
          factor,
          { x: event.clientX - rect.left, y: event.clientY - rect.top },
          zoomLimits(f, n)
        )
      );
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, []);

  const pointAt = (event: PointerEvent): Point => {
    const rect = viewportRef.current!.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const startMoveOrPinch = (img: Box) => {
    const points = [...pointers.current.values()];
    if (points.length >= 2) {
      gesture.current = {
        kind: 'pinch',
        distance: Math.max(1, distance(points[0], points[1])),
        mid: midpoint(points[0], points[1]),
        startImage: img,
      };
    } else if (points.length === 1) {
      gesture.current = { kind: 'move', start: points[0], startImage: img };
    } else {
      gesture.current = null;
    }
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (disabled || !image || !frame) return;
    viewportRef.current?.focus();
    viewportRef.current?.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, pointAt(event));
    if (gesture.current?.kind !== 'resize') startMoveOrPinch(image);
  };

  const onHandleDown = (handle: Handle) => (event: PointerEvent<HTMLDivElement>) => {
    if (disabled || !image || !frame) return;
    event.stopPropagation();
    viewportRef.current?.focus();
    viewportRef.current?.setPointerCapture(event.pointerId);
    const start = pointAt(event);
    pointers.current.set(event.pointerId, start);
    gesture.current = { kind: 'resize', handle, start, startImage: image };
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId) || !gesture.current || !frame) return;
    const point = pointAt(event);
    pointers.current.set(event.pointerId, point);
    const current = gesture.current;
    if (current.kind === 'move') {
      const moved = {
        ...current.startImage,
        x: current.startImage.x + point.x - current.start.x,
        y: current.startImage.y + point.y - current.start.y,
      };
      onImageChange(snapToCenter(frame, moved, SNAP_THRESHOLD).image);
    } else if (current.kind === 'resize') {
      onImageChange(
        resizeWithHandle(
          current.startImage,
          current.handle,
          point.x - current.start.x,
          point.y - current.start.y,
          true
        )
      );
    } else {
      const points = [...pointers.current.values()];
      if (points.length < 2) return;
      onImageChange(
        zoomAt(
          current.startImage,
          distance(points[0], points[1]) / current.distance,
          current.mid,
          zoomLimits(frame, natural)
        )
      );
    }
  };

  const onPointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.delete(event.pointerId)) return;
    if (gesture.current?.kind === 'resize' || !image) gesture.current = null;
    else startMoveOrPinch(image);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled || !image) return;
    const step = event.shiftKey ? 10 : 1;
    const delta: Record<string, Point> = {
      ArrowLeft: { x: -step, y: 0 },
      ArrowRight: { x: step, y: 0 },
      ArrowUp: { x: 0, y: -step },
      ArrowDown: { x: 0, y: step },
    };
    const move = delta[event.key];
    if (!move) return;
    event.preventDefault();
    onImageChange({ ...image, x: image.x + move.x, y: image.y + move.y });
  };

  const guides = frame && image ? snapToCenter(frame, image, 0.5) : null;
  const boxStyle = (box: Box) => ({
    left: box.x,
    top: box.y,
    width: box.width,
    height: box.height,
  });

  return (
    <Viewport
      ref={viewportRef}
      $disabled={disabled}
      $fill={fill}
      tabIndex={disabled ? -1 : 0}
      role="group"
      aria-label={label}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onKeyDown={onKeyDown}
    >
      {image && <Picture src={src} alt="" draggable={false} style={boxStyle(image)} />}
      {frame && <Frame style={boxStyle(frame)} />}
      {frame && guides?.centeredX && (
        <Guide
          style={{
            left: Math.round(frame.x + frame.width / 2),
            top: frame.y,
            width: 1,
            height: frame.height,
          }}
        />
      )}
      {frame && guides?.centeredY && (
        <Guide
          style={{
            left: frame.x,
            top: Math.round(frame.y + frame.height / 2),
            width: frame.width,
            height: 1,
          }}
        />
      )}
      {image && !disabled && (
        <Outline style={boxStyle(image)}>
          {HANDLES.map((handle) => (
            <HandleSquare
              key={handle}
              $handle={handle}
              style={handlePosition(handle)}
              onPointerDown={onHandleDown(handle)}
            />
          ))}
        </Outline>
      )}
      {overlay}
    </Viewport>
  );
};

export { CropEditor };
