/**
 * Minimal, logic-less e-mail template engine (Handlebars-like subset).
 *
 * Supported tags: `{{path}}`, `{{#each path}}…{{/each}}` (with `{{this}}`, `{{this.x}}`, `{{@index}}`),
 * `{{#if path}}…{{else}}…{{/if}}`. No helpers, no expressions, no code execution.
 * Values are HTML-escaped (plain-text mode, for subjects, opts out). Pure TypeScript: no Strapi imports.
 */
import { getVariableCatalog, type EmailTemplateType, type VariableDef } from './catalog';

export type TemplateIssue = { code: 'UNKNOWN_VARIABLE' | 'UNSAFE_HTML' | 'SYNTAX'; detail: string };

export class TemplateSyntaxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TemplateSyntaxError';
  }
}

type Node =
  | { type: 'text'; value: string }
  | { type: 'value'; path: string }
  | { type: 'index' }
  | { type: 'each'; path: string; children: Node[] }
  | { type: 'if'; path: string; then: Node[]; else: Node[] };

type Token =
  | { type: 'text'; value: string }
  | { type: 'value'; path: string }
  | { type: 'index' }
  | { type: 'open'; block: 'each' | 'if'; path: string }
  | { type: 'else' }
  | { type: 'close'; block: 'each' | 'if' }
  | { type: 'invalid'; detail: string };

const PATH = '[a-zA-Z_]\\w*(?:\\.[a-zA-Z_]\\w*)*';
const VALUE_RE = new RegExp(`^${PATH}$`);
const OPEN_RE = new RegExp(`^#(each|if)\\s+(${PATH})$`);
const CLOSE_RE = /^\/(each|if)$/;

function classify(inner: string): Token {
  if (inner.startsWith('{')) return { type: 'invalid', detail: 'Triple braces are not supported' };
  const body = inner.trim();
  if (body === 'else') return { type: 'else' };
  if (body === '@index') return { type: 'index' };
  if (VALUE_RE.test(body)) return { type: 'value', path: body };
  const open = OPEN_RE.exec(body);
  if (open) return { type: 'open', block: open[1] as 'each' | 'if', path: open[2] };
  const close = CLOSE_RE.exec(body);
  if (close) return { type: 'close', block: close[1] as 'each' | 'if' };
  return { type: 'invalid', detail: `Invalid tag "{{${inner}}}"` };
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let pos = 0;
  while (pos < source.length) {
    const start = source.indexOf('{{', pos);
    if (start === -1) {
      tokens.push({ type: 'text', value: source.slice(pos) });
      break;
    }
    if (start > pos) tokens.push({ type: 'text', value: source.slice(pos, start) });
    const end = source.indexOf('}}', start + 2);
    if (end === -1) {
      tokens.push({ type: 'invalid', detail: `Unclosed "{{" at position ${start}` });
      break;
    }
    let tagEnd = end + 2;
    // `{{{x}}}`: swallow the third closing brace so the whole tag is reported once
    if (source[start + 2] === '{' && source[tagEnd] === '}') tagEnd += 1;
    tokens.push(classify(source.slice(start + 2, end)));
    pos = tagEnd;
  }
  return tokens;
}

type Frame = { block: 'root' | 'each' | 'if'; node?: Node; target: Node[]; sawElse?: boolean };

/** Error-tolerant parser: always returns an AST plus the list of syntax errors found. */
function parse(source: string): { nodes: Node[]; errors: string[] } {
  const root: Node[] = [];
  const stack: Frame[] = [{ block: 'root', target: root }];
  const errors: string[] = [];
  const top = () => stack[stack.length - 1];

  for (const token of tokenize(source)) {
    switch (token.type) {
      case 'invalid':
        errors.push(token.detail);
        break;
      case 'text':
      case 'value':
      case 'index':
        top().target.push(token);
        break;
      case 'open': {
        const node: Node =
          token.block === 'each'
            ? { type: 'each', path: token.path, children: [] }
            : { type: 'if', path: token.path, then: [], else: [] };
        top().target.push(node);
        stack.push({
          block: token.block,
          node,
          target: node.type === 'each' ? node.children : (node as { then: Node[] }).then,
        });
        break;
      }
      case 'else': {
        const frame = top();
        if (frame.block !== 'if') errors.push('"{{else}}" outside of "{{#if}}"');
        else if (frame.sawElse) errors.push('Duplicate "{{else}}"');
        else {
          frame.sawElse = true;
          frame.target = (frame.node as { else: Node[] }).else;
        }
        break;
      }
      case 'close': {
        const frame = top();
        if (frame.block === token.block) stack.pop();
        else if (frame.block === 'root') errors.push(`Unexpected "{{/${token.block}}}"`);
        else errors.push(`"{{/${token.block}}}" closes an open "{{#${frame.block}}}"`);
        break;
      }
    }
  }
  for (let i = stack.length - 1; i > 0; i -= 1) errors.push(`Unclosed "{{#${stack[i].block}}}"`);
  return { nodes: root, errors };
}

// ---------------------------------------------------------------------------
// Rendering

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '`': '&#96;',
  '=': '&#61;',
};
const escapeHtml = (value: string) => value.replace(/[&<>"'`=]/g, (char) => ESCAPES[char]);

type Scope = { item: unknown; index: number };

function lookup(base: unknown, keys: string[]): unknown {
  let current = base;
  for (const key of keys) {
    if (current === null || typeof current !== 'object') return undefined;
    if (!Object.prototype.hasOwnProperty.call(current, key)) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function resolve(path: string, data: Record<string, unknown>, scopes: Scope[]): unknown {
  const keys = path.split('.');
  if (keys[0] === 'this') {
    if (scopes.length === 0) return undefined;
    return lookup(scopes[scopes.length - 1].item, keys.slice(1));
  }
  return lookup(data, keys);
}

function isTruthy(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'string') return value.length > 0;
  if (typeof value === 'number') return value !== 0 && !Number.isNaN(value);
  if (typeof value === 'boolean') return value;
  return value !== null && typeof value === 'object';
}

function stringify(value: unknown, escape: boolean): string {
  if (typeof value === 'string') return escape ? escapeHtml(value) : value;
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean') return String(value);
  return '';
}

function renderNodes(
  nodes: Node[],
  data: Record<string, unknown>,
  scopes: Scope[],
  escape: boolean
): string {
  let out = '';
  for (const node of nodes) {
    switch (node.type) {
      case 'text':
        out += node.value;
        break;
      case 'value':
        out += stringify(resolve(node.path, data, scopes), escape);
        break;
      case 'index':
        out += scopes.length ? String(scopes[scopes.length - 1].index) : '';
        break;
      case 'if':
        out += renderNodes(
          isTruthy(resolve(node.path, data, scopes)) ? node.then : node.else,
          data,
          scopes,
          escape
        );
        break;
      case 'each': {
        const items = resolve(node.path, data, scopes);
        if (!Array.isArray(items)) break;
        items.forEach((item, index) => {
          out += renderNodes(node.children, data, [...scopes, { item, index }], escape);
        });
        break;
      }
    }
  }
  return out;
}

export type RenderOptions = {
  /** HTML-escape values (default true). Use false only for plain-text output such as e-mail subjects. */
  escape?: boolean;
};

/** Renders a template. Throws TemplateSyntaxError if the template is malformed. */
export function renderTemplate(
  source: string,
  data: Record<string, unknown>,
  options: RenderOptions = {}
): string {
  const { nodes, errors } = parse(source);
  if (errors.length) throw new TemplateSyntaxError(errors[0]);
  return renderNodes(nodes, data, [], options.escape !== false);
}

// ---------------------------------------------------------------------------
// Variable extraction

export function extractVariables(
  source: string
): { path: string; kind: 'value' | 'each' | 'if' }[] {
  const seen = new Set<string>();
  const result: { path: string; kind: 'value' | 'each' | 'if' }[] = [];
  for (const token of tokenize(source)) {
    let entry: { path: string; kind: 'value' | 'each' | 'if' } | undefined;
    if (token.type === 'value') entry = { path: token.path, kind: 'value' };
    else if (token.type === 'open') entry = { path: token.path, kind: token.block };
    if (!entry) continue;
    const key = `${entry.kind}:${entry.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(entry);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Validation

const UNSAFE_PATTERNS: { re: RegExp; detail: string }[] = [
  { re: /<\s*\/?\s*script\b/i, detail: '<script> is not allowed' },
  { re: /<\s*\/?\s*iframe\b/i, detail: '<iframe> is not allowed' },
  { re: /<\s*\/?\s*object\b/i, detail: '<object> is not allowed' },
  { re: /<\s*\/?\s*embed\b/i, detail: '<embed> is not allowed' },
  { re: /<\s*\/?\s*form\b/i, detail: '<form> is not allowed' },
  { re: /<\s*meta\b[^>]*http-equiv/i, detail: '<meta http-equiv> is not allowed' },
  { re: /(?:^|[\s"'/;])on[a-z]+\s*=/i, detail: 'Event handler attributes (on*=) are not allowed' },
];

// Escaping cannot protect an unquoted attribute value (a space starts a new attribute). HTML only:
// subjects are plain text, where "Total = {{…}}" is harmless.
const UNQUOTED_ATTRIBUTE = /=\s*\{\{/;

/** Decodes numeric/named entities often used to obfuscate URL schemes, then strips whitespace/control chars. */
function normaliseForSchemes(html: string): string {
  return html
    .replace(/&#x([0-9a-f]+);?/gi, (_, hex: string) =>
      String.fromCodePoint(Math.min(parseInt(hex, 16), 0x10ffff))
    )
    .replace(/&#(\d+);?/g, (_, dec: string) =>
      String.fromCodePoint(Math.min(parseInt(dec, 10), 0x10ffff))
    )
    .replace(/&colon;/gi, ':')
    .replace(/&tab;|&newline;/gi, '')
    .replace(/[\u0000- \u007f]+/g, '');
}

function unsafeHtmlIssues(html: string, isHtml: boolean): TemplateIssue[] {
  const issues: TemplateIssue[] = UNSAFE_PATTERNS.filter(({ re }) => re.test(html)).map(
    ({ detail }) => ({
      code: 'UNSAFE_HTML' as const,
      detail,
    })
  );
  if (isHtml && UNQUOTED_ATTRIBUTE.test(html)) {
    issues.push({ code: 'UNSAFE_HTML', detail: 'Variables in attributes must be quoted (attr="{{…}}")' });
  }
  const normalised = normaliseForSchemes(html);
  for (const scheme of ['javascript:', 'vbscript:']) {
    if (normalised.toLowerCase().includes(scheme)) {
      issues.push({ code: 'UNSAFE_HTML', detail: `"${scheme}" URLs are not allowed` });
    }
  }
  return issues;
}

function variableIssues(
  nodes: Node[],
  catalog: VariableDef[],
  allowBlocks: boolean
): TemplateIssue[] {
  const byPath = new Map(catalog.map((def) => [def.path, def]));
  const issues: TemplateIssue[] = [];
  const unknown = (detail: string) => issues.push({ code: 'UNKNOWN_VARIABLE', detail });

  /** Checks a path against the catalog or the current list item; returns the matching kind. */
  const check = (path: string, items: (string[] | undefined)[]): 'value' | 'list' | undefined => {
    if (path === 'this' || path.startsWith('this.')) {
      if (items.length === 0) return undefined;
      const fields = items[items.length - 1];
      if (path === 'this') return fields && fields.length ? undefined : 'value';
      const field = path.slice('this.'.length);
      return fields?.includes(field) ? 'value' : undefined;
    }
    return byPath.get(path)?.kind;
  };

  const walk = (list: Node[], items: (string[] | undefined)[]) => {
    for (const node of list) {
      switch (node.type) {
        case 'text':
          break;
        case 'index':
          if (items.length === 0)
            issues.push({ code: 'SYNTAX', detail: '"{{@index}}" outside of "{{#each}}"' });
          break;
        case 'value': {
          const kind = check(node.path, items);
          if (kind === undefined) unknown(`Unknown variable "${node.path}"`);
          else if (kind === 'list')
            unknown(`"${node.path}" is a list; use "{{#each ${node.path}}}"`);
          break;
        }
        case 'if':
          if (!allowBlocks) issues.push({ code: 'SYNTAX', detail: 'Blocks are not allowed here' });
          if (check(node.path, items) === undefined) unknown(`Unknown variable "${node.path}"`);
          walk(node.then, items);
          walk(node.else, items);
          break;
        case 'each': {
          if (!allowBlocks) issues.push({ code: 'SYNTAX', detail: 'Blocks are not allowed here' });
          const kind = check(node.path, items);
          if (kind !== 'list') {
            unknown(kind ? `"${node.path}" is not a list` : `Unknown list "${node.path}"`);
            walk(node.children, [...items, []]);
          } else {
            walk(node.children, [...items, byPath.get(node.path)?.itemFields ?? []]);
          }
          break;
        }
      }
    }
  };
  walk(nodes, []);
  return issues;
}

/** `allowBlocks` is true for the HTML body and false for the plain-text subject. */
function validatePart(
  label: string,
  source: string,
  catalog: VariableDef[],
  allowBlocks: boolean
): TemplateIssue[] {
  const { nodes, errors } = parse(source);
  const issues: TemplateIssue[] = [
    ...errors.map((detail) => ({ code: 'SYNTAX' as const, detail })),
    ...unsafeHtmlIssues(source, allowBlocks),
    ...variableIssues(nodes, catalog, allowBlocks),
  ];
  return issues.map((issue) => ({ ...issue, detail: `${label}: ${issue.detail}` }));
}

/** Validates subject (value tags only) and HTML body for the given template type. */
export function validateTemplate(
  type: EmailTemplateType,
  subject: string,
  html: string
): TemplateIssue[] {
  const catalog = getVariableCatalog(type);
  const issues = [
    ...validatePart('subject', subject, catalog, false),
    ...validatePart('html', html, catalog, true),
  ];
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.code}|${issue.detail}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
