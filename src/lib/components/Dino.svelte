<script lang="ts">
  /**
   * The sauropod, reusable.
   *
   * Same artwork as the app icon — Twemoji's sauropod, CC-BY 4.0, credited in
   * the README — so the character on the home screen is the character inside
   * the app rather than two drawings that merely resemble each other.
   *
   * `tone` decides how much of it survives. Full colour is the animal as drawn;
   * `mono` is a silhouette in currentColor, for the places where three greens
   * would fight the surface it is sitting on. It faces right in both.
   */
  let {
    size = 28,
    tone = 'colour',
    flip = false,
    title = ''
  }: {
    size?: number;
    tone?: 'colour' | 'mono';
    /** Face left instead. Used when it is walking the other way. */
    flip?: boolean;
    title?: string;
  } = $props();

  const LEGS = 'M17.68 22s1.937 7.873 1.187 9.373c-2.373 4.746-1.187 4.627 0 4.627h2.373c2.373 0-1.187-14-1.187-14zM5.255 19.387s-.436 7.993-1.187 9.493C1.695 33.626 1.695 36 2.882 36h2.373c1.186 0 1.187-4.154 1.187-5.34c0-1.187 1.187-8.603 1.187-8.603z';
  const BODY = 'M12.374 5.251c-2.068.017-4.209-.435-5.523 2.099c-1.404 2.709-2.065 8.579.776 9.664c2.479.947 7.933-1.187 13.866 1.187s8.306 16.612 13.015 16.63c1.224.005 1.206 1.123.001 1.132c-5.914.045-8.509-5.897-9.509-5.897c0 0 1 5.934 0 5.934h-4c-1 0 0-3.081 0-4.268v-1.667s-1.593 1.218-5.936 1.218C11.781 31.284 9 30.066 9 30.066S10 36 9 36H5.255c-1.678 0 .166-4.013 0-5.934c-.102-1.182-.51-4.757-1.224-5.933c-1.726-2.847-2.763-11.521-1.929-15.285c.781-3.526 3.122-6.633 4.675-7.51C8.296.479 9.64-.162 12.968.373c1.775.285 3.591 2.922 2.89 4.274c-.421.81-1.94.591-3.484.604';
  const EYE = 'M12.967 2.181a.592.592 0 1 1-1.185.001a.592.592 0 0 1 1.185-.001';
  const SPOTS = 'M10.218 18.485a.575.575 0 1 1-1.1.34a.575.575 0 0 1 1.1-.34m3.874 1.248a.819.819 0 1 1-1.566.484a.819.819 0 1 1 1.566-.484m-1.625-1.426a.435.435 0 1 1-.831.258a.435.435 0 0 1 .831-.258m2.458-.331a.413.413 0 1 1-.788.244a.413.413 0 0 1 .788-.244m2.843.35a.763.763 0 1 1-1.458.45a.763.763 0 0 1 1.458-.45m4.753 1.979a.487.487 0 1 1-.61-.322a.487.487 0 0 1 .61.322m-5.854 0a.487.487 0 1 1-.61-.322a.49.49 0 0 1 .61.322m4.218-1.306a.487.487 0 1 1-.932.288a.487.487 0 1 1 .932-.288m-1.501.199a.722.722 0 1 1-1.378.427a.722.722 0 0 1 1.378-.427';
</script>

<svg
  viewBox="0 0 36 36"
  width={size}
  height={size}
  role={title ? 'img' : 'presentation'}
  aria-label={title || undefined}
  aria-hidden={title ? undefined : 'true'}
  style={flip ? 'transform: scaleX(-1)' : undefined}
>
  {#if tone === 'mono'}
    <!-- One shape, so it reads at any size and takes the colour around it. The
         eye is punched out in the background colour rather than drawn, which is
         what keeps it visible on a tinted silhouette. -->
    <path d={LEGS} fill="currentColor" opacity="0.55" />
    <path d={BODY} fill="currentColor" />
    <path d={EYE} fill="currentColor" opacity="0.35" />
  {:else}
    <path d={LEGS} fill="#3e721d" />
    <path d={BODY} fill="#77b255" />
    <path d={EYE} />
    <path d={SPOTS} fill="#5c913b" />
  {/if}
</svg>
