<script lang="ts">
  import type { Content } from '$lib/gemini/client';
  import type { ProposedWrite } from '$lib/gemini/tools';
  import { applyWrite } from '$lib/gemini/tools';
  import { ask } from '$lib/gemini/assistant';

  /**
   * Chat with the store (spec 7.1).
   *
   * The important part is not the conversation, it is the confirmation step:
   * proposed writes appear as editable chips and only land when tapped. One tap
   * to commit, one to discard.
   */
  let { onDone }: { onDone: () => void } = $props();

  interface Bubble {
    role: 'you' | 'it';
    text: string;
  }

  let bubbles = $state<Bubble[]>([]);
  let history = $state<Content[]>([]);
  let pending = $state<ProposedWrite[]>([]);
  let input = $state('');
  let busy = $state(false);
  let error = $state('');

  async function send(e: SubmitEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;

    input = '';
    error = '';
    bubbles = [...bubbles, { role: 'you', text }];
    busy = true;

    try {
      const turn = await ask(history, text);
      history = [
        ...history,
        { role: 'user', parts: [{ text }] },
        { role: 'model', parts: [{ text: turn.reply }] }
      ];
      bubbles = [...bubbles, { role: 'it', text: turn.reply }];
      // Proposals accumulate across turns, so "and add a second one" adds to
      // the batch rather than replacing what was already agreed.
      pending = [...pending, ...turn.proposals];
    } catch (err) {
      error = (err as Error).message;
    } finally {
      busy = false;
    }
  }

  async function commit() {
    for (const p of pending) await applyWrite(p.name, p.args);
    const n = pending.length;
    pending = [];
    bubbles = [...bubbles, { role: 'it', text: `Added ${n}.` }];
  }

  const discard = (i: number) => (pending = pending.filter((_, n) => n !== i));
</script>

<div class="fixed inset-0 z-50 flex flex-col bg-ink-950">
  <div class="flex items-center justify-between px-4 pt-safe">
    <span class="py-3 text-xs uppercase tracking-wide text-ink-400">Assistant</span>
    <button class="tap px-2 text-ink-400" onclick={onDone} aria-label="Close">×</button>
  </div>

  <div class="flex-1 space-y-3 overflow-y-auto px-4 py-2">
    {#if !bubbles.length}
      <p class="py-10 text-center text-sm text-ink-400">
        Ask what's open, or just say what you need to remember.
      </p>
    {/if}

    {#each bubbles as b, i (i)}
      <div class="flex {b.role === 'you' ? 'justify-end' : 'justify-start'}">
        <p
          class="max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2
                 {b.role === 'you' ? 'bg-accent text-ink-950' : 'bg-ink-900 text-ink-50'}"
        >
          {b.text}
        </p>
      </div>
    {/each}

    {#if busy}
      <p class="text-sm text-ink-400">…</p>
    {/if}
    {#if error}
      <p class="rounded-xl bg-ink-900 p-3 text-sm text-ink-400">{error}</p>
    {/if}
  </div>

  {#if pending.length}
    <!-- Nothing here has been written yet. Confirm before writing (spec 7.1):
         silent AI writes would erode trust in the store, and the store's
         trustworthiness is the whole product. -->
    <div class="border-t border-ink-800 bg-ink-900 p-3">
      <p class="mb-2 text-xs uppercase tracking-wide text-ink-400">Not saved yet</p>
      <div class="mb-3 space-y-1">
        {#each pending as p, i (i)}
          <div class="flex items-center gap-2 rounded-xl bg-ink-800 px-3 py-2">
            <span class="min-w-0 flex-1 truncate text-sm">{p.label}</span>
            <button class="tap px-1 text-ink-400" onclick={() => discard(i)} aria-label="Discard">
              ×
            </button>
          </div>
        {/each}
      </div>
      <div class="flex gap-2">
        <button
          class="tap flex-1 rounded-xl px-4 text-sm text-ink-400"
          onclick={() => (pending = [])}>Discard all</button
        >
        <button
          class="tap flex-1 rounded-xl bg-accent px-4 text-sm font-medium text-ink-950"
          onclick={commit}>Add {pending.length}</button
        >
      </div>
    </div>
  {/if}

  <form onsubmit={send} class="flex gap-2 border-t border-ink-800 bg-ink-900 p-3 pb-safe">
    <input
      bind:value={input}
      placeholder="Say anything…"
      enterkeyhint="send"
      autocomplete="off"
      class="tap min-w-0 flex-1 rounded-xl border border-ink-700 bg-ink-800 px-4 text-base
             outline-none focus:border-accent"
    />
    <button
      class="tap rounded-xl bg-accent px-5 font-medium text-ink-950 disabled:opacity-30"
      disabled={!input.trim() || busy}>Send</button
    >
  </form>
</div>
