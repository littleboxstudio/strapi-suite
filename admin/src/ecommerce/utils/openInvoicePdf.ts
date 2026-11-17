import FetchInvoicePdf from '../usecases/orders/fetchInvoicePdf';

/**
 * Opens an invoice or credit note PDF in a new tab (or downloads it when the tab was blocked).
 * The tab is opened before the request so the browser does not treat it as an unsolicited popup.
 * Rejects with the request error (the tab is closed).
 */
export async function openInvoicePdf(doc: { id: number; number: string | null }): Promise<void> {
  const win = window.open('', '_blank');
  if (win) win.opener = null;
  try {
    const blob = await new FetchInvoicePdf().execute(doc.id);
    const url = URL.createObjectURL(blob);
    if (win) {
      win.location.href = url;
    } else {
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(doc.number || `invoice-${doc.id}`).replace(/[^A-Za-z0-9._-]/g, '_')}.pdf`;
      a.click();
    }
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (err) {
    win?.close();
    throw err;
  }
}
