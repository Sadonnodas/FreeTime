<script lang="ts">
  import type { Todo, Idea, BuyItem, Project } from '$lib/types';
  import {
    groupByPlace, todoDetails, totalsOf, formatTotals, buyLineTotal, type ListKind
  } from '$lib/export';
  import { indexById, blockerOf } from '$lib/order';
  import { money } from '$lib/format';

  /**
   * One of Brain's lists, on paper — the same rows the text export copies,
   * laid out for a printer.
   *
   * Grouped under the era and project each row belongs to, whatever grouping
   * the screen was using: on paper, the question is "what does each project
   * need", and a list grouped by shop answers a different one. The shopping
   * list is what was asked for by name — *"separated for all projects, with
   * quantity, cost and total cost for all things within a project and also
   * total cost across everything"* — so it is a table: quantity, price each and
   * line total in columns that line up, a subtotal under every project and one
   * grand total at the end. Only what is STILL to buy: it is a list to carry
   * round a shop with a pen, and bought things would inflate the totals it
   * exists to give.
   *
   * Styles are the project printout's `.paper-*` classes, so the two kinds of
   * printout look like one family.
   */
  let {
    kind,
    title,
    rows,
    eras,
    allTodos = []
  }: {
    kind: ListKind;
    title: string;
    rows: (Todo | Idea | BuyItem)[];
    eras: Project[];
    allTodos?: Todo[];
  } = $props();

  const today = new Date().toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });

  const byId = $derived(indexById(allTodos));

  /** The shopping still to buy — see the header for why only that. */
  const toBuy = $derived(kind === 'buy' ? (rows as BuyItem[]).filter((b) => !b.purchasedAt) : []);
  const groups = $derived(
    groupByPlace((kind === 'buy' ? toBuy : rows) as (Todo | Idea | BuyItem)[], eras)
  );
  const grand = $derived(totalsOf(toBuy));

  const unpricedNote = (n: number) => (n ? ` · ${n} without a price, not included` : '');
  const host = (url?: string) => {
    if (!url) return '';
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return '';
    }
  };
</script>

<article class="paper">
  <header class="paper-head" style="border-color: #888">
    <p class="paper-kicker">FreeTime · Brain</p>
    <h1>{title}</h1>
    <p class="paper-muted">
      Exported {today} ·
      {#if kind === 'buy'}
        {grand.pieces} {grand.pieces === 1 ? 'thing' : 'things'} still to buy
      {:else}
        {rows.length} {rows.length === 1 ? 'row' : 'rows'}
      {/if}
    </p>
  </header>

  {#each groups as group (group.heading)}
    <section>
      <h2>{group.heading}</h2>

      {#if kind === 'todos'}
        <ul class="paper-checks">
          {#each group.rows as row (row.id)}
            {@const t = row as Todo}
            <li class={t.completedAt ? 'paper-done' : ''}>
              <span class="paper-box {t.completedAt ? 'paper-box-on' : ''}" aria-hidden="true"
                >{t.completedAt ? '✓' : ''}</span
              >
              <div>
                <p>{t.title}</p>
                {#if !t.completedAt && todoDetails(t, blockerOf(t, byId)).length}
                  <p class="paper-muted">{todoDetails(t, blockerOf(t, byId)).join(' · ')}</p>
                {/if}
              </div>
            </li>
          {/each}
        </ul>
      {:else if kind === 'ideas'}
        <ul class="paper-bullets">
          {#each group.rows as row (row.id)}
            {@const i = row as Idea}
            <li class={i.doneAt ? 'paper-done' : ''}><p>{i.text}</p></li>
          {/each}
        </ul>
      {:else}
        {@const items = group.rows as BuyItem[]}
        {@const sub = totalsOf(items)}
        <table class="paper-table">
          <thead>
            <tr>
              <th class="paper-col-box"><span class="sr-only">Bought</span></th>
              <th>Item</th>
              <th class="paper-num paper-col-qty">Qty</th>
              <th class="paper-num paper-col-money">Each</th>
              <th class="paper-num paper-col-money">Total</th>
            </tr>
          </thead>
          <tbody>
            {#each items as b (b.id)}
              <tr>
                <td class="paper-col-box"><span class="paper-box" aria-hidden="true"></span></td>
                <td>
                  {b.name}
                  {#if host(b.url)}<span class="paper-muted paper-break block">{host(b.url)}</span>{/if}
                </td>
                <td class="paper-num">{b.qty ?? 1}</td>
                <td class="paper-num">{b.priceCents ? money(b.priceCents, b.currency) : '—'}</td>
                <td class="paper-num">{b.priceCents ? money(buyLineTotal(b), b.currency) : '—'}</td>
              </tr>
            {/each}
          </tbody>
          <tfoot>
            <tr>
              <td></td>
              <td colspan="3">
                Subtotal · {sub.pieces} {sub.pieces === 1 ? 'thing' : 'things'}<span class="paper-muted"
                  >{unpricedNote(sub.unpriced)}</span
                >
              </td>
              <td class="paper-num">{formatTotals(sub)}</td>
            </tr>
          </tfoot>
        </table>
      {/if}
    </section>
  {:else}
    <p class="paper-muted">Nothing here.</p>
  {/each}

  {#if kind === 'buy' && groups.length}
    <!-- The one number the whole printout adds up to. -->
    <div class="paper-grand">
      <span>Total across everything<span class="paper-muted">{unpricedNote(grand.unpriced)}</span></span>
      <span class="paper-num">{formatTotals(grand)}</span>
    </div>
  {/if}
</article>
