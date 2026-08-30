<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import type { Map as LeafletMap, Marker } from 'leaflet';
  import type { Memo, Project } from '$lib/types';
  import { clusterMemos, boundsOf, applyFilter, located, type Period } from '$lib/geo';
  import { displayTitle } from '$lib/memos';
  import Empty from './Empty.svelte';

  /**
   * Every located recording, on one map.
   *
   * Leaflet is loaded lazily and only here. It is the app's only runtime
   * dependency besides Dexie, and it stays out of the boot path entirely —
   * nothing about opening the app should pay for a map that may never be looked
   * at.
   *
   * NOTE ON PRIVACY. Map tiles come from OpenStreetMap, so drawing a map tells
   * their tile server roughly which part of the world is being looked at. That
   * is unavoidable for any map with real cartography, and it is the only thing
   * in this app that leaves the device without Google being involved. The
   * coordinates themselves are never sent anywhere: no geocoding service, no
   * "what is this place called" lookup.
   */
  let {
    memos,
    projects = [],
    onPick
  }: {
    memos: Memo[];
    projects?: Project[];
    onPick: (memos: Memo[]) => void;
  } = $props();

  let host = $state<HTMLDivElement | null>(null);
  let map: LeafletMap | null = null;
  let L: typeof import('leaflet') | null = null;
  let markers: Marker[] = [];
  let zoom = $state(4);
  let failed = $state(false);

  let projectId = $state<string | undefined>(undefined);
  let period = $state<Period>('all');

  const withPlace = $derived(memos.filter(located));
  const shown = $derived(applyFilter(withPlace, { projectId, period }));
  const clusters = $derived(clusterMemos(shown, zoom));

  onMount(async () => {
    try {
      // Both the library and its stylesheet, so the map is not a pile of
      // unstyled divs for the first frame.
      const [leaflet] = await Promise.all([import('leaflet'), import('leaflet/dist/leaflet.css')]);
      L = leaflet.default ?? leaflet;
    } catch {
      failed = true;
      return;
    }
    if (!host) return;

    map = L.map(host, {
      zoomControl: false,
      attributionControl: true,
      // A phone map inside a scrolling page: dragging should pan the map, but a
      // two-finger scroll should still get you down the page.
      scrollWheelZoom: false
    });

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap'
    }).addTo(map);

    L.control.zoom({ position: 'bottomright' }).addTo(map);

    const b = boundsOf(withPlace);
    if (b) map.fitBounds([[b.south, b.west], [b.north, b.east]], { padding: [40, 40], maxZoom: 13 });
    else map.setView([48.85, 2.35], 4);

    zoom = map.getZoom();
    map.on('zoomend', () => (zoom = map!.getZoom()));
  });

  onDestroy(() => {
    map?.remove();
    map = null;
  });

  /**
   * Markers are rebuilt whenever the filters or the zoom change. Fine at this
   * scale — a personal library is hundreds of recordings, not millions — and it
   * keeps the marker set honestly derived from the data rather than patched.
   */
  $effect(() => {
    const current = clusters;
    if (!map || !L) return;

    for (const m of markers) m.remove();
    markers = [];

    for (const c of current) {
      const count = c.memos.length;
      const label = count > 1 ? String(count) : '';
      const size = count > 1 ? 34 : 22;

      const icon = L.divIcon({
        className: '',
        html: `<span class="memo-pin" style="width:${size}px;height:${size}px">${label}</span>`,
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2]
      });

      const marker = L.marker([c.lat, c.lng], {
        icon,
        title: count > 1 ? `${count} recordings` : displayTitle(c.memos[0]!)
      })
        .addTo(map)
        .on('click', () => onPick(c.memos));

      markers.push(marker);
    }
  });
</script>

<div class="mb-3 flex flex-wrap gap-2">
  <button class="chip press {period === 'all' ? 'chip-on' : ''}" onclick={() => (period = 'all')}>
    All time
  </button>
  <button class="chip press {period === 'year' ? 'chip-on' : ''}" onclick={() => (period = 'year')}>
    This year
  </button>
  <button class="chip press {period === 'month' ? 'chip-on' : ''}" onclick={() => (period = 'month')}>
    This month
  </button>
</div>

<div class="no-bar mb-3 flex gap-2 overflow-x-auto pb-1">
  <button
    class="chip press shrink-0 {projectId === undefined ? 'chip-on' : ''}"
    onclick={() => (projectId = undefined)}
  >
    Every era
  </button>
  {#each projects as p (p.id)}
    <button
      class="chip press shrink-0 {projectId === p.id ? 'chip-on' : ''}"
      onclick={() => (projectId = projectId === p.id ? undefined : p.id)}
    >
      {p.name}
    </button>
  {/each}
</div>

{#if failed}
  <p class="footnote py-8 text-center">The map couldn't load. It needs a connection.</p>
{:else if !withPlace.length}
  <Empty
    line="None of your recordings have a location yet. One is saved with each new recording, if you let the app see where you are."
    quip="Nothing has left the nest."
  />
{:else}
  <div
    bind:this={host}
    class="memo-map h-[58vh] w-full overflow-hidden rounded-[20px] border border-line-1"
  ></div>
  <p class="footnote mt-2">
    {shown.length} of {withPlace.length} recording{withPlace.length === 1 ? '' : 's'} shown.
    Tap a pin to play what was recorded there.
  </p>
{/if}
