import { describe, it, expect, vi, afterEach } from 'vitest';
import AiTranslationModuleService, {
  buildLengthRule,
  overLimit,
  toMaxLengths,
} from '../../../server/src/services/modules/ai-translation';

const credentials = { apiKey: 'sk-test', model: 'gpt-4o' };
const en = { code: 'en', name: 'English' };
const fr = { code: 'fr-FR', name: 'French (France)' };

const strapi: any = { log: { error: vi.fn(), warn: vi.fn() } };
const service = AiTranslationModuleService({ strapi });

/** Answers each OpenAI call with the next map; records the system prompt and the strings sent. */
function mockOpenAi(...answers: Record<string, string>[]) {
  const calls: { system: string; strings: Record<string, string> }[] = [];
  const fetchMock = vi.fn(async (_url: string, init: any) => {
    const body = JSON.parse(init.body);
    calls.push({ system: body.messages[0].content, strings: JSON.parse(body.messages[1].content) });
    const answer = answers[calls.length - 1] ?? {};
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: JSON.stringify(answer) } }] }),
    } as any;
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe('AI translation within the field limits', () => {
  it('without limits the prompt has no length rule and one request is made', async () => {
    const calls = mockOpenAi({ a: 'Bonjour' });
    const result = await service.translateStrings(credentials, en, fr, { a: 'Hello' });
    expect(result).toEqual({ translations: { a: 'Bonjour' }, failed: 0, errors: [] });
    expect(calls).toHaveLength(1);
    expect(calls[0].system).not.toContain('maximum number of characters');
  });

  it('tells the AI the maximum of each limited key, only the keys of the batch', async () => {
    const calls = mockOpenAi({ title: 'Titre', meta: 'Une description' });
    const result = await service.translateStrings(
      credentials,
      en,
      fr,
      { title: 'Title', meta: 'A description' },
      { meta: 160, other: 10 }
    );
    expect(result.translations).toEqual({ title: 'Titre', meta: 'Une description' });
    expect(calls).toHaveLength(1);
    expect(calls[0].system).toContain('maximum number of characters');
    expect(calls[0].system).toContain('{"meta":160}');
  });

  it('asks again, shorter, for a translation longer than its field, and keeps the shorter one', async () => {
    const calls = mockOpenAi({ title: 'Titre', meta: 'x'.repeat(170) }, { meta: 'y'.repeat(150) });
    const result = await service.translateStrings(
      credentials,
      en,
      fr,
      { title: 'Title', meta: 'A long description' },
      { title: 255, meta: 160 }
    );
    expect(result).toEqual({ translations: { title: 'Titre', meta: 'y'.repeat(150) }, failed: 0, errors: [] });
    expect(calls).toHaveLength(2);
    expect(calls[1].strings).toEqual({ meta: 'A long description' });
    expect(calls[1].system).toContain('{"meta":160}');
    expect(calls[1].system).toContain('longer than allowed');
  });

  it('a translation still too long is dropped and counted as failed (the caller keeps the source)', async () => {
    mockOpenAi({ meta: 'x'.repeat(170) }, { meta: 'x'.repeat(161) });
    const result = await service.translateStrings(credentials, en, fr, { meta: 'A long description' }, { meta: 160 });
    expect(result).toEqual({ translations: {}, failed: 1, errors: [] });
  });

  it('a failed shortening request keeps nothing too long', async () => {
    let call = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        call += 1;
        if (call === 2) return { ok: false, status: 500, text: async () => 'boom' } as any;
        return {
          ok: true,
          json: async () => ({ choices: [{ message: { content: JSON.stringify({ a: 'Ok', meta: 'x'.repeat(170) }) } }] }),
        } as any;
      })
    );
    const result = await service.translateStrings(credentials, en, fr, { a: 'Ok', meta: 'Long' }, { meta: 160 });
    expect(result).toEqual({ translations: { a: 'Ok' }, failed: 1, errors: [] });
  });

  it('the helpers: the rule, the keys over their limit and the limits read from a request', () => {
    expect(buildLengthRule({ a: 60 })).toContain('{"a":60}');
    expect(buildLengthRule({ a: 60 })).not.toContain('longer than allowed');
    expect(overLimit({ a: 'abc', b: 'abcdef', c: 'x' }, { a: 3, b: 5, d: 1 })).toEqual(['b']);
    expect(toMaxLengths({ a: 160, b: '20', c: -1, d: 12.7, e: Number.NaN })).toEqual({ a: 160, d: 12 });
    expect(toMaxLengths(null)).toEqual({});
    expect(toMaxLengths([1, 2])).toEqual({});
  });
});
