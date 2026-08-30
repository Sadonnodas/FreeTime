<script lang="ts">
  import { stickerFrom, stickerUrl } from '$lib/stickers';

  /**
   * A project's picture: a chosen dinosaur, a photo, or neither.
   *
   * One component for all three because there are three places that draw a
   * cover — the grid, the project header, the picker's own preview — and a
   * fourth case handled in only two of them is how covers drift apart.
   *
   * THE STICKER SITS ON COLOURED PAPER, and that is not decoration. The art is
   * drawn with near-black outlines on white, so dropped straight onto the
   * app's near-black page it loses its edges entirely and the dinosaur turns
   * into a floating blob of fill. A mid-tone ground fixes that in both themes
   * at once, and it is the same hue-from-the-name already used for a project
   * with no cover at all, so the colour still means the same project
   * everywhere without anyone having to choose one.
   *
   * The padding is a fixed 3 and not a percentage. A percentage padding in CSS
   * resolves against the WIDTH on all four sides, so on the wide, short banner
   * at the top of a project it came to 88px above and below a 160px box and
   * the dinosaur was left about a centimetre tall.
   */
  let {
    name,
    image,
    initials = ''
  }: { name: string; image?: string; initials?: string } = $props();

  const sticker = $derived(stickerFrom(image));

  function hue(text: string): number {
    let h = 0;
    for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) % 360;
    return h;
  }

  const h = $derived(hue(name));
</script>

{#if sticker}
  <div
    class="absolute inset-0 flex items-center justify-center p-3"
    style="background: linear-gradient(150deg, hsl({h} 58% 82%), hsl({(h + 40) % 360} 50% 66%))"
  >
    <img
      src={stickerUrl(sticker)}
      alt={sticker.label}
      loading="lazy"
      class="h-full w-full object-contain"
    />
  </div>
{:else if image}
  <img src={image} alt="" class="absolute inset-0 h-full w-full object-cover" />
{:else}
  <div
    class="absolute inset-0 flex items-center justify-center"
    style="background: linear-gradient(150deg, hsl({h} 42% 26%), hsl({(h + 40) % 360} 38% 14%))"
  >
    <span class="text-[2.5rem] font-bold tracking-[-0.03em] text-white/22">{initials}</span>
  </div>
{/if}
