import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { db } from '../db';
import { generate, setApiKey } from './client';

/**
 * Transcription asks the model not to think, because thinking was most of the
 * 5–20 second wait before dictated words appeared. The setting is only an
 * optimisation — so a model that refuses it must cost one retry, never the
 * whole feature. That is the part that can only fail on a future model change,
 * which is exactly when nobody would be looking.
 */

let bodies: Record<string, unknown>[] = [];

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  await setApiKey('test-key');
  bodies = [];
});
afterEach(() => vi.unstubAllGlobals());

const ok = (text: string) =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status: 200 });

describe('thinking level', () => {
  it('asks for less thinking when told to', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit) => {
      bodies.push(JSON.parse(init.body as string));
      return ok('hello');
    }));
    await generate({ contents: [{ role: 'user', parts: [{ text: 'x' }] }], thinking: 'minimal' });
    expect((bodies[0]!.generationConfig as Record<string, unknown>).thinkingConfig).toEqual({
      thinkingLevel: 'minimal'
    });
  });

  it('leaves it out when not asked, so the assistant keeps its default', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit) => {
      bodies.push(JSON.parse(init.body as string));
      return ok('hi');
    }));
    await generate({ contents: [{ role: 'user', parts: [{ text: 'x' }] }] });
    expect(bodies[0]!.generationConfig).not.toHaveProperty('thinkingConfig');
  });

  it('retries without it when the model refuses the setting', async () => {
    let call = 0;
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit) => {
      bodies.push(JSON.parse(init.body as string));
      return call++ === 0
        ? new Response('{"error":{"message":"thinking_level is not supported for this model"}}', { status: 400 })
        : ok('the words');
    }));
    const result = await generate({ contents: [{ role: 'user', parts: [{ text: 'x' }] }], thinking: 'minimal' });
    expect(result.text).toBe('the words');
    expect(bodies).toHaveLength(2);
    expect(bodies[1]!.generationConfig).not.toHaveProperty('thinkingConfig');
  });

  it('does not retry a 400 that has nothing to do with thinking', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response('{"error":{"message":"API key not valid"}}', { status: 400 })
    ));
    await expect(
      generate({ contents: [{ role: 'user', parts: [{ text: 'x' }] }], thinking: 'minimal' })
    ).rejects.toThrow(/400/);
  });
});
