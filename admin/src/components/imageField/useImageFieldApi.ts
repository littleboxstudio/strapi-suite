import { useFetchClient } from '@strapi/strapi/admin';
import config from '../../core/config';
import { imageErrorCode } from '../../ecommerce/utils/imageUpload';
import type { MediaValue } from './imageFieldValue';

/** Admin routes of the field (server/src/routes/image-field/admin-image-field.ts). */
const BASE = `/${config.pluginId}/image-field`;

/** HTTP status of a failed admin request (Strapi's FetchError), when known. */
export function errorStatus(err: unknown): number | null {
  const status = (err as any)?.status ?? (err as any)?.response?.status;
  return typeof status === 'number' ? status : null;
}

export { imageErrorCode };

export function useImageFieldApi() {
  const { post, put } = useFetchClient();
  return {
    /** Processes the source and creates the WebP result in the Media Library. */
    async upload(form: FormData): Promise<MediaValue> {
      const { data } = await post<{ data: MediaValue }>(`${BASE}/upload`, form);
      return data.data;
    },
    /** Updates the stored file's alt text (field-created files only). */
    async updateAlt(id: number, alternativeText: string | null): Promise<MediaValue> {
      const { data } = await put<{ data: MediaValue }>(`${BASE}/files/${id}/alt`, {
        alternativeText,
      });
      return data.data;
    },
  };
}
