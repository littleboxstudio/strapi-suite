/**
 * Editing an e-mail template's texts in its preview. The template source is split into parts: the
 * fixed texts (editable), the variables shown in the text (`{{path}}`, not editable) and everything
 * else (tags, blocks, comments) kept as written. Joining the parts gives the source back exactly;
 * annotating them marks texts and variables with spans so the preview can find them.
 */

export type TemplatePart =
  | { kind: 'raw'; text: string }
  | { kind: 'text'; id: number; text: string }
  | { kind: 'var'; text: string };

/** Elements whose content is not shown as text (or is not HTML text at all). */
const NOT_TEXT = new Set(['head', 'style', 'script', 'title', 'textarea', 'template']);
/** Elements whose content is read verbatim up to their closing tag. */
const RAW_CONTENT = new Set(['style', 'script', 'title', 'textarea']);
/** Table structure: text there is moved out of the table by the browser, so it is never marked. */
const TABLE_STRUCTURE = new Set(['table', 'thead', 'tbody', 'tfoot', 'tr', 'colgroup']);
const VOID = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr',
]);

export const TEXT_ATTRIBUTE = 'data-ltb-text';
export const VARIABLE_ATTRIBUTE = 'data-ltb-var';

/** The end of the tag starting at `start` (index after `>`), skipping quoted attribute values. */
function tagEnd(html: string, start: number): number {
  let quote: string | null = null;
  for (let i = start + 1; i < html.length; i += 1) {
    const c = html[i];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '>') {
      return i + 1;
    }
  }
  return html.length;
}

/** Splits the template source into parts; `joinTemplate` of the result is the source. */
export function splitTemplate(html: string): TemplatePart[] {
  const parts: TemplatePart[] = [];
  const stack: string[] = [];
  let nextId = 0;
  const raw = (text: string) => {
    if (!text) return;
    const last = parts[parts.length - 1];
    if (last?.kind === 'raw') last.text += text;
    else parts.push({ kind: 'raw', text });
  };
  const textContext = () =>
    !stack.some((name) => NOT_TEXT.has(name)) && !TABLE_STRUCTURE.has(stack[stack.length - 1] ?? '');

  let i = 0;
  while (i < html.length) {
    if (html.startsWith('<!--', i)) {
      const end = html.indexOf('-->', i + 4);
      const stop = end < 0 ? html.length : end + 3;
      raw(html.slice(i, stop));
      i = stop;
      continue;
    }
    if (html.startsWith('{{', i)) {
      const end = html.indexOf('}}', i + 2);
      const stop = end < 0 ? html.length : end + 2;
      const tag = html.slice(i, stop);
      const inner = tag.slice(2, -2).trim();
      // Only a value shown in the text is a variable; blocks ({{#if}}, {{/each}}, {{else}}) stay raw.
      const isValue = end >= 0 && inner !== '' && !/^[#/]/.test(inner) && inner !== 'else';
      if (isValue && textContext()) parts.push({ kind: 'var', text: tag });
      else raw(tag);
      i = stop;
      continue;
    }
    if (html[i] === '<' && /[a-zA-Z/!?]/.test(html[i + 1] ?? '')) {
      const stop = tagEnd(html, i);
      const tag = html.slice(i, stop);
      raw(tag);
      i = stop;
      const match = /^<\/?\s*([a-zA-Z][a-zA-Z0-9-]*)/.exec(tag);
      if (!match) continue;
      const name = match[1].toLowerCase();
      if (tag.startsWith('</')) {
        const at = stack.lastIndexOf(name);
        if (at >= 0) stack.length = at;
      } else if (RAW_CONTENT.has(name)) {
        // Its content up to the closing tag is never text.
        const close = html.toLowerCase().indexOf(`</${name}`, i);
        const contentEnd = close < 0 ? html.length : close;
        raw(html.slice(i, contentEnd));
        i = contentEnd;
      } else if (!VOID.has(name) && !tag.endsWith('/>')) {
        stack.push(name);
      }
      continue;
    }
    // A run of text up to the next tag or template tag.
    let stop = i + 1;
    while (stop < html.length && html[stop] !== '<' && !html.startsWith('{{', stop)) stop += 1;
    const run = html.slice(i, stop);
    i = stop;
    const core = run.trim();
    if (!core || !textContext()) {
      raw(run);
      continue;
    }
    const lead = run.slice(0, run.indexOf(core));
    raw(lead);
    parts.push({ kind: 'text', id: nextId, text: core });
    nextId += 1;
    raw(run.slice(lead.length + core.length));
  }
  return parts;
}

/** The template source of the parts. */
export function joinTemplate(parts: TemplatePart[]): string {
  return parts.map((p) => p.text).join('');
}

/** The source with each text and variable wrapped in a marked span, for the editable preview. */
export function annotateTemplate(parts: TemplatePart[]): string {
  return parts
    .map((p) => {
      if (p.kind === 'text') return `<span ${TEXT_ATTRIBUTE}="${p.id}">${p.text}</span>`;
      if (p.kind === 'var') return `<span ${VARIABLE_ATTRIBUTE}="">${p.text}</span>`;
      return p.text;
    })
    .join('');
}

/**
 * A text typed in the preview as template source: HTML special characters escaped (it stays
 * text), non-breaking spaces kept, and `{{` broken so it never opens a template tag.
 */
export function encodeText(plain: string): string {
  return plain
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/ /g, '&nbsp;')
    .replace(/\{\{/g, '{&#123;');
}

/** The parts with text `id` replaced by `plain` (typed in the preview). */
export function replaceText(parts: TemplatePart[], id: number, plain: string): TemplatePart[] {
  return parts.map((p) => (p.kind === 'text' && p.id === id ? { ...p, text: encodeText(plain) } : p));
}
