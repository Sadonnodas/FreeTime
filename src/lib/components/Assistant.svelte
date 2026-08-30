<script lang="ts">
  import type { Content } from '$lib/gemini/client';
  import type { ProposedWrite } from '$lib/gemini/tools';
  import { applyWrite } from '$lib/gemini/tools';
  import { ask, type Suggestion } from '$lib/gemini/assistant';
  import { base } from '$app/paths';
  import { goto } from '$app/navigation';
  import { startRecording, toGeminiWav, beep, canRecord, type Recorder } from '$lib/audio';
  import { transcribe } from '$lib/gemini/extract';

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
  let suggestions = $state<Suggestion[]>([]);
  let input = $state('');
  let busy = $state(false);
  let error = $state('');

  /**
   * Talking to it, rather than typing at it.
   *
   * Speech becomes text and lands in the input box — it is NOT sent
   * automatically. The confirm-before-writing rule would be worth very little
   * if a misheard sentence could go straight to the model and come back as a
   * batch of proposals about something you never said. You see the words first.
   */
  const micAvailable = canRecord();
  let listening = $state(false);
  let transcribing = $state(false);
  let recorder: Recorder | null = null;

  async function toggleMic() {
    if (listening) {
      listening = false;
      const r = recorder;
      recorder = null;
      if (!r) return;
      const raw = await r.stop();
      beep('stop');
      transcribing = true;
      try {
        const heard = await transcribe(await toGeminiWav(raw));
        input = input ? `${input} ${heard}` : heard;
      } catch (err) {
        error = (err as Error).message;
      } finally {
        transcribing = false;
      }
      return;
    }

    error = '';
    try {
      recorder = await startRecording();
      listening = true;
      beep('start');
    } catch (err) {
      error =
        (err as Error).name === 'NotAllowedError'
          ? 'The microphone was blocked. On an iPhone home-screen app this can be a system restriction — try opening the app in Safari instead.'
          : (err as Error).message;
    }
  }

  async function follow(s: Suggestion) {
    onDone();
    await goto(`${base}${s.path === '/' ? '' : s.path}` || '/');
  }

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
      // Suggestions do not accumulate — a link offered two questions ago is
      // about a question that has been answered and moved on from.
      suggestions = turn.suggestions;
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

<div class="glass-strong rise fixed inset-0 z-50 flex flex-col">
  <div class="flex items-center justify-between px-4 pt-safe">
    <span class="section-label py-3">Assistant</span>
    <button class="press tap px-2 text-[22px] leading-none text-ink-400" onclick={onDone} aria-label="Close">×</button>
  </div>

  <div class="flex-1 space-y-3 overflow-y-auto px-4 py-2">
    {#if !bubbles.length}
      <p class="footnote py-10 text-center">
        Ask what's open, or just say what you need to remember.
      </p>
    {/if}

    {#each bubbles as b, i (i)}
      <div class="flex {b.role === 'you' ? 'justify-end' : 'justify-start'}">
        <p
          class="max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5
                 {b.role === 'you' ? 'bg-accent text-[#1a1206]' : 'bg-white/[0.07] text-ink-50'}"
        >
          {b.text}
        </p>
      </div>
    {/each}

    {#if suggestions.length && !busy}
      <!-- Offered, not taken. The model can point at a screen; only a tap
           actually goes there. -->
      <div class="flex flex-wrap gap-2">
        {#each suggestions as s (s.path)}
          <button class="chip press" onclick={() => follow(s)}>Open {s.label} ›</button>
        {/each}
      </div>
    {/if}

    {#if busy}
      <p class="text-sm text-ink-400">…</p>
    {/if}
    {#if error}
      <p class="card-flat p-3 text-sm text-ink-400">{error}</p>
    {/if}
  </div>

  {#if pending.length}
    <!-- Nothing here has been written yet. Confirm before writing (spec 7.1):
         silent AI writes would erode trust in the store, and the store's
         trustworthiness is the whole product. -->
    <div class="glass hairline-t p-3">
      <p class="section-label mb-2">Not saved yet</p>
      <div class="mb-3 space-y-1">
        {#each pending as p, i (i)}
          <div class="card-flat flex items-center gap-2 px-3 py-2">
            <span class="min-w-0 flex-1 truncate text-[15px]">{p.label}</span>
            <button class="tap px-1 text-ink-400" onclick={() => discard(i)} aria-label="Discard">
              ×
            </button>
          </div>
        {/each}
      </div>
      <div class="flex gap-2">
        <button
          class="press tap flex-1 rounded-xl px-4 text-sm text-ink-400"
          onclick={() => (pending = [])}>Discard all</button
        >
        <button
          class="btn btn-primary press flex-1 text-sm"
          onclick={commit}>Add {pending.length}</button
        >
      </div>
    </div>
  {/if}

  <form onsubmit={send} class="glass hairline-t flex gap-2 p-3 pb-safe">
    <input
      bind:value={input}
      placeholder={listening ? 'Listening…' : transcribing ? 'Writing it down…' : 'Say anything…'}
      enterkeyhint="send"
      autocomplete="off"
      disabled={listening || transcribing}
      class="field min-w-0 flex-1"
    />
    {#if micAvailable}
      <button
        type="button"
        class="press tap shrink-0 rounded-xl px-3 {listening
          ? 'bg-red-500/20 text-red-400'
          : 'bg-white/8 text-ink-200'}"
        onclick={toggleMic}
        disabled={transcribing}
        aria-label={listening ? 'Stop and write it down' : 'Speak instead of typing'}
      >
        <svg viewBox="0 0 24 24" class="h-[19px] w-[19px]" aria-hidden="true">
          <path
            d="M12 3.6a2.6 2.6 0 0 1 2.6 2.6v5.4a2.6 2.6 0 1 1-5.2 0V6.2A2.6 2.6 0 0 1 12 3.6"
            fill="currentColor"
          />
          <path
            d="M6.4 11.2a5.6 5.6 0 0 0 11.2 0M12 16.8v3.6"
            stroke="currentColor"
            stroke-width="1.7"
            stroke-linecap="round"
            fill="none"
          />
        </svg>
      </button>
    {/if}
    <button
      class="btn btn-primary press shrink-0"
      disabled={!input.trim() || busy || listening || transcribing}>Send</button
    >
  </form>
</div>
