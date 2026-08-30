<script lang="ts">
  import { onDestroy } from 'svelte';
  import { getTheme, setTheme, resolved, type ThemeChoice } from '$lib/theme';
  import Dino from './Dino.svelte';

  /**
   * A road with the sun at one end and the moon at the other, and the dinosaur
   * walking between them. Tap an end, or drag the dinosaur across.
   *
   * THE SUN IS GOLD AND THE MOON IS SILVER, in both themes.
   *
   * They were originally coloured by which one was selected — accent for on,
   * grey for off — so in dark mode the moon glowed gold while the sun sat there
   * in silver. These two things have colours of their own, and borrowing them
   * to mean "selected" fights what they are. Selection is brightness and the
   * dinosaur's position instead.
   *
   * The exact shades are tokens rather than literals, because a silver moon is
   * invisible against a near-white page. In light mode it darkens while staying
   * cool, and the sun deepens so it does not glare off the paper. Both problems
   * were spotted on a real screen, not in the palette.
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
    if (auto) pick(resolved('system'));
    else {
      choice = 'system';
      showing = resolved('system');
      setTheme('system');
    }
  }

  // --- dragging --------------------------------------------------------------
  //
  // The whole road is the control. A press anywhere picks up the dinosaur, a
  // drag walks it, and letting go drops it at the nearer end — so tapping the
  // sun and dragging towards it are the same gesture at different speeds, and
  // neither needs a separate hit target.

  let track = $state<HTMLDivElement | null>(null);
  let dragAt = $state<number | null>(null);

  /** Ends at 18/82 rather than 34/66, so it really arrives at the sun. */
  const HOME = { light: 18, dark: 82 };
  const at = $derived(dragAt ?? HOME[showing]);

  function positionFrom(e: PointerEvent): number {
    if (!track) return at;
    const rect = track.getBoundingClientRect();
    const pct = ((e.clientX - rect.left) / rect.width) * 100;
    return Math.min(88, Math.max(12, pct));
  }

  function down(e: PointerEvent) {
    track?.setPointerCapture(e.pointerId);
    dragAt = positionFrom(e);
  }

  function move(e: PointerEvent) {
    if (dragAt === null) return;
    dragAt = positionFrom(e);
  }

  function up() {
    if (dragAt === null) return;
    const side = dragAt > 50 ? 'dark' : 'light';
    dragAt = null;
    pick(side);
  }

  function keys(e: KeyboardEvent) {
    if (e.key === 'ArrowLeft' || e.key === 'Home') pick('light');
    if (e.key === 'ArrowRight' || e.key === 'End') pick('dark');
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  bind:this={track}
  class="relative flex h-14 touch-none items-center overflow-hidden rounded-full select-none"
  style="background: var(--color-surface-1)"
  role="slider"
  tabindex="0"
  aria-label="Light or dark"
  aria-valuemin={0}
  aria-valuemax={1}
  aria-valuenow={showing === 'light' ? 0 : 1}
  aria-valuetext={showing === 'light' ? 'Light' : 'Dark'}
  onpointerdown={down}
  onpointermove={move}
  onpointerup={up}
  onpointercancel={up}
  onkeydown={keys}
>
  <!-- Gold and silver, always. Dimmed when the dinosaur is at the other end. -->
  <span
    class="pointer-events-none absolute left-4 transition-opacity duration-300"
    style="color: var(--color-sun); opacity: {showing === 'light' ? 1 : 0.45}"
  >
    <svg viewBox="0 0 24 24" class="h-[22px] w-[22px]" aria-hidden="true">
      <circle cx="12" cy="12" r="4.6" fill="currentColor" />
      <g stroke="currentColor" stroke-width="1.9" stroke-linecap="round">
        <path d="M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2" />
        <path d="M5.4 5.4l1.6 1.6M17 17l1.6 1.6M18.6 5.4L17 7M7 17l-1.6 1.6" />
      </g>
    </svg>
  </span>

  <span
    class="pointer-events-none absolute right-4 transition-opacity duration-300"
    style="color: var(--color-moon); opacity: {showing === 'dark' ? 1 : 0.45}"
  >
    <svg viewBox="0 0 24 24" class="h-[22px] w-[22px]" aria-hidden="true">
      <path d="M20.4 14.8A8.8 8.8 0 0 1 9.2 3.6a8.8 8.8 0 1 0 11.2 11.2" fill="currentColor" />
    </svg>
  </span>

  <div
    class="pointer-events-none absolute right-12 bottom-[9px] left-12 h-px"
    style="background: var(--color-line-2)"
  ></div>

  <!-- No transition while dragging, or the dinosaur lags behind the finger. -->
  <div
    class="pointer-events-none absolute bottom-[9px] translate-x-[-50%] {dragAt === null
      ? 'transition-[left] duration-500 ease-out'
      : ''}"
    style="left: {at}%"
  >
    <span class="block text-ink-200"><Dino size={34} tone="mono" flip={at > 50} /></span>
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
