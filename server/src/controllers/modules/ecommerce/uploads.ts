import fs from 'fs';

/**
 * Deletes the temporary copies the body parser wrote for the uploaded files. The original is
 * never kept: only the processed image is stored. Errors are ignored (already gone).
 */
export async function removeTempUploads(files: unknown): Promise<void> {
  const list = Array.isArray(files) ? files : files ? [files] : [];
  await Promise.all(
    list.map((file: any) =>
      typeof file?.filepath === 'string'
        ? fs.promises.unlink(file.filepath).catch(() => undefined)
        : undefined
    )
  );
}
