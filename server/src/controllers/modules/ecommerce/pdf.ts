/**
 * PDF download response: the bytes go straight to the client (never stored), as an attachment,
 * and are not cacheable. The filename is reduced to a safe ASCII set (no CR/LF, quotes, slashes
 * or non-ASCII), never starts with a dot and always ends in .pdf.
 */
const safeFilename = (name: unknown): string => {
  let base = String(name ?? '')
    .replace(/\.pdf$/i, '')
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .replace(/^\.+/, '')
    .slice(0, 120);
  if (!base) base = 'document';
  return `${base}.pdf`;
};

export const sendPdf = (ctx: any, doc: { filename: string; content: Buffer }) => {
  ctx.type = 'application/pdf';
  ctx.set('Content-Disposition', `attachment; filename="${safeFilename(doc.filename)}"`);
  ctx.set('Cache-Control', 'private, no-store');
  ctx.body = doc.content;
};
