/**
 * PDF download response: the bytes go straight to the client (never stored), as an attachment,
 * and are not cacheable. The filename is already sanitised by the service.
 */
export const sendPdf = (ctx: any, doc: { filename: string; content: Buffer }) => {
  const safe = doc.filename.replace(/[^A-Za-z0-9._-]/g, '_') || 'document.pdf';
  ctx.type = 'application/pdf';
  ctx.set('Content-Disposition', `attachment; filename="${safe}"`);
  ctx.set('Cache-Control', 'private, no-store');
  ctx.body = doc.content;
};
