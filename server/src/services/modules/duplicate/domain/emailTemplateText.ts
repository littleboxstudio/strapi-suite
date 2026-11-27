/**
 * Server copy of admin/src/ecommerce/utils/emailTextEditing.ts (the e-mail template editor's text
 * splitting and "Translate with AI" rules), for the duplication of customized templates, plus a DOM-free
 * HTML entity decoder (the admin decodes with the browser). Keep in step with the admin by hand.
 */
/*
 * The template source is split into parts: the fixed texts (translatable), the variables shown in the
 * text (`{{path}}`, kept) and everything else (tags, blocks, comments) kept as written. Joining the
 * parts gives the source back exactly.
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

/**
 * A text typed in the preview as template source: HTML special characters escaped (it stays
 * text), non-breaking spaces kept, and `{{` broken so it never opens a template tag.
 */
export function encodeText(plain: string): string {
  return plain
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\u00a0/g, '&nbsp;')
    .replace(/\{\{/g, '{&#123;');
}

/** The key of the subject among the strings sent for translation (texts use their id). */
export const SUBJECT_KEY = 'subject';

/** The strings to translate: the subject and every fixed text of the HTML, keyed. */
export function translationStrings(subject: string, parts: TemplatePart[]): Record<string, string> {
  const strings: Record<string, string> = {};
  if (subject.trim()) strings[SUBJECT_KEY] = subject;
  for (const p of parts) if (p.kind === 'text') strings[`t${p.id}`] = p.text;
  return strings;
}

/**
 * The template with its translated strings: the subject as returned, each text decoded (the
 * translation may return entities) and encoded again as text, so it can never add tags or template
 * tags. Strings missing from `translations` keep the source.
 */
export function applyTranslation(
  subject: string,
  parts: TemplatePart[],
  translations: Record<string, string>,
  decode: (html: string) => string
): { subject: string; html: string } {
  const translated = (key: string) => {
    const value = translations[key];
    return typeof value === 'string' && value.trim() ? value : null;
  };
  return {
    subject: translated(SUBJECT_KEY) ?? subject,
    html: joinTemplate(
      parts.map((p) => {
        if (p.kind !== 'text') return p;
        const value = translated(`t${p.id}`);
        return value === null ? p : { ...p, text: encodeText(decode(value).trim()) };
      })
    ),
  };
}

/** HTML 4 Latin-1 entity names, in code point order from U+00A0. */
const LATIN1 = (
  'nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn sup2 ' +
  'sup3 acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest Agrave Aacute Acirc ' +
  'Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ETH Ntilde Ograve ' +
  'Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig agrave aacute ' +
  'acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute icirc iuml eth ntilde ' +
  'ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml'
).split(' ');

export const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  ...Object.fromEntries(LATIN1.map((name, index) => [name, String.fromCodePoint(0xa0 + index)])),
  OElig: 'Œ',
  oelig: 'œ',
  Scaron: 'Š',
  scaron: 'š',
  Yuml: 'Ÿ',
  circ: 'ˆ',
  tilde: '˜',
  ensp: ' ',
  emsp: ' ',
  thinsp: ' ',
  zwnj: '‌',
  zwj: '‍',
  ndash: '–',
  mdash: '—',
  lsquo: '‘',
  rsquo: '’',
  sbquo: '‚',
  ldquo: '“',
  rdquo: '”',
  bdquo: '„',
  dagger: '†',
  Dagger: '‡',
  bull: '•',
  hellip: '…',
  permil: '‰',
  prime: '′',
  lsaquo: '‹',
  rsaquo: '›',
  euro: '€',
  trade: '™',
  larr: '←',
  rarr: '→',
  minus: '−',
};

/**
 * Decodes HTML character references without a DOM: the named entities above and decimal /
 * hexadecimal references, each with its `;`. Unknown names and invalid code points stay as written.
 */
export function decodeEntities(html: string): string {
  if (!html) return '';
  return html.replace(/&(#[xX][0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, ref: string) => {
    if (ref[0] === '#') {
      const code = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) {
        return match;
      }
      return String.fromCodePoint(code);
    }
    return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, ref) ? NAMED_ENTITIES[ref] : match;
  });
}
