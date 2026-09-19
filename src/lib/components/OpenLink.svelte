<script lang="ts">
  /**
   * "🔗 Open link · shop.example" — for a to-do or idea clipped from a web
   * page (clip.ts), so the page it came from is one tap away.
   */
  let { url }: { url?: string } = $props();
  const host = $derived.by(() => {
    try {
      return url ? new URL(url).hostname.replace(/^www\./, '') : '';
    } catch {
      return '';
    }
  });
</script>

{#if url && host}
  <a
    href={url}
    target="_blank"
    rel="noreferrer"
    class="press tap-h mt-1 inline-flex items-center gap-1 rounded-lg text-sm text-accent"
  >
    🔗 Open link <span class="footnote">· {host}</span>
  </a>
{/if}
