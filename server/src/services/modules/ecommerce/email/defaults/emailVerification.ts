import { callout, heading, layout, note, paragraph } from './layout';

/** Checkout e-mail verification. No button or link: the customer types the code in the store. */
export default {
  subject: 'Your verification code - {{store.name}}',
  html: layout(
    'Your verification code for {{store.name}}.',
    [
      heading('Your verification code'),
      paragraph('Use this code to confirm your e-mail address ({{customer.email}}) at checkout.'),
      callout(
        'Your verification code<br><span style="font-size:28px;line-height:36px;font-weight:700;letter-spacing:6px;color:#111827">{{verification.code}}</span>'
      ),
      paragraph('This code expires in {{verification.validMinutes}} minutes.'),
      note('If you did not request it, ignore this e-mail.'),
    ].join('\n')
  ),
};
