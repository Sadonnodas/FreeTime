import type { Action } from 'svelte/action';

/**
 * A one-line field that grows downwards instead of scrolling sideways.
 *
 * Reported twice from the same list, in Toon's words: *"Make to do input field
 * scale with input. Some to-dos need a lot of explanation and horizontal
 * scrolling in a tiny bar while doing the entry is not very practical"*, and
 * *"Make transcription field resize with text amount"*. An `<input>` can only
 * ever show one line, so a long to-do — or the assistant box after a thirty-
 * second dictation — becomes a slot you read through by dragging the cursor.
 *
 * So these are `<textarea rows="1">` that fit their content, and the reason it
 * is an action is that it has to stay ONE LINE OF MEANING while it wraps:
 *
 * - **Enter still submits.** A to-do is a title, not a document; Enter making
 *   a new line would break type-Enter-type-Enter, which is the whole fast path.
 *   Shift+Enter is not given a newline either, for the same reason. Composition
 *   (an IME mid-word) is left alone.
 * - **Pasted line breaks are the caller's to flatten** (`oneLine` below), since
 *   a title with a newline in it renders as a row taller than every other.
 * - **It stops growing** at a cap and scrolls from there, so a pasted essay
 *   cannot push the submit button off the screen.
 *
 * The value is passed as the action's parameter purely so the height is
 * re-fitted when the TEXT changes from outside — cleared after Add, or a
 * transcription appended — which fires no input event of its own.
 */
export const autogrow: Action<
  HTMLTextAreaElement,
  { value: string; onenter?: () => void; max?: number } | undefined
> = (node, params) => {
  let onenter = params?.onenter;
  let max = params?.max ?? 220;

  const fit = () => {
    node.style.height = 'auto';
    const full = node.scrollHeight;
    node.style.height = `${Math.min(full, max)}px`;
    node.style.overflowY = full > max ? 'auto' : 'hidden';
  };

  const keydown = (e: KeyboardEvent) => {
    if (e.key !== 'Enter' || e.isComposing) return;
    e.preventDefault();
    onenter?.();
  };

  node.rows = 1;
  node.style.resize = 'none';
  node.addEventListener('input', fit);
  node.addEventListener('keydown', keydown);
  // After layout, so the first measurement uses the real width.
  queueMicrotask(fit);

  return {
    update(next) {
      onenter = next?.onenter;
      max = next?.max ?? 220;
      queueMicrotask(fit);
    },
    destroy() {
      node.removeEventListener('input', fit);
      node.removeEventListener('keydown', keydown);
    }
  };
};

/** A pasted title, with its line breaks and runs of spaces flattened. */
export const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim();
