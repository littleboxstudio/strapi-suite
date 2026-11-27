import { describe, it, expect } from 'vitest';
import {
  applyTranslation,
  decodeEntities,
  encodeText,
  joinTemplate,
  splitTemplate,
  translationStrings,
  SUBJECT_KEY,
} from '../../../server/src/services/modules/duplicate/domain/emailTemplateText';
import * as admin from '../../../admin/src/ecommerce/utils/emailTextEditing';

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

describe('e-mail template text (server copy)', () => {
  it('splits like the admin and joins back to the source', () => {
    expect(splitTemplate(SAMPLE)).toEqual(admin.splitTemplate(SAMPLE));
    expect(joinTemplate(splitTemplate(SAMPLE))).toBe(SAMPLE);
    expect(joinTemplate(splitTemplate('<p>{{broken'))).toBe('<p>{{broken');
    expect(
      splitTemplate(SAMPLE)
        .filter((p) => p.kind === 'text')
        .map((p) => p.text)
    ).toEqual(['Thanks,', '!', 'Your order &amp; receipt', 'View order', 'each', 'Discount: &minus;', 'No discount']);
  });

  it('encodes like the admin', () => {
    expect(encodeText('a b <c> & {{x}}')).toBe(admin.encodeText('a b <c> & {{x}}'));
    expect(encodeText('a b')).toBe('a&nbsp;b');
  });

  it('sends the subject and the texts, and puts the translations back as text', () => {
    const html = '<p>Hi {{customer.firstName}}, welcome &amp; enjoy</p>{{#if x}}<b>Bye</b>{{/if}}';
    const parts = splitTemplate(html);
    expect(SUBJECT_KEY).toBe('subject');
    expect(translationStrings('Order {{order.reference}}', parts)).toEqual({
      subject: 'Order {{order.reference}}',
      t0: 'Hi',
      t1: ', welcome &amp; enjoy',
      t2: 'Bye',
    });
    expect(translationStrings('  ', parts)).not.toHaveProperty('subject');
    const out = applyTranslation(
      'Order {{order.reference}}',
      parts,
      { subject: 'Encomenda {{order.reference}}', t0: 'Olá', t1: ', bem-vindo &amp; <b>aproveite</b>', t2: '  ' },
      decodeEntities
    );
    expect(out.subject).toBe('Encomenda {{order.reference}}');
    expect(out.html).toBe(
      '<p>Olá {{customer.firstName}}, bem-vindo &amp; &lt;b&gt;aproveite&lt;/b&gt;</p>{{#if x}}<b>Bye</b>{{/if}}'
    );
  });

  it('a translation keeping an entity does not double-encode it', () => {
    const parts = splitTemplate('<p>Discount: &minus;5</p>');
    const out = applyTranslation('', parts, { t0: 'Desconto: &minus;5' }, decodeEntities);
    expect(out.html).toBe('<p>Desconto: −5</p>');
  });
});

describe('decodeEntities', () => {
  it('decodes named, decimal and hexadecimal entities', () => {
    expect(decodeEntities('&amp;&lt;&#123;&nbsp;')).toBe('&<{ ');
    expect(decodeEntities('&gt;&quot;&apos;&#39;&#x41;&#X42;')).toBe('>"\'\'AB');
    expect(decodeEntities('Ol&aacute; &Ccedil;&atilde;o &eacute; &euro;5 &ndash; &hellip;')).toBe('Olá Ção é €5 – …');
  });

  it('leaves unknown or broken entities as written', () => {
    expect(decodeEntities('&nope; & &amp &#xZZ; &#99999999;')).toBe('&nope; & &amp &#xZZ; &#99999999;');
    expect(decodeEntities('')).toBe('');
  });
});
