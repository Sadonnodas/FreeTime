<script lang="ts">
  import type { Content } from '$lib/gemini/client';
  import type { ProposedWrite } from '$lib/gemini/tools';
  import { applyWrite, orderForApply } from '$lib/gemini/tools';
  import { ask, type Suggestion } from '$lib/gemini/assistant';
  import { base } from '$app/paths';
  import { goto } from '$app/navigation';
  import { startRecording, toGeminiWav, beep, canRecord, type Recorder } from '$lib/audio';
  import { transcribe } from '$lib/gemini/extract';
  import VoiceCapture from './VoiceCapture.svelte';
  import { autogrow } from '$lib/autogrow';
  import { onDestroy } from 'svelte';

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
  let form = $state<HTMLFormElement | undefined>();
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

  /**
   * The long brain-dump (spec 7.2), moved in here from the capture row.
   *
   * It was a second record button sitting next to the one that keeps your
   * audio, and the difference between them — this one feeds Gemini and discards
   * the recording — was invisible until you had used both. It is a Gemini
   * interaction, so it lives with the other one, and the capture row is down to
   * a single record button that does the obvious thing.
   *
   * Kept distinct from the microphone below, which puts words in the box for
   * you to read before anything is sent. This one is for talking for two
   * minutes without looking at the screen and getting a list back.
   */
  let dumping = $state(false);
  let listening = $state(false);
  let transcribing = $state(false);
  let recorder: Recorder | null = null;

  /*
   * SAYING THAT SOMETHING IS HAPPENING. Reported from the to-do list itself:
   * *"It takes anything between 5 and 20 seconds for your vocal prompt to show
   * up so sometimes it feels like it didn't work."* The only sign of life used
   * to be the placeholder of a disabled box changing to "Writing it down…" —
   * grey text in a grey field, which is below the floor where quiet becomes
   * absent (see "Subtle has a floor" in CLAUDE.md).
   *
   * So each of the two waits has a strip of its own above the input. Listening
   * shows a live level meter, because what you want to know while talking is
   * whether anything is going in. Writing-it-down shows moving dots and the
   * seconds so far: a counter turns "is it frozen?" into "it is on 6s", and a
   * wait you can watch passing feels shorter than one you cannot.
   */
  const BARS = 28;
  let levels = $state<number[]>(Array(BARS).fill(0));
  /** Whether this browser gave us an analyser to draw a meter from. */
  let metered = $state(false);
  let elapsed = $state(0);
  let tick: ReturnType<typeof setInterval> | undefined;

  function stopTicking() {
    if (tick) clearInterval(tick);
    tick = undefined;
  }
  onDestroy(() => {
    stopTicking();
    recorder?.cancel();
  });

  async function toggleMic() {
    if (listening) {
      listening = false;
      stopTicking();
      const r = recorder;
      recorder = null;
      if (!r) return;
      const raw = await r.stop();
      beep('stop');
      transcribing = true;
      elapsed = 0;
      const started = Date.now();
      tick = setInterval(() => (elapsed = Math.floor((Date.now() - started) / 1000)), 250);
      try {
        const heard = await transcribe(await toGeminiWav(raw));
        if (heard) input = input ? `${input} ${heard}` : heard;
        else error = 'Nothing audible came through. Try again a little closer.';
      } catch (err) {
        error = (err as Error).message;
      } finally {
        transcribing = false;
        stopTicking();
      }
      return;
    }

    error = '';
    try {
      recorder = await startRecording();
      listening = true;
      beep('start');
      levels = Array(BARS).fill(0);
      const level = recorder.level;
      metered = !!level;
      // No analyser, no meter — a meter pinned at zero would look like silence.
      if (level) tick = setInterval(() => (levels = [...levels.slice(1), level()]), 70);
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
    const text = input.replace(/\s+/g, ' ').trim();
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
    // Places before the things that go into them — see orderForApply. One at a
    // time, awaited, because each may create the era or project the next one
    // is filed under.
    for (const p of orderForApply(pending)) await applyWrite(p.name, p.args);
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
      <p class="footnote pt-10 pb-5 text-center">
        Ask what's open, or just say what you need to remember.
      </p>

      <!-- Offered on the empty screen only. Once there is a conversation going,
           a big red button in the middle of it is a different app. -->
      <button
        class="press tap card flex w-full items-center gap-3 p-4 text-left"
        onclick={() => (dumping = true)}
      >
        <span class="text-[18px] text-red-400">●</span>
        <span class="min-w-0 flex-1">
          <span class="block text-[15px]">Brain-dump</span>
          <span class="footnote">
            Talk for as long as you like — in the car, on a walk. It comes back as a list
            you can edit before anything is saved.
          </span>
        </span>
      </button>
    {/if}

    {#each bubbles as b, i (i)}
      <div class="flex {b.role === 'you' ? 'justify-end' : 'justify-start'}">
        <p
          class="max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5
                 {b.role === 'you' ? 'bg-accent text-[#1a1206]' : 'bg-surface-2 text-ink-50'}"
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

  {#if listening || transcribing}
    <div class="glass hairline-t flex items-center gap-3 px-4 py-3" role="status" aria-live="polite">
      {#if listening}
        <span class="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-red-500"></span>
        <span class="shrink-0 text-[15px]">Listening</span>
        {#if metered}
          <span class="flex h-6 min-w-0 flex-1 items-center gap-[2px]" aria-hidden="true">
            {#each levels as l, i (i)}
              <span
                class="w-full rounded-full bg-red-400"
                style="height: {Math.max(8, Math.min(100, l * 160))}%"
              ></span>
            {/each}
          </span>
        {:else}
          <span class="flex-1"></span>
        {/if}
        <span class="footnote shrink-0">tap ■ to stop</span>
      {:else}
        <span class="flex shrink-0 gap-1" aria-hidden="true">
          <span class="h-2 w-2 animate-bounce rounded-full bg-accent [animation-delay:-0.3s]"></span>
          <span class="h-2 w-2 animate-bounce rounded-full bg-accent [animation-delay:-0.15s]"></span>
          <span class="h-2 w-2 animate-bounce rounded-full bg-accent"></span>
        </span>
        <span class="min-w-0 flex-1 text-[15px]">Writing down what you said…</span>
        <span class="footnote shrink-0 tabular-nums">{elapsed}s</span>
      {/if}
    </div>
  {/if}

  <form bind:this={form} onsubmit={send} class="glass hairline-t flex items-end gap-2 p-3 pb-safe">
    <!-- Grows as a dictation lands in it, so the words can be read before
         sending. Enter sends. See autogrow.ts. -->
    <textarea
      bind:value={input}
      use:autogrow={{ value: input, onenter: () => form?.requestSubmit(), max: 180 }}
      placeholder={listening ? 'Listening…' : transcribing ? 'Writing it down…' : 'Say anything…'}
      enterkeyhint="send"
      autocomplete="off"
      disabled={listening || transcribing}
      class="field field-grow min-w-0 flex-1"
    ></textarea>
    {#if micAvailable}
      <button
        type="button"
        class="press tap shrink-0 rounded-xl px-3 {listening
          ? 'bg-red-500/20 text-red-400'
          : 'bg-surface-2 text-ink-200'}"
        onclick={toggleMic}
        disabled={transcribing}
        aria-label={listening ? 'Stop and write it down' : 'Speak instead of typing'}
      >
        {#if listening}
          <span class="block h-[14px] w-[14px] rounded-[3px] bg-current" aria-hidden="true"></span>
        {:else}
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
        {/if}
      </button>
    {/if}
    <button
      class="btn btn-primary press shrink-0"
      disabled={!input.trim() || busy || listening || transcribing}>Send</button
    >
  </form>
</div>

{#if dumping}
  <VoiceCapture onDone={() => (dumping = false)} />
{/if}
