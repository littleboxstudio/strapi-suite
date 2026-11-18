import { describe, it, expect } from 'vitest';
import {
  annotateTemplate,
  encodeText,
  joinTemplate,
  replaceText,
  splitTemplate,
} from '../../../admin/src/ecommerce/utils/emailTextEditing';

const texts = (html: string) =>
  splitTemplate(html)
    .filter((p) => p.kind === 'text')
    .map((p) => p.text);
const vars = (html: string) =>
  splitTemplate(html)
    .filter((p) => p.kind === 'var')
    .map((p) => p.text);

describe('email text editing', () => {
  const SAMPLE = `<!doctype html><html><head><title>Order {{order.number}}</title><style>p{color:red}</style></head>
<body>
  <!-- a comment -->
  <h1 style="margin:0">Thanks, {{customer.firstName}}!</h1>
  <p>Your order &amp; receipt</p>
  <a href="{{order.url}}" title="x > y">View order</a>
  <table>
{{#each order.items}}
    <tr><td>{{this.name}}<br><span>{{this.unitPrice}} each</span></td></tr>
{{/each}}
  </table>
{{#if order.discount}}<p>Discount: &minus;{{order.discount}}</p>{{else}}<p>No discount</p>{{/if}}
</body></html>`;

  it('joining the parts gives the source back exactly', () => {
    expect(joinTemplate(splitTemplate(SAMPLE))).toBe(SAMPLE);
    expect(joinTemplate(splitTemplate(''))).toBe('');
    expect(joinTemplate(splitTemplate('<p>{{broken'))).toBe('<p>{{broken');
  });

  it('finds the fixed texts, never head, style, attributes, comments or table structure', () => {
    expect(texts(SAMPLE)).toEqual([
      'Thanks,',
      '!',
      'Your order &amp; receipt',
      'View order',
      'each',
      'Discount: &minus;',
      'No discount',
    ]);
  });

  it('variables are the values shown in the text; blocks stay raw', () => {
    expect(vars(SAMPLE)).toEqual([
      '{{customer.firstName}}',
      '{{this.name}}',
      '{{this.unitPrice}}',
      '{{order.discount}}',
    ]);
  });

  it('annotates texts and variables with marked spans', () => {
    const out = annotateTemplate(splitTemplate('<p>Hi {{customer.firstName}}, welcome</p>'));
    expect(out).toBe(
      '<p><span data-ltb-text="0">Hi</span> <span data-ltb-var="">{{customer.firstName}}</span><span data-ltb-text="1">, welcome</span></p>'
    );
  });

  it('replacing a text changes only that text, encoded', () => {
    const parts = splitTemplate('<p>Hi {{customer.firstName}}, welcome</p><p>Bye</p>');
    const next = replaceText(parts, 2, 'See you <soon> & {{x}}');
    expect(joinTemplate(next)).toBe(
      '<p>Hi {{customer.firstName}}, welcome</p><p>See you &lt;soon&gt; &amp; {&#123;x}}</p>'
    );
    expect(joinTemplate(parts)).toBe('<p>Hi {{customer.firstName}}, welcome</p><p>Bye</p>');
  });

  it('encodes non-breaking spaces', () => {
    expect(encodeText('a b')).toBe('a&nbsp;b');
  });
});
