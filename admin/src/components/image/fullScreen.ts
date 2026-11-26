import type { CSSProperties } from 'react';

/** Modal.Content style while an image is being cropped: the whole screen, for a bigger editor. */
export const FULL_SCREEN_MODAL: CSSProperties = {
  width: '100vw',
  height: '100vh',
  maxWidth: '100vw',
  maxHeight: '100vh',
  borderRadius: 0,
};

/** The crop page's body: fills the space between header and footer; scrolls only when too short. */
export const CROP_BODY: CSSProperties = { flex: 1, minHeight: 0, overflowY: 'auto' };
