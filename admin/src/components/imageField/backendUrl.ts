import { absoluteUrl } from './imageFieldValue';

/** The Strapi server's url, as the admin knows it (empty when the admin is served by it). */
const backendURL = (): string =>
  typeof window !== 'undefined' ? ((window as any).strapi?.backendURL ?? '') : '';

/** A Media Library url ready for an `<img>` (relative local-provider urls are prefixed). */
export const mediaSrc = (url: string | null | undefined): string | null =>
  absoluteUrl(url, backendURL());
