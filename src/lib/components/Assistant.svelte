<script lang="ts">
  import type { Content } from '$lib/gemini/client';
  import type { ProposedWrite } from '$lib/gemini/tools';
  import {
    applyWrite, orderForApply, applyPendingEdits, proposalFields, editableText
  } from '$lib/gemini/tools';
  import { ask, type Suggestion, type AskContext } from '$lib/gemini/assistant';
  import { base } from '$app/paths';
  import ProposalEditor from './ProposalEditor.svelte';
  import { goto } from '$app/navigation';
  import { startRecording, toGeminiWav, beep, canRecord, type Recorder } from '$lib/audio';
  import { transcribe } from '$lib/gemini/extract';
  import { canDictateLive, dictateLive, type LiveDictation } from '$lib/speech';
  import { db } from '$lib/db';
  import VoiceCapture from './VoiceCapture.svelte';
  import { autogrow } from '$lib/autogrow';
  import { onDestroy, onMount, tick as nextTick } from 'svelte';

  /**
   * Chat with the store (spec 7.1).
   *
   * The important part is not the conversation, it is the confirmation step:
   * proposed writes appear as editable chips and only land when tapped. One tap
   * to commit, one to discard.
   */
  let {
    onDone,
    open = true,
    context
  }: {
    onDone: () => void;
    /**
     * Shown or tucked away. The component stays mounted between opens (see
     * AskBar), so closing it keeps the conversation and anything not yet
     * added — the pop-up is a place you step out of, not a form you abandon.
     */
    open?: boolean;
    /** The era and project on screen, so "add it here" means here. */
    context?: AskContext;
  } = $props();

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
  // Either way of listening counts: a browser with a recogniser but no
  // MediaRecorder would otherwise hide the microphone it can actually use.
  const micAvailable = canRecord() || canDictateLive();

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

  /**
   * DICTATION YOU CAN WATCH, when the browser can do it.
   *
   * *"Can we not have the audio write down what you are saying almost in real
   * time, like when you have a chat with an AI, instead of recording a whole
   * thing and having it analysed after?"* Where `SpeechRecognition` exists the
   * words stream into the box as they are spoken and there is no round trip at
   * all — which also removes the 5-to-20-second wait reported earlier.
   *
   * Where it does not exist, the recorder path below runs exactly as before.
   * Two paths, and the fallback is not a degraded mode: it is the one that
   * works on the devices the browser makers have not got to yet.
   */
  /**
   * NOT A CONSTANT, and that is the important part. A browser can HAVE
   * `SpeechRecognition` and still not work with it — an installed web app on
   * iOS is the case to worry about, being both the most-used device here and
   * the one most likely to answer a recogniser with a flat refusal. If the
   * live path fails before a single word arrives, this drops to false and the
   * recorder path takes over from the same tap, so the failure costs a moment
   * rather than the feature.
   */
  let liveDictation = $state(canDictateLive());
  let live: LiveDictation | null = null;
  /** Whether anything was heard this time round, which decides whether a
   *  failure means "broken here" or just "that did not go well". */
  let heardAnything = false;
  /** What was in the box before this dictation started, so streaming words
   *  extend it instead of replacing it. */
  let dictationBase = '';
  let dictationLang = $state('');
  onMount(async () => {
    dictationLang = (await db.settings.get('settings'))?.dictationLang ?? '';
  });

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
    // A recogniser left running holds the microphone open for as long as the
    // page lives, which is the same leak class as the memo recorder's.
    live?.cancel();
  });

  async function toggleMic() {
    // The live path, where the browser has a recogniser of its own.
    if (liveDictation) {
      if (listening) {
        listening = false;
        const l = live;
        live = null;
        const heard = await l?.stop();
        beep('stop');
        // The streamed text is already in the box; this only settles the tail,
        // so a guess left on screen is replaced by what was finally heard.
        input = [dictationBase, heard].filter(Boolean).join(' ').trim();
        if (!heard) error = 'Nothing came through. Try again a little closer.';
        return;
      }
      error = '';
      dictationBase = input.trim();
      heardAnything = false;
      try {
        live = dictateLive({
          lang: dictationLang || undefined,
          onText: (text) => {
            heardAnything ||= !!text;
            input = [dictationBase, text].filter(Boolean).join(' ').trim();
          },
          onError: (code) => {
            live?.cancel();
            live = null;
            listening = false;
            // Nothing heard at all: treat this browser as unable to dictate
            // and spend the same tap on the path that does work here, rather
            // than handing back an error and a dead button.
            if (!heardAnything && code !== 'not-allowed') {
              liveDictation = false;
              void toggleMic();
              return;
            }
            error =
              code === 'not-allowed'
                ? 'The microphone was blocked. On an iPhone home-screen app this can be a system restriction — try opening the app in Safari instead.'
                : code === 'network'
                  ? 'Dictation needs the network — the browser sends the audio to its own service.'
                  : `Dictation stopped: ${code}.`;
          }
        });
        listening = true;
        beep('start');
      } catch {
        // It said it could and then could not even start. Same answer.
        liveDictation = false;
        void toggleMic();
      }
      return;
    }

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
      const turn = await ask(history, text, context, pending);
      history = [
        ...history,
        { role: 'user', parts: [{ text }] },
        { role: 'model', parts: [{ text: turn.reply }] }
      ];
      bubbles = [...bubbles, { role: 'it', text: turn.reply }];
      // Corrections first, against the numbers the model was shown — "make
      // the second one Friday" — then anything new joins the batch, so "and
      // add a second one" still adds rather than replacing what was agreed.
      pending = [...(await applyPendingEdits(pending, turn.edits)), ...turn.proposals];
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
    editing = null;
    bubbles = [...bubbles, { role: 'it', text: `Added ${n}.` }];
  }

  const discard = (i: number) => {
    pending = pending.filter((_, n) => n !== i);
    editing = null;
  };

  /**
   * One proposal added on its own. Anything it is FILED UNDER that is also
   * still waiting — "put it in a new project called X" is two proposals — goes
   * in first, or the to-do would land on the era because X does not exist yet
   * (see orderForApply). Only the places it names by name, nothing else.
   */
  async function addOne(i: number) {
    const p = pending[i];
    if (!p) return;
    const same = (a: unknown, b: unknown) =>
      typeof a === 'string' && typeof b === 'string' && a.trim().toLowerCase() === b.trim().toLowerCase();
    const needs = pending.filter(
      (q, n) =>
        n !== i &&
        ((q.name === 'create_project' && same(q.args.name, p.args.projectId)) ||
          ((q.name === 'add_project_to_era' || q.name === 'idea_to_project') &&
            same(q.args.name, p.args.projectInEra)))
    );
    const batch = orderForApply([...needs, p]);
    for (const q of batch) await applyWrite(q.name, q.args);
    pending = pending.filter((q) => !batch.includes(q));
    editing = null;
    bubbles = [...bubbles, { role: 'it', text: `Added: ${p.label}` }];
  }

  /**
   * A proposal, opened up before it is added.
   *
   * This used to be a textarea and nothing else — the WORDS could be changed
   * and no other field could, so *"I told the assistant 20 min and low
   * headspace, and I couldn't adjust the other things I'd normally adjust"*.
   * A model gets a size wrong far more easily than it gets a title wrong, and
   * the only way out was to add it and then go and fix it wherever it landed.
   * `ProposalEditor` now holds the words and everything else the write
   * actually uses, so Open is "check it" rather than "reword it".
   */
  let editing = $state<number | null>(null);
  function replace(i: number, next: ProposedWrite) {
    pending = pending.map((p, n) => (n === i ? next : p));
  }

  /**
   * A proposal's card, in three parts: what kind of thing it is, the words
   * themselves (the big part), and where it will go — split out of the label so
   * "in Home · Garden" is not read as the end of the to-do's title.
   */
  function parts(p: ProposedWrite): { kind: string; text: string; where: string } {
    const at = p.label.indexOf(': ');
    if (!(at > 0 && at < 40)) return { kind: '', text: p.label, where: '' };
    const kind = p.label.slice(0, at);
    const rest = p.label.slice(at + 2);
    const words = editableText(p);
    if (words && rest.startsWith(words)) {
      return { kind, text: words, where: rest.slice(words.length).replace(/^ in /, '').trim() };
    }
    return { kind, text: rest, where: '' };
  }

  /** The conversation follows its newest line, including proposals arriving. */
  let scroller = $state<HTMLDivElement | undefined>();
  $effect(() => {
    void bubbles.length;
    void pending.length;
    void busy;
    void nextTick().then(() => scroller?.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' }));
  });

  /** Starting over. Only the conversation: nothing here was ever saved. */
  function newChat() {
    bubbles = [];
    history = [];
    suggestions = [];
    pending = [];
    error = '';
  }
</script>

<!--
  A POP-UP, NOT A PAGE. It used to cover the whole screen, which made asking
  about the project you were looking at mean losing sight of it. A sheet up from
  the bottom leaves the top of the screen showing, and tapping that part closes
  it — back where you were, with the conversation kept for next time.
-->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="fixed inset-0 z-50 flex flex-col justify-end bg-black/30 lg:items-center lg:justify-center"
  hidden={!open}
  onclick={onDone}
>
<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="glass-strong rise flex h-[86dvh] w-full flex-col overflow-hidden rounded-t-[24px] lg:h-[80dvh] lg:max-w-[560px] lg:rounded-[24px]"
  onclick={(e) => e.stopPropagation()}
>
  <div class="flex items-center justify-between px-4">
    <span class="section-label py-3">Assistant</span>
    <span class="flex items-center gap-1">
      {#if bubbles.length}
        <button class="press tap-h px-2 text-sm text-ink-400" onclick={newChat}>New chat</button>
      {/if}
      <button class="press tap px-2 text-[22px] leading-none text-ink-400" onclick={onDone} aria-label="Close">×</button>
    </span>
  </div>

  <div bind:this={scroller} class="flex-1 space-y-3 overflow-y-auto px-4 py-2">
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

    {#if pending.length}
      <!--
        PROPOSALS LIVE IN THE CONVERSATION, WHOLE. They used to sit in a strip
        under it, one truncated line each — a dictated to-do read "Check
        reliability of app closing beha…" and could only be added or binned
        unread. Now each is a card in the chat with its full words and where it
        goes, and three actions: Add (just this one), Edit (reword it before it
        is saved), Delete. Nothing here is written until an Add — spec 7.1.
      -->
      <section class="space-y-2" aria-label="Not added yet">
        <p class="section-label pt-1">Not added yet</p>
        {#each pending as p, i (i)}
          {@const bits = parts(p)}
          {@const open = editing === i}
          {@const checkable = Object.values(proposalFields(p.name)).some(Boolean)}
          <div class="card p-3">
            {#if bits.kind}
              <p class="footnote mb-0.5">{bits.kind}{#if bits.where}{' · '}<span class="text-ink-200">{bits.where}</span>{/if}</p>
            {/if}
            <!-- The words are the tap target as well as the button, the way
                 every other row in this app opens. The button is what makes it
                 findable: a card that does something when tapped and says
                 nothing about it is a control nobody finds. -->
            <button
              class="w-full text-left text-[16px] leading-snug break-words whitespace-pre-wrap"
              onclick={() => (editing = open ? null : i)}
              aria-expanded={open}
              disabled={!checkable}>{bits.text}</button
            >

            {#if open}
              <ProposalEditor proposal={p} onchange={(next) => replace(i, next)} />
            {/if}

            <div class="-mb-1 mt-2 flex items-center gap-1">
              <button class="btn btn-primary press px-4 text-sm" onclick={() => addOne(i)}>Add</button>
              {#if checkable}
                <button
                  class="press tap-h rounded-lg px-3 text-sm text-accent"
                  onclick={() => (editing = open ? null : i)}>{open ? 'Done' : 'Open'}</button
                >
              {/if}
              <span class="flex-1"></span>
              <button class="press tap-h rounded-lg px-3 text-sm text-ink-400" onclick={() => discard(i)}>
                Delete
              </button>
            </div>
          </div>
        {/each}
        {#if pending.length > 1}
          <div class="flex gap-2 pt-1">
            <button class="press tap flex-1 rounded-xl px-4 text-sm text-ink-400" onclick={() => { pending = []; editing = null; }}>
              Delete all
            </button>
            <button class="btn btn-primary press flex-1 text-sm" onclick={commit}>Add all {pending.length}</button>
          </div>
        {/if}
      </section>
    {/if}

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
        {:else if liveDictation}
          <!-- No meter, and none is wanted: the words arriving in the box
               below ARE the sign of life, and they say more than a bar can.
               The meter exists for the path where nothing appears until you
               stop. -->
          <span class="footnote min-w-0 flex-1 truncate">the words appear as you speak</span>
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
      placeholder={listening && !liveDictation
        ? 'Listening…'
        : transcribing
          ? 'Writing it down…'
          : 'Say anything…'}
      enterkeyhint="send"
      autocomplete="off"
      disabled={(listening && !liveDictation) || transcribing}
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
</div>

{#if dumping}
  <VoiceCapture onDone={() => (dumping = false)} />
{/if}
