<script lang="ts">
  import { toMarkdown, toEditorHtml } from '$lib/richText';
  import { answerFor } from '$lib/calc';

  /**
   * A quick note you type INTO, formatted — bold is bold while you write it,
   * not `**bold**`.
   *
   * Asked for after the Markdown version came straight back: *"instead of
   * really going bold or putting italics I get `**what I typed**`"*. A
   * textarea cannot do this — it holds characters, so the syntax has to be
   * visible somewhere in it — so this is a `contenteditable`, the only
   * element that lets a caret sit inside formatted text.
   *
   * **IT IS THE ONLY EDITOR, phone included.** It shipped behind a
   * `pointer: fine` test, on the grounds that a contenteditable on iOS brings
   * its own quarrels with autocorrect, the caret and undo — and that lasted
   * until the next message: *"can you make it work on phone as well?"* Two
   * editors for one screen is the parallel-systems failure this project keeps
   * recording anyway, so the textarea went rather than being kept as a
   * fallback nobody would notice rotting. The list continuation, the list
   * toggles and the mark wrapping it needed went with it; the browser does
   * all three natively in here.
   *
   * **MARKDOWN IS STILL WHAT IS STORED.** `value` in and out is the same
   * plain Markdown the phone's textarea writes, so a note made here syncs,
   * merges, searches, totals and moves into a project's notes exactly as
   * before. The HTML lives only between these two functions and never
   * reaches the database — see richText.ts, which also explains why anything
   * beyond bold, italic, underline and lists travels through untouched.
   *
   * THE RE-RENDER GUARD IS LOAD-BEARING. Writing `innerHTML` on every
   * keystroke would rebuild the DOM under the caret and send it to the end of
   * the note on every letter, so the editor redraws only when the value
   * arrives from somewhere else — a sync, a list button, the box being
   * cleared — and never from what was just typed here.
   */
  let {
    value,
    oninput,
    placeholder = '',
    autofocus = false,
    class: klass = ''
  }: {
    value: string;
    oninput: (markdown: string) => void;
    placeholder?: string;
    autofocus?: boolean;
    class?: string;
  } = $props();

  let el = $state<HTMLDivElement | null>(null);
  /** The last Markdown this editor rendered or emitted, so a value coming back
   *  round from our own `oninput` is recognised and ignored. */
  let mine = $state<string | null>(null);

  $effect(() => {
    const next = value ?? '';
    if (!el || next === mine) return;
    mine = next;
    el.innerHTML = toEditorHtml(next);
  });

  $effect(() => {
    if (autofocus && el) caretToEnd();
  });

  const isBlock = (node: Node) =>
    node.nodeType === 1 && /^(DIV|P|LI|BLOCKQUOTE|PRE)$/.test((node as Element).tagName);

  function caretToEnd() {
    if (!el) return;
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }

  function emit() {
    if (!el) return;
    repair();
    const md = toMarkdown(el);
    mine = md;
    oninput(md);
  }

  /**
   * The line the caret is on, up to the caret.
   *
   * Taken as a Range rather than by reading text nodes, because a line that
   * has a bold word in it is several nodes and the offsets would have to be
   * added up by hand — a Range already knows.
   */
  function lineBeforeCaret(): string | null {
    const sel = getSelection();
    if (!sel || !sel.isCollapsed || !sel.anchorNode || !el?.contains(sel.anchorNode)) return null;
    // The NEAREST block, not the outermost: a browser nests a list and the
    // line after it inside one wrapper, and measuring from that wrapper would
    // hand the sum every word above it as well.
    let block: Node = sel.anchorNode;
    while (block !== el && !isBlock(block)) block = block.parentNode ?? el;
    const range = document.createRange();
    range.selectNodeContents(block);
    range.setEnd(sel.anchorNode, sel.anchorOffset);
    return range.toString();
  }

  /**
   * The sums, which quick notes have had for as long as they have had numbers:
   * a typed "=" at the end of one writes the answer after it. Same rule as the
   * textarea (calc.ts) — only on a typed "=", never on a paste or an edit of
   * an old line, so going back over "3 + 4 = 7" never appends a second 7.
   */
  function answer(e: InputEvent) {
    if (e.inputType !== 'insertText' || e.data !== '=') return;
    const line = lineBeforeCaret();
    if (line === null) return;
    const found = answerFor(line, line.length);
    if (found === null) return;
    /*
     * AFTER this event, not during it. A browser ignores an `execCommand`
     * made re-entrantly from inside the `input` event that is still being
     * dispatched — the answer was worked out correctly and then silently
     * dropped, which looked exactly like the sums not being wired up at all.
     * The caret has not moved by the time this runs.
     */
    setTimeout(() => insert(line.endsWith(' =') ? ` ${found}` : found));
  }

  /**
   * Typed in, rather than written to the DOM, so the browser keeps the caret
   * where it belongs and the undo stack keeps working.
   *
   * With a hand-rolled fallback, because `execCommand` is the one piece of
   * this that is deprecated and refuses in more situations than it documents.
   * The fallback loses its place in the undo stack, which is a far smaller
   * loss than an answer that silently never appears.
   */
  function insert(text: string) {
    if (document.execCommand('insertText', false, text)) return;
    const sel = getSelection();
    const range = sel?.rangeCount ? sel.getRangeAt(0) : null;
    if (!range || !el?.contains(range.startContainer)) return;
    range.deleteContents();
    const node = document.createTextNode(text);
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    sel?.removeAllRanges();
    sel?.addRange(range);
    emit();
  }

  /**
   * The list items the selection touches — the one the caret is in, or every
   * item a selection crosses.
   */
  function selectedItems(): HTMLLIElement[] {
    const sel = getSelection();
    if (!el || !sel?.rangeCount) return [];
    const range = sel.getRangeAt(0);
    return [...el.querySelectorAll('li')].filter((li) => range.intersectsNode(li));
  }

  /**
   * A line you can tick off, inside a note.
   *
   * **IT IS TEXT, AND IT STAYS TEXT.** `- [ ] milk` is a line in this note and
   * nothing else: it never reaches Today, Free Time, the wins feed or any
   * count, and nothing anywhere asks how many of them are ticked. That rule is
   * the whole reason this is allowed to exist beside to-dos — a second place
   * where things get ticked and counted is exactly what this app is built not
   * to have. A packing list is not a project.
   */
  export function checkList() {
    el?.focus();
    if (!selectedItems().length) document.execCommand('insertUnorderedList');
    const items = selectedItems();
    // Off only when every item it touches already has a box, so a mixed
    // selection turns the rest into boxes rather than clearing the lot.
    const adding = items.some((li) => !li.hasAttribute('data-check'));
    for (const li of items) {
      if (adding) li.setAttribute('data-check', li.getAttribute('data-check') ?? '0');
      else li.removeAttribute('data-check');
    }
    repair();
    emit();
  }

  /**
   * Put a box on any item that says it has one and does not.
   *
   * A browser builds the new item itself when Enter is pressed, and what it
   * carries over varies: Chrome clones the attribute and drops the span, which
   * would leave a checklist item with no box to tick. Run after every edit,
   * since it costs one querySelectorAll and the alternative is a note that
   * quietly stops working halfway down.
   */
  function repair() {
    for (const li of el?.querySelectorAll('li[data-check]') ?? []) {
      let box = li.querySelector('.box');
      if (!box) {
        box = document.createElement('span');
        box.className = 'box';
        (box as HTMLElement).contentEditable = 'false';
      }
      // ALWAYS first. Splitting an item with Enter makes the browser carry the
      // span along with the text, which lands it after the words — a box in
      // the middle of a line, which is nonsense on screen even though it
      // stores correctly.
      if (li.firstChild !== box) li.prepend(box);
      // A fresh item starts unticked: pressing Enter after something you have
      // done is you writing the next thing, not having done it already.
      if (li.getAttribute('data-check') === '1' && !li.textContent?.trim()) {
        li.setAttribute('data-check', '0');
      }
    }
  }

  export function command(name: 'bold' | 'italic' | 'underline' | 'insertUnorderedList' | 'insertOrderedList') {
    // Focus first: on a phone the toolbar button is a tap somewhere else, and
    // a command with no selection to act on does nothing at all.
    el?.focus();
    // Deprecated for twenty years and implemented everywhere; there is no
    // replacement that edits a contenteditable with its undo stack intact.
    document.execCommand(name);
    emit();
  }

  /** A whole-line shape: a heading, a quote, or back to a plain line. */
  export function block(tag: 'h2' | 'h3' | 'blockquote' | 'p') {
    el?.focus();
    document.execCommand('formatBlock', false, tag);
    emit();
  }

  export function divider() {
    el?.focus();
    document.execCommand('insertHorizontalRule');
    emit();
  }

  /**
   * The selected words, made a link.
   *
   * `createLink` needs something selected — a link with no text is a link to
   * nothing — so with a bare caret the URL itself is written in first and then
   * linked, which is what a pasted address should look like anyway.
   */
  export function link(url: string) {
    el?.focus();
    const sel = getSelection();
    if (sel?.isCollapsed) insert(url);
    const range = sel?.rangeCount ? sel.getRangeAt(0) : null;
    if (range?.collapsed) {
      // Select what was just written, so there is something to link.
      const node = range.startContainer;
      range.setStart(node, Math.max(0, range.startOffset - url.length));
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
    document.execCommand('createLink', false, url);
    emit();
  }

  export function focus() {
    caretToEnd();
  }
</script>

<!--
  PASTE ARRIVES AS PLAIN TEXT, on purpose. A copy from a web page brings
  spans, colours and font tags that mean nothing here and that richText.ts
  would throw away anyway — taking the text is the same result without the
  mess in between. It also keeps a pasted stylesheet out of a note that syncs.
-->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- The warning is for a plain div given a click handler. This one is already
     a focusable textbox, and the click is for the box inside it: ticking from
     the keyboard is Space with the caret on the line, which the browser gives
     us for free once the caret is in the item. -->
<div
  bind:this={el}
  contenteditable="true"
  role="textbox"
  tabindex="0"
  aria-multiline="true"
  aria-label={placeholder || 'Note'}
  data-placeholder={placeholder}
  class="rich-note {klass}"
  oninput={(e) => {
    answer(e as unknown as InputEvent);
    emit();
  }}
  onclick={(e) => {
    // The box is the one thing in here that is tapped rather than typed into.
    const box = (e.target as HTMLElement | null)?.closest?.('.box');
    const li = box?.closest('li');
    if (!li) return;
    e.preventDefault();
    li.setAttribute('data-check', li.getAttribute('data-check') === '1' ? '0' : '1');
    emit();
  }}
  onpaste={(e) => {
    e.preventDefault();
    const text = e.clipboardData?.getData('text/plain') ?? '';
    if (text) insert(text);
  }}
></div>
