<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { page } from '$app/state';
  import { hasApiKey } from '$lib/gemini/client';
  import Assistant from './Assistant.svelte';

  /**
   * The assistant, as a floating button you can put where you like — on every
   * screen, from the layout.
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
   * IT SITS IN THE APP, NOT IN THE WINDOW. It used to be `position: fixed`,
   * which is the same thing on a phone and is not on a laptop: with the shell
   * narrower than the screen it parked against the window's edge, out in the
   * empty margin — *"the assistant is not accessible on computer... I can't
   * find it."* It is absolute inside `.ask-wrap` now, which is the app's own
   * content column (app.css). The numbers below did not change; the box they
   * are measured from did, which is why the drag has to convert the pointer's
   * viewport coordinates into that box.
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
  /**
   * Mounted on first open and then kept, so the conversation and anything not
   * yet added survive closing the pop-up and moving to another screen. Asked
   * for as the assistant being "more integrated with the whole app": it lives
   * in the layout now, on every screen, instead of being a Today feature.
   */
  let everOpened = $state(false);

  /**
   * Which era and project are on screen, read from the route. Only the project
   * screens carry one: /projects/[id] is an era, /projects/[id]/[tag] a project
   * inside it. Everywhere else the assistant is told nothing is in view, so it
   * does not file things somewhere just because you were there earlier.
   */
  const context = $derived.by(() => {
    const id = page.params.id;
    if (!id || !page.route.id?.startsWith('/projects/')) return undefined;
    const tag = page.params.tag ? decodeURIComponent(page.params.tag) : undefined;
    return { eraId: id, tag };
  });

  /** Not over a printout: the button would print, and it has nothing to do there. */
  const hidden = $derived(!!page.route.id?.endsWith('/print'));

  /** Which side it rests on, and how far its bottom edge is from the viewport's. */
  let side = $state<'left' | 'right'>('right');
  let bottom = $state(90);

  /** Live position while a finger is on it; null when resting. */
  let drag = $state<{ x: number; y: number } | null>(null);
  /**
   * The box the button is positioned inside — the app's content column, not
   * the window. Everything a pointer event reports is in viewport coordinates,
   * so a drag has to subtract this; on a phone it is the whole window and the
   * subtraction is zero.
   */
  let btn = $state<HTMLElement | null>(null);
  const box = () =>
    btn?.parentElement?.getBoundingClientRect() ?? new DOMRect(0, 0, innerWidth, innerHeight);
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
    dragBox = box();
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
      openAssistant();
      return;
    }
    // Settle against the nearer side of the APP, at the height it was let go.
    const r = box();
    side = e.clientX < r.left + r.width / 2 ? 'left' : 'right';
    bottom = clamp(innerHeight - e.clientY - SIZE / 2);
    drag = null;
    save();
  }

  function openAssistant() {
    everOpened = true;
    open = true;
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

  /** Measured once when the drag starts, so the button does not re-measure the
   *  page on every pointer move. */
  let dragBox = $state(new DOMRect(0, 0, 0, 0));

  const style = $derived(
    drag
      ? `left: ${drag.x - dragBox.left - SIZE / 2}px; top: ${drag.y - dragBox.top - SIZE / 2}px;`
      : `${side}: ${MARGIN}px; bottom: ${bottom}px;`
  );
</script>

{#if hasKey && !hidden}
  <!--
    touch-action: none is load-bearing. Without it the browser treats the drag
    as a scroll of the page underneath, and the button stays put while Today
    slides around behind it.
  -->
  <button
    bind:this={btn}
    class="absolute z-30 flex h-14 w-14 touch-none select-none items-center justify-center
           rounded-full text-[22px] text-accent
           {drag ? 'scale-110' : 'transition-[left,right,bottom,transform] duration-200'}"
    style="{style}
           background: color-mix(in srgb, var(--color-surface-3) 92%, var(--color-accent));
           box-shadow: 0 6px 20px rgba(0, 0, 0, {drag ? 0.4 : 0.28})"
    onpointerdown={down}
    onpointermove={move}
    onpointerup={up}
    onpointercancel={cancel}
    onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && openAssistant()}
    aria-label="Ask the assistant. Drag to move."
  >
    ✦
  </button>
{/if}

{#if everOpened}
  <Assistant {open} {context} onDone={() => (open = false)} />
{/if}
