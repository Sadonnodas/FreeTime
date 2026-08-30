<script lang="ts">
  import { onDestroy } from 'svelte';
  import { liveQuery } from 'dexie';
  import { db } from '$lib/db';
  import { startRecording, beep, canRecord, MAX_MEMO_MS, type Recorder } from '$lib/audio';
  import { createMemo, updateMemo, tryLocate, mmss } from '$lib/memos';
  import { activeProjects } from '$lib/queries';
  import type { Project, Memo } from '$lib/types';

  /**
   * Record a song idea.
   *
   * THE ONE RULE HERE: stopping saves. There is no confirm step, no "keep this
   * recording?", and no field that has to be filled before the audio is safe.
   * The panel that appears afterwards is for naming and filing if you feel like
   * it, and closing it without touching anything loses nothing. An idea caught
   * at a bus stop is worth more than a tidy library.
   */
  let {
    onDone,
    projectId: presetProject,
    section: presetSection
  }: { onDone: () => void; projectId?: string; section?: string } = $props();

  type Phase = 'idle' | 'recording' | 'saved' | 'error';
  let phase = $state<Phase>('idle');
  let message = $state('');

  let recorder: Recorder | null = null;
  let startedAt = 0;
  let elapsed = $state(0);
  let ticker: ReturnType<typeof setInterval> | undefined;

  let savedId = $state<string | null>(null);
  const savedQ = $derived(liveQuery(() => (savedId ? db.memos.get(savedId) : undefined)));
  const saved = $derived($savedQ as Memo | undefined);

  const projectsQ = liveQuery(() => activeProjects());
  const projects = $derived(($projectsQ as Project[] | undefined) ?? []);
  const sections = $derived(projects.find((p) => p.id === saved?.projectId)?.tags ?? []);

  const supported = canRecord();

  onDestroy(() => {
    clearInterval(ticker);
    recorder?.cancel();
  });

  async function start() {
    try {
      // `music: true` turns off noise suppression and auto gain, which would
      // otherwise gate a sustained note and pump the level between phrases.
      recorder = await startRecording({ music: true });
    } catch (err) {
      message =
        (err as Error).name === 'NotAllowedError'
          ? 'The microphone was blocked. On an iPhone home-screen app this can be a system restriction — try opening the app in Safari instead.'
          : (err as Error).message;
      phase = 'error';
      return;
    }

    startedAt = Date.now();
    elapsed = 0;
    phase = 'recording';
    beep('start');

    // Fired alongside, never awaited. The permission sheet can sit there for
    // ten seconds and the recording has already started.
    locating = tryLocate();

    ticker = setInterval(() => {
      elapsed = Date.now() - startedAt;
      if (elapsed >= MAX_MEMO_MS) void stop();
    }, 200);
  }

  let locating: Promise<{ lat: number; lng: number } | null> = Promise.resolve(null);

  async function stop() {
    clearInterval(ticker);
    if (!recorder) return;
    const blob = await recorder.stop();
    const mime = recorder.mimeType;
    recorder = null;
    beep('stop');

    try {
      const id = await createMemo({
        blob,
        mime,
        durationMs: elapsed,
        projectId: presetProject,
        // Started from inside a song, so it belongs to that song.
        tag: presetSection
      });
      savedId = id;
      phase = 'saved';

      // Attaches itself whenever it arrives, which may be after the panel is
      // already on screen. If it never arrives, the memo simply has no place.
      void locating.then((at) => {
        if (at) void updateMemo(id, at);
      });
    } catch (err) {
      // The only way to land here is the database refusing the write, which on
      // a phone usually means the storage quota. Say so — silently losing a
      // recording is the worst thing this feature could do.
      message = `The recording could not be saved: ${(err as Error).message}`;
      phase = 'error';
    }
  }

  function again() {
    savedId = null;
    elapsed = 0;
    phase = 'idle';
  }

  const pickProject = (id?: string) => {
    if (!savedId) return;
    // Changing project clears the section, which belonged to the old one.
    void updateMemo(savedId, { projectId: id, tag: undefined });
  };
</script>

<div class="glass-strong rise fixed inset-0 z-50 flex flex-col">
  <div class="flex items-center justify-between px-4 pt-safe">
    <span class="section-label py-3">Voice memo</span>
    {#if phase !== 'recording'}
      <button
        class="press tap px-2 text-[22px] leading-none text-ink-400"
        onclick={onDone}
        aria-label="Close">×</button
      >
    {/if}
  </div>

  {#if phase === 'saved' && saved}
    <!-- Already safe on disk by the time this renders. Everything below is
         optional and the close button is always available. -->
    <div class="flex-1 overflow-y-auto px-5">
      <p class="title-2 mt-2">Saved · {mmss(saved.durationMs)}</p>
      <p class="footnote mt-1">
        Name it if you want to. It is already findable by when and where.
      </p>

      <input
        value={saved.title ?? ''}
        onchange={(e) => updateMemo(saved.id, { title: e.currentTarget.value.trim() || undefined })}
        placeholder="Untitled"
        class="field mt-4 w-full"
      />

      <p class="section-label mt-5 mb-2">Project</p>
      <div class="flex flex-wrap gap-2">
        <button
          class="chip press {saved.projectId ? '' : 'chip-on'}"
          onclick={() => pickProject(undefined)}
        >
          None
        </button>
        {#each projects as p (p.id)}
          <button
            class="chip press {saved.projectId === p.id ? 'chip-on' : ''}"
            onclick={() => pickProject(saved.projectId === p.id ? undefined : p.id)}
          >
            {p.name}
          </button>
        {/each}
      </div>

      {#if sections.length}
        <p class="section-label mt-5 mb-2">Section</p>
        <div class="flex flex-wrap gap-2">
          {#each sections as t (t)}
            <button
              class="chip press {saved.tag === t ? 'chip-on' : ''}"
              onclick={() => updateMemo(saved.id, { tag: saved.tag === t ? undefined : t })}
            >
              {t}
            </button>
          {/each}
        </div>
      {/if}

      <div class="h-6"></div>
    </div>

    <div class="flex gap-2 p-4 pb-safe">
      <button class="btn btn-secondary press flex-1 py-4" onclick={again}>Record another</button>
      <button class="btn btn-primary press flex-1 py-4" onclick={onDone}>Done</button>
    </div>
  {:else}
    <div class="flex flex-1 flex-col items-center justify-center px-6">
      {#if !supported}
        <p class="footnote text-center">This browser can't record audio.</p>
      {:else if phase === 'idle'}
        <button
          class="press flex h-60 w-60 items-center justify-center rounded-full text-[1.6rem]
                 font-semibold text-white"
          style="background: linear-gradient(135deg, #ff453a, #ff2d55);
                 box-shadow: 0 10px 40px -12px rgba(255,69,58,.75)"
          onclick={start}
        >
          Record
        </button>
        <p class="footnote mt-6 max-w-xs text-center">
          Sing it, hum it, play it. It saves the moment you stop — naming it is optional
          and the date, time and place are kept for you.
        </p>
      {:else if phase === 'recording'}
        <!-- Deliberately almost empty: one very large target and a clock. -->
        <button
          class="press flex h-60 w-60 items-center justify-center rounded-full bg-surface-3
                 text-[1.6rem] font-semibold text-white ring-4 ring-red-500/70"
          onclick={stop}
        >
          Stop
        </button>
        <p class="mt-7 text-[2rem] font-semibold tabular-nums tracking-[-0.02em]">
          {mmss(elapsed)}
        </p>
      {:else if phase === 'error'}
        <p class="title-2 text-center">That didn't work.</p>
        <p class="footnote mt-2 text-center">{message}</p>
        <button class="btn btn-secondary press mt-6" onclick={onDone}>Close</button>
      {/if}
    </div>
  {/if}
</div>
