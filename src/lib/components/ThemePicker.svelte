<script lang="ts">
  import { onDestroy } from 'svelte';
  import { getTheme, setTheme, resolved, type ThemeChoice } from '$lib/theme';
  import Dino from './Dino.svelte';

  /**
   * A road with the sun at one end and the moon at the other, and the dinosaur
   * walking between them.
   *
   * The first attempt made each side a full button with an icon, a label and a
   * tinted background, and stacked the dinosaur underneath — three rows of
   * chrome to express one binary choice. This is one row. The sun and the moon
   * are just the ends of the road, the dinosaur is the position, and tapping
   * either half sends it walking.
   *
   * "Follow my phone" stays a separate checkbox: it answers who decides, not
   * which, and folding it into the same control would make a two-state thing
   * pretend to have three.
   */
  let choice = $state<ThemeChoice>(getTheme());
  let showing = $state<'light' | 'dark'>(resolved());

  const mq =
    typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: light)') : null;
  const onSystemChange = () => {
    if (choice === 'system') showing = resolved('system');
  };
  mq?.addEventListener('change', onSystemChange);
  onDestroy(() => mq?.removeEventListener('change', onSystemChange));

  const auto = $derived(choice === 'system');

  function pick(next: 'light' | 'dark') {
    choice = next;
    showing = next;
    setTheme(next);
  }

  function toggleAuto() {
    // Leaving automatic keeps whatever is on screen, so nothing changes colour
    // at the moment the box is ticked.
    if (auto) pick(resolved('system'));
    else {
      choice = 'system';
      showing = resolved('system');
      setTheme('system');
    }
  }
</script>

<div class="relative flex h-14 items-center overflow-hidden rounded-full"
     style="background: var(--color-surface-1)">
  <!-- Two invisible halves. The whole road is the target, which is a far bigger
       one than two icons would be, and nothing has to be outlined to say so. -->
  <button
    class="press h-full flex-1 pl-4 text-left {showing === 'light'
      ? 'text-accent'
      : 'text-ink-400'}"
    onclick={() => pick('light')}
    aria-label="Light"
    aria-pressed={showing === 'light'}
  >
    <svg viewBox="0 0 24 24" class="h-[22px] w-[22px]" aria-hidden="true">
      <circle cx="12" cy="12" r="4.6" fill="currentColor" />
      <g stroke="currentColor" stroke-width="1.9" stroke-linecap="round">
        <path d="M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2" />
        <path d="M5.4 5.4l1.6 1.6M17 17l1.6 1.6M18.6 5.4L17 7M7 17l-1.6 1.6" />
      </g>
    </svg>
  </button>

  <button
    class="press flex h-full flex-1 justify-end pr-4 {showing === 'dark'
      ? 'text-accent'
      : 'text-ink-400'}"
    onclick={() => pick('dark')}
    aria-label="Dark"
    aria-pressed={showing === 'dark'}
  >
    <svg viewBox="0 0 24 24" class="h-[22px] w-[22px]" aria-hidden="true">
      <path d="M20.4 14.8A8.8 8.8 0 0 1 9.2 3.6a8.8 8.8 0 1 0 11.2 11.2" fill="currentColor" />
    </svg>
  </button>

  <!-- The road itself, and the walker on it. Positioned as a percentage so the
       transition carries across the middle rather than jumping between halves. -->
  <div
    class="pointer-events-none absolute right-14 bottom-[9px] left-14 h-px"
    style="background: var(--color-line-2)"
  ></div>
  <div
    class="pointer-events-none absolute bottom-[9px] translate-x-[-50%] transition-[left]
           duration-500 ease-out"
    style="left: {showing === 'light' ? 34 : 66}%"
  >
    <span class="block text-ink-200"><Dino size={34} tone="mono" flip={showing === 'dark'} /></span>
  </div>
</div>

<label class="press tap-h mt-1 flex cursor-pointer items-center gap-3">
  <span
    class="flex h-[20px] w-[20px] shrink-0 items-center justify-center rounded-md border-2
           transition-colors {auto
      ? 'border-accent bg-accent text-[color:var(--color-on-accent)]'
      : 'border-ink-600 text-transparent'}"
  >
    <svg viewBox="0 0 24 24" class="h-3 w-3" aria-hidden="true">
      <path
        d="M4.5 12.5l5 5 10-11"
        fill="none"
        stroke="currentColor"
        stroke-width="3.4"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  </span>
  <input type="checkbox" class="sr-only" checked={auto} onchange={toggleAuto} />
  <span class="text-[15px]">Automatic</span>
</label>
