<script lang="ts">
  import { onDestroy } from 'svelte';
  import { getTheme, setTheme, resolved, type ThemeChoice } from '$lib/theme';
  import Dino from './Dino.svelte';

  /**
   * Sun, moon, and a dinosaur that walks to whichever one is on.
   *
   * Three radio buttons said System / Light / Dark, which is accurate and dead.
   * The thing being chosen is day or night, so the control is day or night —
   * and "follow my phone" is a separate question about who decides, which is
   * why it is a checkbox beside the toggle rather than a third position in it.
   *
   * With automatic on, the dino still stands under whichever the phone has
   * chosen, so the control always shows the truth rather than going blank. And
   * tapping a side while automatic is on turns automatic off: reaching for the
   * sun means you want the sun, not a preference panel argument.
   */
  let choice = $state<ThemeChoice>(getTheme());
  let showing = $state<'light' | 'dark'>(resolved());

  // `system` follows the OS live, so the dino has to as well.
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
    if (auto) {
      // Leaving automatic keeps whatever is currently on screen, so nothing
      // changes colour at the moment you tick the box.
      pick(resolved('system'));
    } else {
      choice = 'system';
      showing = resolved('system');
      setTheme('system');
    }
  }
</script>

<div class="card p-3">
  <!-- The extra bottom padding is the ground the dinosaur stands on. Without
       it, it hangs over the Light/Dark labels. -->
  <div
    class="relative flex items-stretch gap-1 rounded-2xl p-1 pb-11"
    style="background: var(--color-surface-1)"
  >
    {#each [{ side: 'light', label: 'Light' }, { side: 'dark', label: 'Dark' }] as const as opt (opt.side)}
      <button
        class="press relative z-10 flex flex-1 flex-col items-center gap-1 rounded-xl py-2
               transition-colors {showing === opt.side
          ? 'text-accent'
          : 'text-ink-400'}"
        style={showing === opt.side
          ? 'background: color-mix(in srgb, var(--color-accent) 13%, transparent)'
          : undefined}
        onclick={() => pick(opt.side)}
        aria-pressed={showing === opt.side}
      >
        {#if opt.side === 'light'}
          <svg viewBox="0 0 24 24" class="h-6 w-6" aria-hidden="true">
            <circle cx="12" cy="12" r="4.6" fill="currentColor" />
            <g stroke="currentColor" stroke-width="1.9" stroke-linecap="round">
              <path d="M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2" />
              <path d="M5.4 5.4l1.6 1.6M17 17l1.6 1.6M18.6 5.4L17 7M7 17l-1.6 1.6" />
            </g>
          </svg>
        {:else}
          <svg viewBox="0 0 24 24" class="h-6 w-6" aria-hidden="true">
            <path
              d="M20.4 14.8A8.8 8.8 0 0 1 9.2 3.6a8.8 8.8 0 1 0 11.2 11.2"
              fill="currentColor"
            />
          </svg>
        {/if}
        <span class="text-[13px] font-medium">{opt.label}</span>
      </button>
    {/each}

    <!--
      The dinosaur walks. It is positioned as a fraction of the track rather
      than inside either half, so the transition carries it across the middle
      instead of teleporting between two boxes.
    -->
    <div
      class="pointer-events-none absolute bottom-1.5 translate-x-[-50%] transition-[left]
             duration-500 ease-out"
      style="left: {showing === 'light' ? 25 : 75}%"
    >
      <Dino size={30} tone="mono" flip={showing === 'dark'} />
    </div>
  </div>

  <label class="press tap-h mt-3 flex cursor-pointer items-center gap-3 px-1">
    <span
      class="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[7px] border-2
             transition-colors {auto
        ? 'border-accent bg-accent text-[color:var(--color-on-accent)]'
        : 'border-ink-600 text-transparent'}"
    >
      <svg viewBox="0 0 24 24" class="h-3.5 w-3.5" aria-hidden="true">
        <path
          d="M4.5 12.5l5 5 10-11"
          fill="none"
          stroke="currentColor"
          stroke-width="3"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </span>
    <input type="checkbox" class="sr-only" checked={auto} onchange={toggleAuto} />
    <span class="min-w-0 flex-1 text-[15px]">Automatic</span>
  </label>
  <p class="footnote mt-1 px-1">
    Follows your Mac or iPhone, including their switch at sunset.
  </p>
</div>
