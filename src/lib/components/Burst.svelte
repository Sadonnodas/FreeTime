<script lang="ts">
  import { pickBurst, particlesFor } from '$lib/celebrate';

  /**
   * One celebration, played once and then thrown away.
   *
   * Absolutely positioned over whatever it is celebrating and
   * `pointer-events: none`, so it cannot swallow the next tap — a row that
   * stops responding for half a second because a sparkle is over it would be a
   * worse bug than having no sparkle at all.
   *
   * The variant is chosen when this mounts, so a new one plays every tick.
   */
  let { size = 132 }: { size?: number } = $props();

  const burst = pickBurst();
  const particles = particlesFor(burst);
</script>

<span class="burst" style="width:{size}px;height:{size}px" aria-hidden="true">
  <svg viewBox="-50 -50 100 100" class="h-full w-full overflow-visible">
    {#if burst.ring}
      <circle class="burst-ring" cx="0" cy="0" r="14" fill="none" stroke={burst.colors[0]} stroke-width="2" />
    {/if}
    {#each particles as p, i (i)}
      <g
        class="burst-p"
        style="--a:{p.angle}deg; --d:{p.distance}; --s:{p.scale};
               animation-delay:{p.delayMs}ms; animation-duration:{p.durationMs}ms"
      >
        {#if burst.shape === 'spark'}
          <line x1="0" y1="-2.5" x2="0" y2="2.5" stroke={p.color} stroke-width="1.6" stroke-linecap="round" />
        {:else if burst.shape === 'dot'}
          <circle cx="0" cy="0" r="1.9" fill={p.color} />
        {:else if burst.shape === 'star'}
          <path d="M0,-3.4 L0.8,-0.8 L3.4,0 L0.8,0.8 L0,3.4 L-0.8,0.8 L-3.4,0 L-0.8,-0.8 Z" fill={p.color} />
        {:else}
          <ellipse cx="0" cy="0" rx="1.4" ry="2.8" fill={p.color} />
        {/if}
      </g>
    {/each}
  </svg>
</span>
