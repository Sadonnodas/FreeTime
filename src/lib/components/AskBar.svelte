<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { hasApiKey } from '$lib/gemini/client';
  import Assistant from './Assistant.svelte';

  /**
   * The assistant, as a floating button you can put where you like.
   *
   * WHAT THIS REPLACED. Today used to carry a full capture row, which went when
   * it turned out things get written where they belong rather than captured
   * loose. The assistant stayed, first as a lone button in the leftover bar —
   * "a sad little button... very out of place" — and then as this circle.
   *
   * IT MOVES, because a fixed corner is always in somebody's way. Wherever it
   * sits it covers a strip of the page, and which strip matters depends on the
   * hand holding the phone and on what is on the day. Asked for directly.
   *
   * Press and drag to move it; a press that barely moves is a TAP and opens the
   * assistant. The threshold is what keeps those apart — without it every tap
   * that wobbled a pixel would be read as a tiny drag and open nothing.
   * On release it settles against the nearer side, the way a floating button
   * on a phone is expected to: parked mid-screen it would sit over the middle
   * of every card.
   *
   * The position is remembered in localStorage, per device, and never synced:
   * where your thumb reaches is a fact about this phone, and the laptop has no
   * thumb. It is kept clear of the tab bar at the bottom and the header at the
   * top, and re-clamped when the window changes size, so a spot chosen in
   * portrait cannot strand it off-screen in landscape.
   *
   * Hidden entirely without a Gemini key, like every other AI surface.
   */
  const KEY = 'freetime.ask.position';
  const SIZE = 56;
  const MARGIN = 16;
  /** Movement, in px, below which a press counts as a tap. */
  const TAP_SLOP = 8;

  let hasKey = $state(false);
  let open = $state(false);

  /** Which side it rests on, and how far its bottom edge is from the viewport's. */
  let side = $state<'left' | 'right'>('right');
  let bottom = $state(90);

  /** Live position while a finger is on it; null when resting. */
  let drag = $state<{ x: number; y: number } | null>(null);
  let start: { x: number; y: number; pointerId: number } | null = null;
  let moved = false;

  /** The lowest the button may sit: above the tab bar, or the window's edge on
   *  desktop, where the bar is a rail down the side instead. */
  function minBottom(): number {
    const bar = document.querySelector('nav.pb-safe') as HTMLElement | null;
    const barTop = bar && bar.offsetParent !== null ? bar.getBoundingClientRect().top : innerHeight;
    return innerHeight - barTop + MARGIN;
  }
  const maxBottom = () => Math.max(minBottom(), innerHeight - SIZE - 120);
  const clamp = (b: number) => Math.min(maxBottom(), Math.max(minBottom(), b));

  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null');
      if (saved && (saved.side === 'left' || saved.side === 'right') && Number.isFinite(saved.bottom)) {
        side = saved.side;
        bottom = saved.bottom;
      }
    } catch {
      /* private window, or garbage — the default corner is fine */
    }
    bottom = clamp(bottom);
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ side, bottom }));
    } catch {
      /* not being able to remember it is no reason to refuse the move */
    }
  }

  function down(e: PointerEvent) {
    start = { x: e.clientX, y: e.clientY, pointerId: e.pointerId };
    // Capture keeps the moves coming when a fast finger outruns the button.
    // It can throw for a pointer that is already gone; the drag still works
    // without it, just less smoothly, so that is no reason to lose the press.
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* no capture this time */
    }
    moved = false;
  }

  function move(e: PointerEvent) {
    if (!start || e.pointerId !== start.pointerId) return;
    if (!moved && Math.hypot(e.clientX - start.x, e.clientY - start.y) < TAP_SLOP) return;
    moved = true;
    drag = { x: e.clientX, y: e.clientY };
  }

  function up(e: PointerEvent) {
    if (!start || e.pointerId !== start.pointerId) return;
    start = null;
    if (!moved) {
      open = true;
      return;
    }
    // Settle against the nearer side, at the height it was let go.
    side = e.clientX < innerWidth / 2 ? 'left' : 'right';
    bottom = clamp(innerHeight - e.clientY - SIZE / 2);
    drag = null;
    save();
  }

  function cancel() {
    start = null;
    drag = null;
  }

  const onResize = () => (bottom = clamp(bottom));

  onMount(async () => {
    load();
    addEventListener('resize', onResize);
    hasKey = await hasApiKey();
  });
  onDestroy(() => {
    if (typeof window !== 'undefined') removeEventListener('resize', onResize);
  });

  const style = $derived(
    drag
      ? `left: ${drag.x - SIZE / 2}px; top: ${drag.y - SIZE / 2}px;`
      : `${side}: ${MARGIN}px; bottom: ${bottom}px;`
  );
</script>

{#if hasKey}
  <!--
    touch-action: none is load-bearing. Without it the browser treats the drag
    as a scroll of the page underneath, and the button stays put while Today
    slides around behind it.
  -->
  <button
    class="fixed z-30 flex h-14 w-14 touch-none select-none items-center justify-center
           rounded-full text-[22px] text-accent
           {drag ? 'scale-110' : 'transition-[left,right,bottom,transform] duration-200'}"
    style="{style}
           background: color-mix(in srgb, var(--color-surface-3) 92%, var(--color-accent));
           box-shadow: 0 6px 20px rgba(0, 0, 0, {drag ? 0.4 : 0.28})"
    onpointerdown={down}
    onpointermove={move}
    onpointerup={up}
    onpointercancel={cancel}
    onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && (open = true)}
    aria-label="Ask the assistant. Drag to move."
  >
    ✦
  </button>
{/if}

{#if open}
  <Assistant onDone={() => (open = false)} />
{/if}
