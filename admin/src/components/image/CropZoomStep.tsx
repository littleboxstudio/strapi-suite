import { useEffect, useMemo, useRef, useState } from 'react';
import { useIntl } from 'react-intl';
import styled from 'styled-components';
import { Box, Field, Flex, IconButton, TextInput, Typography } from '@strapi/design-system';
import { ArrowsHorizontal, ArrowsOut, ArrowsVertical, Link } from '@strapi/icons';
import { getTranslation } from '../../core/utils/getTranslation';
import {
  MAX_CROP_DIMENSION,
  isUpscale,
  lockedHeight,
  type CropTransform,
  type Size,
} from '../../core/utils/imageCrop';
import {
  centerImage,
  coverImage,
  covers as coversFrame,
  fillFrame,
  fitHeight,
  fitWidth,
  frameIn,
  isDeformed,
  rescaleForFrame,
  toSourceCrop,
  zoomAt,
  zoomLevel,
  zoomLimits,
  type Box as CropBox,
} from '../../core/utils/cropEditor';
import { isValidDimension, parseDimension } from '../../ecommerce/utils/imageUpload';
import { CropEditor } from './CropEditor';

export type CropZoomState = {
  transform: CropTransform | null;
  covers: boolean;
  upscale: boolean;
  deformed: boolean;
};

type Props = {
  src: string;
  natural: Size;
  size: Size;
  sizeLocked: boolean;
  onSizeChange: (size: Size) => void;
  onChange: (state: CropZoomState) => void;
  disabled?: boolean;
  /** Fill the remaining height of a full-screen modal (the editor grows). */
  fill?: boolean;
  /** Text floating at the editor's bottom-left corner (e.g. "Original: 6000 × 4500 px"). */
  info?: string;
};

/** Height of the design-system text inputs; the keep-proportion button matches it. */
const DIMENSION_INPUT_HEIGHT = '4rem';

/** Space between the viewport edge and the frame. */
const FRAME_PADDING = 24;
/** Zoom slider bounds as powers of ten of the zoom level (0.1× … 10×, logarithmic). */
const ZOOM_EXPONENT = 1;

/** Floats over the image (bottom-left), translucent so the image shows through. */
const InfoBadge = styled.div`
  position: absolute;
  left: 8px;
  bottom: 8px;
  padding: 4px 8px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.7);
  color: #32324d;
  font-size: 1.2rem;
  line-height: 1.6rem;
  pointer-events: none;
`;

const ZoomSlider = styled.input`
  flex: 1;
  min-width: 120px;
  accent-color: ${({ theme }) => theme.colors.primary600};
  cursor: pointer;

  &:disabled {
    cursor: not-allowed;
  }
`;

/** A frame with a cross at its centre: "centre the image". */
const CenterIcon = () => (
  <svg width="16" height="16" viewBox="0 0 32 32" fill="none" aria-hidden focusable={false}>
    <rect x="4" y="4" width="24" height="24" rx="2" stroke="currentColor" strokeWidth="2.5" />
    <path d="M16 10v12M10 16h12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
  </svg>
);

const sameBox = (a: CropBox, b: CropBox) =>
  a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

const clampDimension = (n: number) => Math.min(Math.max(n, 1), MAX_CROP_DIMENSION);

/**
 * The crop step: output width × height (with a keep-proportion toggle when the size is free) and the
 * crop editor, where the image is moved, resized (handles, may deform it) and zoomed under a fixed frame
 * of aspect width / height. Reports the transform, whether the image covers the frame (required),
 * whether it is deformed and whether the result is upscaled; the modal's CropFooter shows the warnings.
 */
const CropZoomStep = ({
  src,
  natural,
  size,
  sizeLocked,
  onSizeChange,
  onChange,
  disabled = false,
  fill = false,
  info,
}: Props) => {
  const { formatMessage } = useIntl();
  const t = (id: string, values?: Record<string, any>) =>
    formatMessage({ id: getTranslation(id) }, values);

  const [widthText, setWidthText] = useState(String(size.width));
  const [heightText, setHeightText] = useState(String(size.height));
  const [keepRatio, setKeepRatio] = useState(true);
  /** width / height kept while the proportion toggle is on. */
  const [ratio, setRatio] = useState(size.width / size.height);
  const [viewport, setViewport] = useState<Size | null>(null);
  const [image, setImage] = useState<CropBox | null>(null);

  /** A new size from the parent (new image, preset) replaces what is typed. */
  useEffect(() => {
    if (parseDimension(widthText) !== size.width || parseDimension(heightText) !== size.height) {
      setWidthText(String(size.width));
      setHeightText(String(size.height));
      setRatio(size.width / size.height);
    }
    // Only follow the parent's size; the typed text is the source while it is valid.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.width, size.height]);

  const width = parseDimension(widthText);
  const height = parseDimension(heightText);
  const sizeValid = isValidDimension(width) && isValidDimension(height);
  const frameWidth = sizeValid ? width : size.width;
  const frameHeight = sizeValid ? height : size.height;
  const viewportWidth = viewport?.width ?? 0;
  const viewportHeight = viewport?.height ?? 0;

  const frame = useMemo(
    () =>
      viewportWidth > 0 && viewportHeight > 0
        ? frameIn(
            { width: viewportWidth, height: viewportHeight },
            { width: frameWidth, height: frameHeight },
            FRAME_PADDING
          )
        : null,
    [viewportWidth, viewportHeight, frameWidth, frameHeight]
  );

  /** A new image starts covering the frame, centred; a changed frame keeps the user's framing. */
  const placed = useRef<{ src: string; frame: CropBox } | null>(null);
  useEffect(() => {
    if (!frame) return;
    const previous = placed.current;
    placed.current = { src, frame };
    if (!previous || previous.src !== src) {
      setImage(coverImage(frame, natural));
    } else if (!sameBox(previous.frame, frame)) {
      setImage((current) =>
        current ? rescaleForFrame(previous.frame, frame, current) : coverImage(frame, natural)
      );
    }
  }, [src, natural, frame]);

  const ready = !!frame && !!image;
  const covers = ready ? coversFrame(frame, image) : true;
  const deformed = ready ? isDeformed(image, natural) : false;
  const crop = ready ? toSourceCrop(frame, image, natural) : null;
  const upscale = !!crop && sizeValid && covers && isUpscale(crop, { width, height });
  const transform: CropTransform | null =
    sizeValid && crop && crop.width > 0 && crop.height > 0
      ? { mode: 'crop', width, height, crop }
      : null;

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const key = transform ? JSON.stringify(transform) : '';
  useEffect(() => {
    onChangeRef.current({ transform, covers, upscale, deformed });
    // `key` stands for `transform` (a new object on every render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, covers, upscale, deformed]);

  const changeWidth = (value: string) => {
    setWidthText(value);
    const next = parseDimension(value);
    if (!isValidDimension(next)) return;
    if (keepRatio && !sizeLocked) {
      const other = clampDimension(lockedHeight(next, ratio));
      setHeightText(String(other));
      onSizeChange({ width: next, height: other });
    } else if (isValidDimension(height)) {
      onSizeChange({ width: next, height });
    }
  };

  const changeHeight = (value: string) => {
    setHeightText(value);
    const next = parseDimension(value);
    if (!isValidDimension(next)) return;
    if (keepRatio && !sizeLocked) {
      const other = clampDimension(lockedHeight(next, 1 / ratio));
      setWidthText(String(other));
      onSizeChange({ width: other, height: next });
    } else if (isValidDimension(width)) {
      onSizeChange({ width, height: next });
    }
  };

  const toggleKeepRatio = () => {
    const next = !keepRatio;
    setKeepRatio(next);
    if (next && sizeValid) setRatio(width / height);
  };

  const dimensionError = (text: string) =>
    !sizeLocked && text !== '' && !isValidDimension(parseDimension(text))
      ? t('image.crop.dimensionError')
      : undefined;

  const zoom = ready ? zoomLevel(frame, image, natural) : 1;
  const setZoom = (target: number) => {
    if (!frame || !image) return;
    const origin = { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 };
    setImage(zoomAt(image, target / zoom, origin, zoomLimits(frame, natural)));
  };

  const actions: { id: string; icon: JSX.Element; apply: (f: CropBox, i: CropBox) => CropBox }[] = [
    { id: 'image.crop.fitWidth', icon: <ArrowsHorizontal />, apply: fitWidth },
    { id: 'image.crop.fitHeight', icon: <ArrowsVertical />, apply: fitHeight },
    { id: 'image.crop.fillFrame', icon: <ArrowsOut />, apply: (f) => fillFrame(f) },
    { id: 'image.crop.center', icon: <CenterIcon />, apply: centerImage },
  ];

  const dimensionInput = (
    name: 'width' | 'height',
    text: string,
    change: (value: string) => void
  ) => (
    <Box style={{ flex: 1 }}>
      <Field.Root name={name} required={!sizeLocked} error={dimensionError(text)}>
        <Field.Label>{t(`image.crop.${name}`)}</Field.Label>
        <TextInput
          inputMode="numeric"
          value={text}
          disabled={disabled}
          readOnly={sizeLocked}
          onChange={(e: any) => change(e.target.value)}
        />
        <Field.Error />
      </Field.Root>
    </Box>
  );

  return (
    <Flex
      direction="column"
      alignItems="stretch"
      gap={4}
      style={fill ? { flex: 1, minHeight: 0 } : undefined}
    >
      <Flex gap={2} alignItems="flex-end">
        {dimensionInput('width', widthText, changeWidth)}
        {dimensionInput('height', heightText, changeHeight)}
        {!sizeLocked && (
          // Same height as the inputs, aligned with them (not with their label).
          <IconButton
            label={t('image.crop.keepProportion')}
            variant={keepRatio ? 'secondary' : 'tertiary'}
            aria-pressed={keepRatio}
            disabled={disabled}
            onClick={toggleKeepRatio}
            style={{ height: DIMENSION_INPUT_HEIGHT, width: DIMENSION_INPUT_HEIGHT }}
          >
            <Link />
          </IconButton>
        )}
      </Flex>

      {sizeLocked && (
        <Typography variant="pi" textColor="neutral600">
          {t('image.crop.locked')}
        </Typography>
      )}

      <CropEditor
        src={src}
        natural={natural}
        frame={frame}
        image={image}
        onViewportChange={setViewport}
        onImageChange={setImage}
        label={t('image.crop.editor')}
        disabled={disabled}
        fill={fill}
        overlay={info ? <InfoBadge>{info}</InfoBadge> : undefined}
      />

      <Flex gap={3} alignItems="center" wrap="wrap">
        <Flex gap={1}>
          {actions.map(({ id, icon, apply }) => (
            <IconButton
              key={id}
              label={t(id)}
              variant="tertiary"
              disabled={disabled || !ready}
              onClick={() => frame && image && setImage(apply(frame, image))}
            >
              {icon}
            </IconButton>
          ))}
        </Flex>
        <Flex gap={3} alignItems="center" style={{ flex: 1, minWidth: 220 }}>
          <Typography variant="pi" fontWeight="bold" tag="label" htmlFor="ltb-crop-zoom">
            {t('image.crop.zoom')}
          </Typography>
          <ZoomSlider
            id="ltb-crop-zoom"
            type="range"
            min={-ZOOM_EXPONENT}
            max={ZOOM_EXPONENT}
            step={0.01}
            value={Math.log10(zoom)}
            disabled={disabled || !ready}
            aria-valuetext={`${Math.round(zoom * 100)}%`}
            onChange={(e) => setZoom(10 ** Number(e.target.value))}
          />
          <Typography
            variant="pi"
            textColor="neutral600"
            style={{ minWidth: 48, textAlign: 'right' }}
          >
            {`${Math.round(zoom * 100)}%`}
          </Typography>
        </Flex>
      </Flex>

      <Typography variant="pi" textColor="neutral600">
        {t('image.crop.hint')}
      </Typography>
    </Flex>
  );
};

export { CropZoomStep };
