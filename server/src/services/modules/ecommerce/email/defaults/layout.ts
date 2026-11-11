/**
 * Shared building blocks for the default e-mail templates.
 *
 * Output is template source (engine tags included), not rendered HTML. Table-based layout with
 * inline styles for Outlook/Gmail, 600 px max width, one <style> @media block for small screens.
 * Keep every string free of `on…=` attribute-like text and URL-scheme-like text: the template
 * validator rejects those.
 */

const FONT = "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const TEXT = `${FONT};font-size:15px;line-height:24px;color:#374151`;
const MUTED = `${FONT};font-size:13px;line-height:20px;color:#6b7280`;
const CELL = `${FONT};font-size:14px;line-height:20px;color:#374151;padding:10px 0;border-bottom:1px solid #e5e7eb`;

export const greeting = (): string =>
  `<p style="margin:0 0 16px;${TEXT}">Hi {{customer.firstName}},</p>`;

export const heading = (text: string): string =>
  `<h1 style="margin:0 0 20px;${FONT};font-size:22px;line-height:30px;font-weight:700;color:#111827">${text}</h1>`;

export const paragraph = (text: string): string => `<p style="margin:0 0 16px;${TEXT}">${text}</p>`;

export const note = (text: string): string => `<p style="margin:0 0 16px;${MUTED}">${text}</p>`;

/** Brand-coloured call-to-action, shown only when `linkPath` has a value. */
export const button = (linkPath: string, label: string): string =>
  `{{#if ${linkPath}}}
<table role="presentation" class="ltb-btn" border="0" cellpadding="0" cellspacing="0" style="margin:8px 0 24px">
  <tr>
    <td align="center" bgcolor="{{store.brandColor}}" style="border-radius:6px;background-color:{{store.brandColor}}">
      <a href="{{${linkPath}}}" target="_blank" style="display:inline-block;padding:14px 28px;${FONT};font-size:16px;line-height:20px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:6px">${label}</a>
    </td>
  </tr>
</table>
{{/if}}`;

/** Highlighted box (payment instructions, credit code…). */
export const callout = (content: string): string =>
  `<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="margin:0 0 24px">
  <tr>
    <td style="padding:16px 20px;background-color:#f9fafb;border:1px solid #e5e7eb;border-left:4px solid {{store.brandColor}};border-radius:6px;${TEXT}">${content}</td>
  </tr>
</table>`;

/** Label/value rows. Pass `when` to show a row only when that variable has a value. */
export const details = (rows: { label: string; value: string; when?: string; strong?: boolean }[]): string =>
  `<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="margin:0 0 24px">
${rows
  .map(({ label, value, when, strong }) => {
    const weight = strong ? ';font-weight:700;color:#111827' : '';
    const row = `  <tr>
    <td style="${CELL}${weight}">${label}</td>
    <td align="right" style="${CELL}${weight}">${value}</td>
  </tr>`;
    return when ? `{{#if ${when}}}\n${row}\n{{/if}}` : row;
  })
  .join('\n')}
</table>`;

/** Items list (name, option, SKU, quantity) for shipment-like lists. */
export const itemList = (listPath: string, title: string): string =>
  `<p style="margin:0 0 8px;${FONT};font-size:14px;line-height:20px;font-weight:700;color:#111827">${title}</p>
<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="margin:0 0 24px">
{{#each ${listPath}}}
  <tr>
    <td style="${CELL}">{{this.name}}{{#if this.option}} <span style="color:#6b7280">({{this.option}})</span>{{/if}}<br><span style="${MUTED}">SKU {{this.sku}}</span></td>
    <td align="right" style="${CELL};white-space:nowrap">&times; {{this.quantity}}</td>
  </tr>
{{/each}}
</table>`;

/** Full e-mail wrapper: header with logo (or store name), white card, footer. */
export const layout = (preheader: string, body: string): string =>
  `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<title>{{store.name}}</title>
<style>
@media screen and (max-width: 620px) {
  .ltb-container { width: 100% !important; }
  .ltb-pad { padding-left: 20px !important; padding-right: 20px !important; }
  .ltb-btn { width: 100% !important; }
  .ltb-btn a { display: block !important; }
}
</style>
</head>
<body style="margin:0;padding:0;background-color:#f3f4f6">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${preheader}</div>
<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" bgcolor="#f3f4f6" style="background-color:#f3f4f6">
  <tr>
    <td align="center" style="padding:32px 12px">
      <table role="presentation" class="ltb-container" width="600" border="0" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px">
        <tr>
          <td align="center" class="ltb-pad" style="padding:0 40px 24px">
            {{#if store.logoUrl}}<img src="{{store.logoUrl}}" alt="{{store.name}}" height="48" style="display:block;height:48px;width:auto;max-width:240px;border:0;outline:none;text-decoration:none">{{else}}<span style="${FONT};font-size:24px;line-height:32px;font-weight:700;color:{{store.brandColor}}">{{store.name}}</span>{{/if}}
          </td>
        </tr>
        <tr>
          <td class="ltb-pad" bgcolor="#ffffff" style="padding:40px;background-color:#ffffff;border-radius:8px;border-top:4px solid {{store.brandColor}}">
${body}
            <p style="margin:24px 0 0;${TEXT}">Thank you,<br>The {{store.name}} team</p>
          </td>
        </tr>
        <tr>
          <td align="center" class="ltb-pad" style="padding:24px 40px 0;${MUTED}">
            {{#if store.supportEmail}}<p style="margin:0 0 8px;${MUTED}">Questions? Contact us at <a href="mailto:{{store.supportEmail}}" style="color:#6b7280;text-decoration:underline">{{store.supportEmail}}</a>.</p>{{/if}}
            <p style="margin:0;${MUTED}">{{#if store.url}}<a href="{{store.url}}" target="_blank" style="color:#6b7280;text-decoration:underline">{{store.name}}</a>{{else}}{{store.name}}{{/if}}</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;

/** Tracking references of every shipment of the order (several shipments only). */
export const allTrackingList = (): string =>
  `<p style="margin:0 0 8px;${FONT};font-size:14px;line-height:20px;font-weight:700;color:#111827">Tracking for each shipment</p>
<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="margin:0 0 24px">
{{#each shipment.allTracking}}
  <tr>
    <td style="${CELL}">{{this.carrier}}</td>
    <td align="right" style="${CELL}">{{#if this.trackingUrl}}<a href="{{this.trackingUrl}}" target="_blank" style="color:#374151;text-decoration:underline">{{this.trackingCode}}</a>{{else}}{{this.trackingCode}}{{/if}}</td>
  </tr>
{{/each}}
</table>`;
