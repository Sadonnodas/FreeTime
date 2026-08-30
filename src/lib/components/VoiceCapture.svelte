<script lang="ts">
  import { onDestroy } from 'svelte';
  import {
    startRecording, toGeminiWav, beep, canRecord, MAX_RECORDING_MS, type Recorder
  } from '$lib/audio';
  import { extractFromAudio, type ExtractedItem } from '$lib/gemini/extract';
  import { commitItems, queueAudio } from '$lib/gemini/commit';

  /**
   * The driving use case (spec 7.2): a long unstructured brain-dump in a car.
   *
   * Everything below follows from "start it before pulling off": one large
   * button, a tone on start and stop so it can be used without looking, and no
   * review screen while recording. Reading is not available to this user at
   * the moment they are using it.
   */
  let { onDone }: { onDone: () => void } = $props();

  type Phase = 'idle' | 'recording' | 'working' | 'review' | 'queued' | 'error';
  let phase = $state<Phase>('idle');

  /**
   * Why the queued phase carries a reason: both no-signal and a failed call
   * queue the audio, and for a long time both said "no connection". A dead
   * model name then looked exactly like a tunnel, which cost an afternoon of
   * looking at the wrong thing. The recording is kept either way — only the
   * explanation differs.
   */
  let queuedReason = $state<'offline' | 'failed'>('offline');

  let recorder: Recorder | null = null;
  let startedAt = 0;
  let elapsed = $state(0);
  let ticker: ReturnType<typeof setInterval> | undefined;

  let items = $state<ExtractedItem[]>([]);
  let transcript = $state('');
  let message = $state('');

  const supported = canRecord();

  onDestroy(() => {
    clearInterval(ticker);
    recorder?.cancel();
  });

  async function start() {
    try {
      recorder = await startRecording();
      startedAt = Date.now();
      elapsed = 0;
      phase = 'recording';
      beep('start');
      ticker = setInterval(() => {
        elapsed = Date.now() - startedAt;
        // Hard stop rather than letting a forgotten recording grow past what
        // can be sent inline.
        if (elapsed >= MAX_RECORDING_MS) void stop();
      }, 200);
    } catch (err) {
      // On iOS this is the standalone-PWA microphone restriction the spec
      // warned about. Say so plainly instead of showing a generic failure.
      message =
        (err as Error).name === 'NotAllowedError'
          ? 'The microphone was blocked. On an iPhone home-screen app this can be a system restriction — try opening the app in Safari instead.'
          : (err as Error).message;
      phase = 'error';
    }
  }

  async function stop() {
    clearInterval(ticker);
    if (!recorder) return;
    const raw = await recorder.stop();
    recorder = null;
    beep('stop');
    phase = 'working';

    try {
      const wav = await toGeminiWav(raw);

      // Offline: keep the bytes and stop. Losing a brain-dump to no signal is
      // the worst failure this app has.
      if (!navigator.onLine) {
        await queueAudio(wav, elapsed);
        queuedReason = 'offline';
        phase = 'queued';
        return;
      }

      const result = await extractFromAudio({ wav });
      transcript = result.transcript;
      items = result.items;
      phase = 'review';
    } catch (err) {
      // A failure after recording must never mean the audio is gone.
      try {
        const wav = await toGeminiWav(raw);
        await queueAudio(wav, elapsed);
        // Keep the reason. Queuing rescues the audio; it does not make the
        // failure go away, and swallowing it here is what made a 404 on the
        // model name unfindable from inside the app.
        message = (err as Error).message;
        queuedReason = 'failed';
        phase = 'queued';
      } catch {
        message = (err as Error).message;
        phase = 'error';
      }
    }
  }

  async function commit() {
    await commitItems(items);
    onDone();
  }

  const drop = (i: number) => (items = items.filter((_, n) => n !== i));

  const mmss = (ms: number) => {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };

  const KIND_LABEL: Record<ExtractedItem['kind'], string> = {
    todo: 'To-do',
    idea: 'Idea',
    buy: 'Buy',
    list_item: 'List'
  };
</script>

<div class="glass-strong rise fixed inset-0 z-50 flex flex-col">
  <div class="flex items-center justify-between px-4 pt-safe">
    <span class="section-label py-3">Voice capture</span>
    {#if phase !== 'recording'}
      <button class="press tap px-2 text-[22px] leading-none text-ink-400" onclick={onDone} aria-label="Close">×</button>
    {/if}
  </div>

  <div class="flex flex-1 flex-col items-center justify-center px-6">
    {#if !supported}
      <p class="footnote text-center">
        This browser can't record audio. Use the text box on Today instead.
      </p>
    {:else if phase === 'idle'}
      <button
        class="btn-hero press flex h-60 w-60 items-center justify-center rounded-full
               text-[1.6rem] font-semibold"
        onclick={start}
      >
        Start
      </button>
      <p class="footnote mt-6 text-center">
        Talk for as long as you like. Tap once more when you're done.
      </p>
    {:else if phase === 'recording'}
      <!-- Deliberately almost empty. Nothing to read, nothing to aim at except
           one very large target. -->
      <button
        class="press flex h-60 w-60 items-center justify-center rounded-full text-[1.6rem]
               font-semibold text-white"
        style="background: linear-gradient(135deg, #ff453a, #ff2d55);
               box-shadow: 0 10px 40px -12px rgba(255,69,58,.75)"
        onclick={stop}
      >
        Stop
      </button>
      <p class="mt-7 text-[2rem] font-semibold tabular-nums tracking-[-0.02em]">{mmss(elapsed)}</p>
    {:else if phase === 'working'}
      <p class="footnote">Listening back…</p>
    {:else if phase === 'queued'}
      <p class="title-2 text-center">Saved for later.</p>
      {#if queuedReason === 'offline'}
        <p class="footnote mt-2 text-center">
          No connection right now. The recording is stored and will be turned into items
          the next time you're online.
        </p>
      {:else}
        <p class="footnote mt-2 text-center">
          The recording is stored and will be retried. Turning it into items failed:
        </p>
        <p class="footnote mt-2 text-center opacity-70">{message}</p>
      {/if}
      <button
        class="btn btn-secondary press mt-6"
        onclick={onDone}>Done</button
      >
    {:else if phase === 'error'}
      <p class="title-2 text-center">That didn't work.</p>
      <p class="footnote mt-2 text-center">{message}</p>
      <button
        class="btn btn-secondary press mt-6"
        onclick={onDone}>Close</button
      >
    {/if}
  </div>

  {#if phase === 'review'}
    <div class="flex-1 overflow-y-auto px-6">
      <h2 class="large-title py-4">
        {items.length} {items.length === 1 ? 'thing' : 'things'}
      </h2>

      <!-- Confirm before writing (spec 7.1). The user is forgetful, not
           careless — silent AI writes would erode trust in the store, and the
           store's trustworthiness is the whole product. -->
      <div class="space-y-2">
        {#each items as item, i (i)}
          <div class="card rise p-3">
            <div class="flex items-start gap-2">
              <span class="mt-0.5 rounded-md bg-surface-3 px-2 py-0.5 text-[11px] font-medium text-ink-400">
                {KIND_LABEL[item.kind]}
              </span>
              <input
                bind:value={items[i]!.text}
                class="min-w-0 flex-1 bg-transparent text-[16px] outline-none"
              />
              <button class="press tap px-1 text-ink-400" onclick={() => drop(i)} aria-label="Discard">
                ×
              </button>
            </div>
            {#if item.projectName || item.listName || item.energy}
              <p class="footnote mt-1 pl-1">
                {[item.projectName, item.listName, item.energy].filter(Boolean).join(' · ')}
              </p>
            {/if}
          </div>
        {/each}
      </div>

      {#if transcript}
        <details class="footnote mt-4">
          <summary class="tap py-2">What it heard</summary>
          <p class="whitespace-pre-wrap pb-4">{transcript}</p>
        </details>
      {/if}
    </div>

    <div class="flex gap-2 p-6 pb-safe">
      <button class="btn btn-secondary press flex-1 py-4" onclick={onDone}>
        Discard
      </button>
      <button
        class="btn btn-primary press flex-1 py-4"
        disabled={!items.length}
        onclick={commit}
      >
        Add {items.length}
      </button>
    </div>
  {/if}
</div>
