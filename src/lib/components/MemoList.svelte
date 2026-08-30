<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { Memo, Project } from '$lib/types';
  import {
    deleteMemo, updateMemo, shareMemo, mmss, whenLabel, monthLabel, displayTitle
  } from '$lib/memos';
  import { downloadMemoAudio } from '$lib/sync';

  /**
   * A list of recordings, with its own transport.
   *
   * The browser's built-in <audio controls> is a white pill on every platform
   * and reads as a form element dropped into the page, which is exactly the
   * "unstyled web page" look the design notes exist to avoid. It is about forty
   * lines to drive the element by hand and the difference is the whole feel of
   * the screen.
   *
   * One row is open at a time and only the open row holds an object URL, so a
   * library of two hundred memos does not pin two hundred blobs in memory.
   */
  let {
    memos,
    projects = [],
    grouped = true,
    showProject = true
  }: {
    memos: Memo[];
    projects?: Project[];
    grouped?: boolean;
    showProject?: boolean;
  } = $props();

  let openId = $state<string | null>(null);
  let url = $state<string | null>(null);
  let audioEl = $state<HTMLAudioElement | null>(null);

  let playing = $state(false);
  let position = $state(0);
  let duration = $state(0);
  let editingId = $state<string | null>(null);
  let note = $state('');

  /**
   * Recordings made on another device arrive as metadata only — the audio is
   * fetched the first time it is played here, rather than every device pulling
   * down every recording ever made. So a row can be in three states, and they
   * must not look alike: playable, fetchable, and genuinely gone.
   */
  let fetchingId = $state<string | null>(null);
  let fetchError = $state('');

  const elsewhere = (m: Memo): boolean => !m.blob && !!m.driveFileId;
  const lost = (m: Memo): boolean => !m.blob && !m.driveFileId;

  function revoke() {
    if (url) URL.revokeObjectURL(url);
    url = null;
    playing = false;
    position = 0;
    duration = 0;
  }

  onDestroy(revoke);

  async function open(memo: Memo) {
    revoke();
    openId = memo.id;
    fetchError = '';
    // Fall back to the recorded length: see onMeta for why the file's own
    // duration cannot be trusted.
    duration = memo.durationMs / 1000;

    if (memo.blob) {
      url = URL.createObjectURL(memo.blob);
      return;
    }
    if (!memo.driveFileId) return;

    fetchingId = memo.id;
    try {
      const blob = await downloadMemoAudio(memo.id);
      // The row may have been closed, or another one opened, while this was in
      // flight. Handing it a url now would start audio nobody asked for.
      if (openId !== memo.id) return;
      if (blob) url = URL.createObjectURL(blob);
      else fetchError = 'Could not fetch it — you may be offline, or signed out of Google.';
    } catch (err) {
      if (openId === memo.id) fetchError = (err as Error).message;
    } finally {
      if (fetchingId === memo.id) fetchingId = null;
    }
  }

  function close() {
    audioEl?.pause();
    revoke();
    openId = null;
  }

  function onPlayButton(memo: Memo) {
    if (openId !== memo.id) {
      void open(memo);
      return; // autoplay takes it from here
    }
    if (!audioEl) return;
    if (audioEl.paused) void audioEl.play();
    else audioEl.pause();
  }

  /**
   * MediaRecorder's webm output carries no duration in its container, so
   * `audio.duration` comes back Infinity in Chrome and seeking misbehaves until
   * the stream has been walked to the end. Seeking to an absurd offset forces
   * the browser to do that walk and resolve the real length; we then put the
   * playhead back. Safari's mp4 reports correctly and skips all of this.
   *
   * Without the fallback to the recorded length, every memo made on Android or
   * desktop Chrome would show a broken scrubber.
   */
  function onMeta() {
    if (!audioEl) return;
    const d = audioEl.duration;
    if (Number.isFinite(d) && d > 0) {
      duration = d;
    } else {
      audioEl.currentTime = 1e101;
      audioEl.addEventListener(
        'timeupdate',
        () => {
          if (!audioEl) return;
          if (Number.isFinite(audioEl.duration)) duration = audioEl.duration;
          audioEl.currentTime = 0;
        },
        { once: true }
      );
    }
  }

  function seek(e: PointerEvent) {
    if (!audioEl || !duration) return;
    const track = e.currentTarget as HTMLElement;
    const rect = track.getBoundingClientRect();
    const fraction = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    audioEl.currentTime = fraction * duration;
    position = audioEl.currentTime;
  }

  async function share(memo: Memo) {
    // Sharing needs the actual bytes, so a memo from another device has to come
    // down first rather than the button quietly doing nothing.
    let subject = memo;
    if (!memo.blob && memo.driveFileId) {
      fetchingId = memo.id;
      const blob = await downloadMemoAudio(memo.id);
      fetchingId = null;
      if (!blob) {
        note = 'Could not fetch the audio to share.';
        setTimeout(() => (note = ''), 3000);
        return;
      }
      subject = { ...memo, blob };
    }
    const result = await shareMemo(subject);
    note = result === 'downloaded' ? 'Saved to your downloads.' : '';
    if (note) setTimeout(() => (note = ''), 3000);
  }

  /** Two taps to delete, because the audio really does go. No dialog — the
   *  second tap is the confirmation and it is easy to walk away from. */
  let armed = $state<string | null>(null);
  async function remove(memo: Memo) {
    if (armed !== memo.id) {
      armed = memo.id;
      setTimeout(() => (armed = armed === memo.id ? null : armed), 4000);
      return;
    }
    armed = null;
    if (openId === memo.id) close();
    await deleteMemo(memo.id);
  }

  const projectName = (id?: string) => projects.find((p) => p.id === id)?.name;

  const mapsHref = (m: Memo) => `https://www.google.com/maps/search/?api=1&query=${m.lat},${m.lng}`;

  const progress = $derived(duration ? Math.min(100, (position / duration) * 100) : 0);

  // Month headings, computed once per list rather than per row.
  const groups = $derived.by(() => {
    if (!grouped) return [{ label: '', items: memos }];
    const out: { label: string; items: Memo[] }[] = [];
    for (const m of memos) {
      const label = monthLabel(m.recordedAt);
      const last = out.at(-1);
      if (last?.label === label) last.items.push(m);
      else out.push({ label, items: [m] });
    }
    return out;
  });
</script>

{#if note}
  <p class="footnote mb-2 text-good">{note}</p>
{/if}

{#each groups as group (group.label)}
  {#if group.label}
    <h3 class="section-label mt-4 mb-2">{group.label}</h3>
  {/if}

  <ul class="space-y-1">
    {#each group.items as memo (memo.id)}
      <li class="card-flat px-3 py-2">
        <div class="flex items-center gap-3">
          <button
            class="press tap-h flex w-11 shrink-0 items-center justify-center rounded-full
                   bg-surface-2 text-accent"
            onclick={() => onPlayButton(memo)}
            disabled={lost(memo) || fetchingId === memo.id}
            aria-label={openId === memo.id && playing ? 'Pause' : `Play ${displayTitle(memo)}`}
          >
            {#if openId === memo.id && playing}
              <svg viewBox="0 0 24 24" class="h-4 w-4" aria-hidden="true">
                <path d="M8 5h3.2v14H8zm4.8 0H16v14h-3.2z" fill="currentColor" />
              </svg>
            {:else}
              <svg viewBox="0 0 24 24" class="h-4 w-4" aria-hidden="true">
                <path d="M8 4.8 19 12 8 19.2z" fill="currentColor" />
              </svg>
            {/if}
          </button>

          <button
            class="min-w-0 flex-1 py-1 text-left"
            onclick={() => (openId === memo.id ? close() : void open(memo))}
          >
            <p class="truncate">{displayTitle(memo)}</p>
            <p class="footnote truncate">
              {[
                mmss(memo.durationMs),
                memo.title ? whenLabel(memo.recordedAt) : null,
                showProject ? projectName(memo.projectId) : null,
                memo.tag,
                memo.place,
                fetchingId === memo.id
                  ? 'fetching…'
                  : elsewhere(memo)
                    ? 'not on this device'
                    : null
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </button>
        </div>

        {#if openId === memo.id}
          <div class="mt-2 border-t border-line-1 pt-3">
            {#if url}
              <!-- svelte-ignore a11y_media_has_caption -->
              <audio
                bind:this={audioEl}
                src={url}
                autoplay
                onplay={() => (playing = true)}
                onpause={() => (playing = false)}
                onended={() => {
                  playing = false;
                  position = 0;
                }}
                ontimeupdate={() => (position = audioEl?.currentTime ?? 0)}
                onloadedmetadata={onMeta}
              ></audio>

              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div
                class="relative h-9 cursor-pointer touch-none"
                onpointerdown={(e) => {
                  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                  seek(e);
                }}
                onpointermove={(e) => e.buttons === 1 && seek(e)}
              >
                <!-- The bar is 4px but the target is the full 36px row, so it
                     can be scrubbed with a thumb rather than a cursor. -->
                <div class="absolute inset-x-0 top-4 h-1 rounded-full bg-surface-3"></div>
                <div
                  class="absolute top-4 left-0 h-1 rounded-full bg-accent"
                  style="width: {progress}%"
                ></div>
                <div
                  class="absolute top-[11px] h-[11px] w-[11px] -translate-x-1/2 rounded-full bg-accent"
                  style="left: {progress}%"
                ></div>
              </div>

              <div class="flex justify-between">
                <span class="footnote tabular-nums">{mmss(position * 1000)}</span>
                <span class="footnote tabular-nums">{mmss(duration * 1000)}</span>
              </div>
            {:else if fetchingId === memo.id}
              <p class="footnote">Fetching the audio…</p>
            {:else if fetchError}
              <p class="footnote">{fetchError}</p>
            {:else}
              <p class="footnote">The audio for this one is gone.</p>
            {/if}

            {#if editingId === memo.id}
              <input
                value={memo.title ?? ''}
                onchange={(e) =>
                  updateMemo(memo.id, { title: e.currentTarget.value.trim() || undefined })}
                placeholder="Untitled"
                class="field mt-2 w-full text-sm"
              />
            {/if}

            <div class="mt-1 flex flex-wrap items-center gap-1">
              <button
                class="press tap-h rounded-lg px-3 text-sm text-ink-200"
                onclick={() => (editingId = editingId === memo.id ? null : memo.id)}
              >
                {editingId === memo.id ? 'Done' : 'Rename'}
              </button>
              <button
                class="press tap-h rounded-lg px-3 text-sm text-accent"
                onclick={() => share(memo)}
                disabled={lost(memo) || fetchingId === memo.id}
              >
                Share
              </button>
              {#if memo.lat != null && memo.lng != null}
                <a
                  href={mapsHref(memo)}
                  target="_blank"
                  rel="noreferrer"
                  class="press tap-h flex items-center rounded-lg px-3 text-sm text-accent"
                >
                  Map
                </a>
              {/if}
              <span class="flex-1"></span>
              <button
                class="press tap-h rounded-lg px-3 text-sm {armed === memo.id
                  ? 'text-accent-2'
                  : 'text-ink-400'}"
                onclick={() => remove(memo)}
              >
                {armed === memo.id ? 'Really delete?' : 'Delete'}
              </button>
            </div>
          </div>
        {/if}
      </li>
    {/each}
  </ul>
{/each}
