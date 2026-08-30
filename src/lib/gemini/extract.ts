import { generate, parseJson, hasApiKey, type Content } from './client';
import { buildDigest } from './digest';
import { toBase64 } from '../audio';
import type { Energy } from '../types';

/**
 * Turning a brain-dump into discrete items (spec 7.2).
 *
 * One round trip returns the transcript AND the structured items. Two calls
 * would be easier to reason about and twice as slow, and the model does a
 * better job when it can see what it heard while it splits it up.
 */

export type ExtractedKind = 'todo' | 'idea' | 'buy';

export interface ExtractedItem {
  kind: ExtractedKind;
  text: string;
  projectName?: string;
  energy?: Energy;
  url?: string;
}

export interface Extraction {
  transcript: string;
  items: ExtractedItem[];
}

const SCHEMA = {
  type: 'object',
  properties: {
    transcript: { type: 'string' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['todo', 'idea', 'buy'] },
          text: { type: 'string' },
          projectName: { type: 'string' },
          energy: { type: 'string', enum: ['quick', 'moderate', 'focus'] },
          url: { type: 'string' }
        },
        required: ['kind', 'text']
      }
    }
  },
  required: ['transcript', 'items']
};

/**
 * The instruction is mostly about restraint. A model asked to organise a
 * ramble will happily invent structure — inferring deadlines, splitting one
 * thought into four tasks, assigning projects on a keyword match. Every one of
 * those is a small lie the user then has to find and undo, and the whole point
 * of this app is that the store is trustworthy.
 */
const SYSTEM = `You turn a spoken brain-dump into discrete items for a personal organiser.

Return the full transcript, and the items you are confident about.

Rules:
- One item per distinct thought. Do NOT split a single thought into steps.
- Do NOT invent items. If the person is just thinking aloud, return fewer items.
- Never infer a date or deadline. There is no date field; it does not exist here.
- Assign projectName ONLY if they named it or it is unmistakable from context.
  Leave it out otherwise. Unassigned is a perfectly good answer.
- energy is optional: quick (a few minutes), moderate, focus (a long block).
  Leave it out unless the size is obvious.
- kind:
  - todo: something to do
  - idea: a thought with no action attached, including a want such as a book
    to read or an album to hear
  - buy: something to acquire (set url if they said one)
- Keep text close to their own words. Tidy grammar, do not rewrite meaning.`;

export interface ExtractOptions {
  /** 16 kHz mono WAV. See audio.ts for why it is converted first. */
  wav: Blob;
  signal?: AbortSignal;
}

export async function extractFromAudio(opts: ExtractOptions): Promise<Extraction> {
  if (!(await hasApiKey())) throw new Error('No Gemini API key.');

  const digest = await buildDigest();
  const contents: Content[] = [
    {
      role: 'user',
      parts: [
        {
          text:
            `Here is the current state of the organiser, so you can match project ` +
            `names and avoid duplicating what is already open.\n\n${digest.text}\n\n` +
            `Now process this recording.`
        },
        {
          inlineData: {
            mimeType: 'audio/wav',
            data: await toBase64(opts.wav)
          }
        }
      ]
    }
  ];

  const result = await generate({
    contents,
    systemInstruction: SYSTEM,
    responseSchema: SCHEMA,
    maxOutputTokens: 4096,
    signal: opts.signal
  });

  const parsed = parseJson<Extraction>(result.text);
  if (!parsed) throw new Error('Gemini returned something unreadable.');

  return {
    transcript: parsed.transcript ?? '',
    items: (parsed.items ?? []).filter((i) => i.text?.trim())
  };
}

/**
 * Speech to text, and nothing else.
 *
 * Used by the assistant's microphone, where the words have to land in the input
 * box for the user to read before anything is sent. Deliberately NOT
 * extractFromAudio: that one decides what your sentence meant and returns a
 * batch of items, which is the right behaviour for a brain-dump and the wrong
 * one when you are part-way through a conversation.
 */
export async function transcribe(wav: Blob, signal?: AbortSignal): Promise<string> {
  if (!(await hasApiKey())) throw new Error('No Gemini API key.');

  const result = await generate({
    contents: [
      {
        role: 'user',
        parts: [
          { text: 'Write out exactly what is said in this recording. Nothing else.' },
          { inlineData: { mimeType: 'audio/wav', data: await toBase64(wav) } }
        ]
      }
    ],
    systemInstruction:
      'You transcribe. Return only the words spoken, with ordinary punctuation. ' +
      'No preamble, no commentary, no quotation marks around it. If nothing is ' +
      'audible, return an empty string.',
    maxOutputTokens: 2048,
    signal
  });

  return result.text.trim();
}
