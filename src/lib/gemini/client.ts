import { db } from '../db';
import { now } from '../store';

/**
 * Gemini REST client (spec 7).
 *
 * Called directly from the browser with the user's own key. That means the key
 * is visible in their own network tab, which the spec accepts for a
 * single-user personal app on their own device — the mitigation is an HTTP
 * referrer restriction on the key in Google Cloud Console, not secrecy.
 *
 * Every function here is allowed to fail. The rule from spec 7.4 is absolute:
 * the AI is an accelerant, never a dependency. Nothing in this file may throw
 * into a code path that the app needs in order to work offline.
 */

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const MODEL = 'gemini-2.5-flash';

export async function getApiKey(): Promise<string | null> {
  const s = await db.settings.get('settings');
  return s?.geminiApiKey?.trim() || null;
}

export async function setApiKey(key: string): Promise<void> {
  const trimmed = key.trim();
  const existing = await db.settings.get('settings');
  const fields = { geminiApiKey: trimmed || undefined, updatedAt: now() };
  if (existing) await db.settings.update('settings', fields);
  else await db.settings.add({ id: 'settings', ...fields });
}

export async function hasApiKey(): Promise<boolean> {
  return (await getApiKey()) !== null;
}

export interface Part {
  text?: string;
  inlineData?: { mimeType: string; data: string };
  functionCall?: { name: string; args: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
}

export interface Content {
  role: 'user' | 'model';
  parts: Part[];
}

export interface FunctionDeclaration {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface GenerateOptions {
  contents: Content[];
  systemInstruction?: string;
  tools?: FunctionDeclaration[];
  /** Forces JSON matching a schema. Cannot be combined with tools. */
  responseSchema?: Record<string, unknown>;
  maxOutputTokens?: number;
  signal?: AbortSignal;
}

export interface GenerateResult {
  text: string;
  functionCalls: { name: string; args: Record<string, unknown> }[];
}

export class GeminiError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = 'GeminiError';
  }
}

export async function generate(opts: GenerateOptions): Promise<GenerateResult> {
  const key = await getApiKey();
  if (!key) throw new GeminiError('No API key set.');

  const body: Record<string, unknown> = { contents: opts.contents };

  if (opts.systemInstruction) {
    body.systemInstruction = { parts: [{ text: opts.systemInstruction }] };
  }
  if (opts.tools?.length) {
    body.tools = [{ functionDeclarations: opts.tools }];
  }

  const generationConfig: Record<string, unknown> = {
    maxOutputTokens: opts.maxOutputTokens ?? 2048
  };
  // Structured output and tool calling are mutually exclusive in the API —
  // asking for both silently gives neither.
  if (opts.responseSchema && !opts.tools?.length) {
    generationConfig.responseMimeType = 'application/json';
    generationConfig.responseSchema = opts.responseSchema;
  }
  body.generationConfig = generationConfig;

  const res = await fetch(`${ENDPOINT}/${MODEL}:generateContent?key=${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: opts.signal
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new GeminiError(`Gemini ${res.status}: ${detail.slice(0, 300)}`, res.status);
  }

  const json = await res.json();
  const parts: Part[] = json?.candidates?.[0]?.content?.parts ?? [];

  return {
    text: parts
      .map((p) => p.text)
      .filter(Boolean)
      .join('')
      .trim(),
    functionCalls: parts
      .map((p) => p.functionCall)
      .filter((f): f is NonNullable<Part['functionCall']> => !!f)
      .map((f) => ({ name: f.name, args: f.args ?? {} }))
  };
}

/** Parses a JSON response, tolerating a model that wrapped it in a code fence. */
export function parseJson<T>(text: string): T | null {
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    return null;
  }
}
