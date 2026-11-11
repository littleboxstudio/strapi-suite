import { describe, it, expect } from 'vitest';
import {
  renderTemplate,
  extractVariables,
  validateTemplate,
  TemplateSyntaxError,
} from '../../../../server/src/services/modules/ecommerce/email/templateEngine';

const codes = (issues: { code: string }[]) => issues.map((issue) => issue.code);

describe('renderTemplate', () => {
  it('does not escape values in plain-text mode', () => {
    const data = { store: { name: 'A & B' }, customer: { lastName: "O'Brien <x>" } };
    expect(renderTemplate('{{store.name}} {{customer.lastName}}', data, { escape: false })).toBe(
      "A & B O'Brien <x>"
    );
    expect(renderTemplate('{{store.name}}', data)).toBe('A &amp; B');
  });

  it('HTML-escapes values', () => {
    expect(
      renderTemplate('Olá, {{customer.firstName}}', { customer: { firstName: '<b>João</b>' } })
    ).toBe('Olá, &lt;b&gt;João&lt;/b&gt;');
    expect(renderTemplate('{{v}}', { v: `&"'` })).toBe('&amp;&quot;&#39;');
  });

  it('allows whitespace inside braces', () => {
    expect(renderTemplate('{{ customer.firstName }}', { customer: { firstName: 'Ana' } })).toBe(
      'Ana'
    );
  });

  it('renders missing values as empty strings', () => {
    expect(renderTemplate('[{{a.b.c}}][{{x}}]', { a: {} })).toBe('[][]');
  });

  it('renders numbers and booleans but not objects or arrays', () => {
    expect(renderTemplate('{{n}}|{{b}}|{{o}}|{{l}}', { n: 3, b: true, o: { a: 1 }, l: [1] })).toBe(
      '3|true||'
    );
  });

  it('does not resolve inherited properties', () => {
    expect(
      renderTemplate('{{order.constructor}}{{order.__proto__}}{{toString}}', { order: {} })
    ).toBe('');
  });

  it('iterates #each with this.x and @index', () => {
    const source =
      '{{#each order.items}}<li>{{@index}}:{{this.name}} x{{ this.quantity }}</li>{{/each}}';
    const data = {
      order: {
        items: [
          { name: 'Mug', quantity: 2 },
          { name: '<Cup>', quantity: 1 },
        ],
      },
    };
    expect(renderTemplate(source, data)).toBe('<li>0:Mug x2</li><li>1:&lt;Cup&gt; x1</li>');
  });

  it('renders nothing for #each over a non-array', () => {
    expect(renderTemplate('a{{#each x}}b{{/each}}c', { x: 'str' })).toBe('ac');
  });

  it('supports #if / else', () => {
    const source = '{{#if refund.isPartial}}partial{{else}}full{{/if}}';
    expect(renderTemplate(source, { refund: { isPartial: true } })).toBe('partial');
    expect(renderTemplate(source, { refund: { isPartial: false } })).toBe('full');
    expect(renderTemplate(source, {})).toBe('full');
  });

  it('applies truthiness rules', () => {
    const t = (value: unknown) => renderTemplate('{{#if v}}T{{else}}F{{/if}}', { v: value });
    expect([t('x'), t(1), t(true), t([1]), t({})].join('')).toBe('TTTTT');
    expect([t(''), t(0), t(false), t([]), t(null), t(undefined)].join('')).toBe('FFFFFF');
  });

  it('supports #each nested inside #if, and #if inside #each', () => {
    const source =
      '{{#if order.items}}<ul>{{#each order.items}}<li>{{this.name}}{{#if this.option}} ({{this.option}}){{/if}}</li>{{/each}}</ul>{{else}}none{{/if}}';
    expect(
      renderTemplate(source, {
        order: { items: [{ name: 'Mug', option: 'Red' }, { name: 'Pen' }] },
      })
    ).toBe('<ul><li>Mug (Red)</li><li>Pen</li></ul>');
    expect(renderTemplate(source, { order: { items: [] } })).toBe('none');
  });

  it('supports nested #each with the innermost item as this', () => {
    const source = '{{#each a}}[{{#each this.b}}{{@index}}{{this.c}}{{/each}}]{{/each}}';
    expect(renderTemplate(source, { a: [{ b: [{ c: 'x' }, { c: 'y' }] }, { b: [] }] })).toBe(
      '[0x1y][]'
    );
  });

  it('leaves single braces and stray closing braces as text', () => {
    expect(renderTemplate('a{b}c }} d', {})).toBe('a{b}c }} d');
  });

  it('throws TemplateSyntaxError on malformed templates', () => {
    expect(() => renderTemplate('{{#each x}}a', {})).toThrow(TemplateSyntaxError);
    expect(() => renderTemplate('{{a', {})).toThrow(TemplateSyntaxError);
    expect(() => renderTemplate('{{{a}}}', {})).toThrow(TemplateSyntaxError);
    expect(() => renderTemplate('{{a + b}}', {})).toThrow(TemplateSyntaxError);
    expect(() => renderTemplate('{{#if a}}x{{/each}}', {})).toThrow(TemplateSyntaxError);
  });
});

describe('extractVariables', () => {
  it('lists value, each and if paths', () => {
    const source =
      '{{customer.firstName}}{{#if order.discount}}{{order.discount}}{{/if}}{{#each order.items}}{{this.name}}{{@index}}{{/each}}{{customer.firstName}}';
    expect(extractVariables(source)).toEqual([
      { path: 'customer.firstName', kind: 'value' },
      { path: 'order.discount', kind: 'if' },
      { path: 'order.discount', kind: 'value' },
      { path: 'order.items', kind: 'each' },
      { path: 'this.name', kind: 'value' },
    ]);
  });
});

describe('validateTemplate', () => {
  const valid = '<p>Hi {{customer.firstName}}</p>';

  it('accepts a valid template', () => {
    expect(validateTemplate('ORDER_CONFIRMATION', 'Order {{order.reference}}', valid)).toEqual([]);
  });

  it.each([
    '<script>alert(1)</script>',
    '< SCRIPT src="x"></script>',
    '<a href="#" onclick="x()">a</a>',
    '<img src="x" ONERROR = "x()">',
    '<a href="javascript:alert(1)">a</a>',
    '<a href = " JavaScript :alert(1)">a</a>',
    '<a href="java&#x09;script:alert(1)">a</a>',
    '<img src="vbscript:x">',
    '<iframe src="https://x"></iframe>',
    '<object data="x"></object>',
    '<embed src="x">',
    '<form action="x"></form>',
    '<meta http-equiv="refresh" content="0;url=https://x">',
  ])('flags unsafe HTML: %s', (html) => {
    expect(codes(validateTemplate('ORDER_CONFIRMATION', 'Subject', html))).toContain('UNSAFE_HTML');
  });

  it('does not flag harmless words', () => {
    expect(
      validateTemplate(
        'ORDER_CONFIRMATION',
        'Subject',
        '<p>Questions? Contact us. Your option: one</p>'
      )
    ).toEqual([]);
  });

  it('flags unknown variables', () => {
    const issues = validateTemplate('ORDER_CONFIRMATION', 'Subject', '<p>{{order.refrence}}</p>');
    expect(issues).toEqual([
      { code: 'UNKNOWN_VARIABLE', detail: expect.stringContaining('order.refrence') },
    ]);
  });

  it('flags variables that belong to another type', () => {
    expect(codes(validateTemplate('INVOICE_AVAILABLE', 'Subject', '{{refund.amount}}'))).toEqual([
      'UNKNOWN_VARIABLE',
    ]);
  });

  it('flags unknown variables in the subject', () => {
    expect(codes(validateTemplate('ORDER_CONFIRMATION', 'Order {{order.nope}}', valid))).toEqual([
      'UNKNOWN_VARIABLE',
    ]);
  });

  it('flags an unclosed #each', () => {
    expect(
      codes(validateTemplate('ORDER_CONFIRMATION', 'Subject', '{{#each order.items}}{{this.name}}'))
    ).toEqual(['SYNTAX']);
  });

  it.each([
    '{{customer.firstName',
    '{{{customer.firstName}}}',
    '{{a b}}',
    '{{/if}}',
    '{{else}}',
    '{{#if order.total}}{{/each}}',
  ])('flags syntax errors: %s', (html) => {
    expect(codes(validateTemplate('ORDER_CONFIRMATION', 'Subject', html))).toContain('SYNTAX');
  });

  it('accepts this.quantity inside #each order.items', () => {
    expect(
      validateTemplate(
        'ORDER_CONFIRMATION',
        'Subject',
        '{{#each order.items}}{{@index}} {{this.quantity}}{{#if this.option}}{{this.option}}{{/if}}{{/each}}'
      )
    ).toEqual([]);
  });

  it('validates this.* against the item schema', () => {
    expect(
      codes(
        validateTemplate('ORDER_CONFIRMATION', 'S', '{{#each order.items}}{{this.colour}}{{/each}}')
      )
    ).toEqual(['UNKNOWN_VARIABLE']);
    // shipment items have no unitPrice
    expect(
      codes(
        validateTemplate(
          'FULL_SHIPMENT',
          'S',
          '{{#each shipment.items}}{{this.unitPrice}}{{/each}}'
        )
      )
    ).toEqual(['UNKNOWN_VARIABLE']);
  });

  it('flags this and @index outside #each', () => {
    expect(validateTemplate('ORDER_CONFIRMATION', 'S', '{{this.name}}{{@index}}').length).toBe(2);
  });

  it('flags #each over a value and a list used as a value', () => {
    expect(
      codes(validateTemplate('ORDER_CONFIRMATION', 'S', '{{#each order.total}}{{/each}}'))
    ).toEqual(['UNKNOWN_VARIABLE']);
    expect(codes(validateTemplate('ORDER_CONFIRMATION', 'S', '{{order.items}}'))).toEqual([
      'UNKNOWN_VARIABLE',
    ]);
  });

  it('accepts #if over a list', () => {
    expect(
      validateTemplate('PARTIAL_SHIPMENT', 'S', '{{#if shipment.pendingItems}}x{{/if}}')
    ).toEqual([]);
  });

  it('rejects blocks in the subject', () => {
    expect(
      codes(validateTemplate('ORDER_CONFIRMATION', '{{#if order.discount}}x{{/if}}', valid))
    ).toContain('SYNTAX');
  });
});
