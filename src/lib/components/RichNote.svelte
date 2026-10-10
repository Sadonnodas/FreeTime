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

  export function command(name: 'bold' | 'italic' | 'underline' | 'insertUnorderedList' | 'insertOrderedList') {
    // Focus first: on a phone the toolbar button is a tap somewhere else, and
    // a command with no selection to act on does nothing at all.
    el?.focus();
    // Deprecated for twenty years and implemented everywhere; there is no
    // replacement that edits a contenteditable with its undo stack intact.
    document.execCommand(name);
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
  onpaste={(e) => {
    e.preventDefault();
    const text = e.clipboardData?.getData('text/plain') ?? '';
    if (text) insert(text);
  }}
></div>
