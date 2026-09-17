<script lang="ts">
  import { updateTodo } from '$lib/store';
  import type { Todo } from '$lib/types';

  /**
   * "This is a shopping trip" — in a to-do's editor.
   *
   * Only offered once the to-do lives somewhere, because the list it opens is
   * that place's To buy list and a to-do with no era has no list to open. Said
   * in a line rather than hidden, so the reason is on the screen.
   */
  let { todo, place }: { todo: Pick<Todo, 'id' | 'projectId' | 'shopping'>; place: string } = $props();
</script>

{#if todo.projectId}
  <label class="press flex items-center gap-3 text-sm">
    <input
      type="checkbox"
      class="h-5 w-5 shrink-0 accent-[var(--color-accent)]"
      checked={!!todo.shopping}
      onchange={(e) => updateTodo(todo.id, { shopping: e.currentTarget.checked || undefined })}
    />
    <span>Shopping trip — opens the To buy list of <b>{place}</b></span>
  </label>
{:else}
  <p class="footnote">Put it in an era or project to link it to that place's shopping list.</p>
{/if}
