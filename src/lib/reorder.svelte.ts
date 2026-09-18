import { tick } from 'svelte';
import type { Action } from 'svelte/action';
import { placement, type Rankable } from './rank';
import { setRanks } from './store';

/**
 * Press, hold, drag: reordering a short list by hand.
 *
 * Asked for on Today — *"touch, hold and then drag reorder the to-dos and
 * habits"*. The HOLD is the load-bearing part. Every row on Today is already
 * two other gestures: a tap (tick it, log it) and a swipe (scroll the page).
 * A drag that started on touch would steal both, so it only begins after the
 * finger has stayed put for HOLD_MS; move more than SLOP before that and it
 * was a scroll, lift before it and it was a tap. Same slop as the floating
 * Ask button, for the same reason.
 *
 * WHAT MOVES WHILE YOU DRAG is the list itself: the order is previewed live
 * (`preview`), so the others step out of the way as the lifted one passes
 * them, and nothing is written until the finger comes up. One write, of the
 * whole new order, which is also what makes a drag that ends where it
 * started cost nothing.
 *
 * The lifted row follows the finger through the CSS `translate` and `scale`
 * properties, never `transform`: the cards on Today enter with an animation
 * that holds `transform` (fill-mode both), and an animation beats an inline
 * style — a `transform` here would be silently ignored.
 *
 * TOUCH NEEDS ITS OWN LISTENERS. The page must stop scrolling the instant the
 * drag begins, which only a non-passive `touchmove` calling preventDefault can
 * do; pointer events cannot cancel a scroll that CSS `touch-action` allowed
 * when the touch began, and `touch-action: none` on the rows would make the
 * whole of Today unscrollable from its biggest targets. Mouse uses pointer
 * events and the same hold, so a click stays a click on a laptop too.
 *
 * The tap that follows a drag is swallowed — lifting a finger off a habit you
 * just moved must not also log it.
 */

const HOLD_MS = 350;
const SLOP = 8;

type Axis = 'y' | 'xy';

export class Reorder {
  /** The id being carried, if any. */
  dragging = $state<string | null>(null);
  /** The live order while dragging (and briefly after, until the write lands). */
  preview = $state<string[] | null>(null);

  private nodes = new Map<string, HTMLElement>();
  private commit: (ids: string[], moved: string) => unknown;
  private axis: Axis;

  constructor(commit: (ids: string[], moved: string) => unknown, axis: Axis = 'y') {
    this.commit = commit;
    this.axis = axis;
  }

  /** The items in the order to draw them: the preview while there is one. */
  arrange<T extends { id: string }>(items: T[]): T[] {
    const order = this.preview;
    if (!order) return items;
    const at = new Map(order.map((id, i) => [id, i]));
    return [...items].sort(
      (a, b) => (at.get(a.id) ?? Infinity) - (at.get(b.id) ?? Infinity)
    );
  }

  /** The ids as currently drawn, in document order. */
  private domOrder(): string[] {
    return [...this.nodes]
      .sort(([, a], [, b]) =>
        a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
      )
      .map(([id]) => id);
  }

  /** Whether a point lies past the middle of a rect, in reading order. */
  private past(x: number, y: number, r: DOMRect): boolean {
    if (this.axis === 'y') return y > r.top + r.height / 2;
    if (y > r.bottom) return true;
    if (y < r.top) return false;
    return x > r.left + r.width / 2;
  }

  /**
   * `use:list.item={id}`, or `{ id, off }` — OFF while a row is open for
   * editing, because a hold inside a text field is for the text, and because
   * Safari can refuse typing in a field whose ancestor has user-select: none.
   * Off restores selection and ignores presses; the row still counts in the
   * list, so the others can be dragged past it.
   */
  item: Action<HTMLElement, string | { id: string; off?: boolean }> = (node, initial) => {
    const read = (p: string | { id: string; off?: boolean } | undefined) =>
      typeof p === 'string' ? { id: p, off: false } : { id: p!.id, off: !!p!.off };
    let { id, off } = read(initial);
    this.nodes.set(id, node);
    const style = node.style as CSSStyleDeclaration & { webkitUserSelect?: string };
    const applySelect = () => {
      const v = off ? '' : 'none';
      node.style.setProperty('-webkit-touch-callout', v);
      node.style.setProperty('-webkit-user-select', v);
      node.style.userSelect = v;
      // Safari reads the prefixed property; setProperty with the prefix is not
      // reliably honoured there, and a long press would select the text instead.
      style.webkitUserSelect = v;
    };
    applySelect();

    let timer: ReturnType<typeof setTimeout> | undefined;
    let startX = 0;
    let startY = 0;
    let grabX = 0; // pointer offset inside the node's untranslated box
    let grabY = 0;
    let active = false;
    let lastX = 0;
    let lastY = 0;
    let before: string[] = [];

    const clearTimer = () => {
      if (timer) clearTimeout(timer);
      timer = undefined;
    };

    const offset = () => {
      const [tx, ty] = (node.style.translate || '0px 0px').split(' ').map((v) => parseFloat(v) || 0);
      return { tx, ty };
    };

    const place = () => {
      const r = node.getBoundingClientRect();
      const { tx, ty } = offset();
      const baseLeft = r.left - tx;
      const baseTop = r.top - ty;
      node.style.translate = `${lastX - grabX - baseLeft}px ${lastY - grabY - baseTop}px`;
    };

    const begin = () => {
      timer = undefined;
      active = true;
      before = this.domOrder();
      const r = node.getBoundingClientRect();
      grabX = startX - r.left;
      grabY = startY - r.top;
      lastX = startX;
      lastY = startY;
      this.preview = before;
      this.dragging = id;
      node.style.transition = 'scale 120ms ease, box-shadow 120ms ease';
      node.style.scale = '1.03';
      node.style.zIndex = '30';
      node.style.position = node.style.position || 'relative';
      node.style.boxShadow = '0 14px 30px -12px rgb(0 0 0 / 0.45)';
      navigator.vibrate?.(10);
    };

    const move = async (x: number, y: number) => {
      lastX = x;
      lastY = y;
      const order = this.preview;
      if (!order) return;
      const from = order.indexOf(id);
      for (const [otherId, other] of this.nodes) {
        if (otherId === id) continue;
        const r = other.getBoundingClientRect();
        if (x < r.left || x > r.right || y < r.top || y > r.bottom) continue;
        const to = order.indexOf(otherId);
        if (to < 0 || from < 0) break;
        const forward = to > from;
        if (forward !== this.past(x, y, r)) break;
        const next = order.filter((o) => o !== id);
        next.splice(to, 0, id);
        this.preview = next;
        await tick();
        break;
      }
      place();
    };

    const settle = () => {
      node.style.transition = 'translate 160ms ease, scale 160ms ease, box-shadow 160ms ease';
      node.style.translate = '';
      node.style.scale = '';
      node.style.boxShadow = '';
      setTimeout(() => {
        node.style.transition = '';
        node.style.zIndex = '';
      }, 180);
    };

    const end = (keep: boolean) => {
      clearTimer();
      if (!active) return;
      active = false;
      const after = this.preview ?? before;
      this.dragging = null;
      settle();
      const changed = keep && after.join() !== before.join();
      if (changed) {
        void Promise.resolve(this.commit(after, id)).finally(() => {
          // Held a moment past the write, so the list does not flash back to
          // the old order before the liveQuery delivers the new one.
          setTimeout(() => {
            if (!this.dragging) this.preview = null;
          }, 400);
        });
      } else {
        this.preview = null;
      }
      swallowClick();
    };

    const swallowClick = () => {
      const stop = (e: Event) => {
        e.stopPropagation();
        e.preventDefault();
      };
      node.addEventListener('click', stop, { capture: true, once: true });
      setTimeout(() => node.removeEventListener('click', stop, { capture: true }), 400);
    };

    // --- touch
    const onTouchStart = (e: TouchEvent) => {
      if (off) return;
      if (e.touches.length !== 1) return end(false);
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      clearTimer();
      timer = setTimeout(begin, HOLD_MS);
    };
    const onTouchMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!active) {
        if (timer && Math.hypot(t.clientX - startX, t.clientY - startY) > SLOP) clearTimer();
        return;
      }
      e.preventDefault();
      void move(t.clientX, t.clientY);
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (active) e.preventDefault();
      end(true);
    };
    const onTouchCancel = () => end(false);
    // A long press opens the context menu on Android and the link preview on
    // iOS; once it is a drag, neither is wanted.
    const onContext = (e: Event) => {
      if (active || timer) e.preventDefault();
    };

    // --- mouse
    const onPointerDown = (e: PointerEvent) => {
      if (off || e.pointerType !== 'mouse' || e.button !== 0) return;
      startX = e.clientX;
      startY = e.clientY;
      clearTimer();
      timer = setTimeout(begin, HOLD_MS);
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp, { once: true });
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!active) {
        if (timer && Math.hypot(e.clientX - startX, e.clientY - startY) > SLOP) clearTimer();
        return;
      }
      e.preventDefault();
      void move(e.clientX, e.clientY);
    };
    const onPointerUp = () => {
      window.removeEventListener('pointermove', onPointerMove);
      end(true);
    };

    // ON A COMPUTER, the browser has a drag of its own. Holding and moving a
    // LINK (an era's project rows are links) or an image starts the browser's
    // "drag this somewhere" instead, which swallows the mouse — reported as
    // *"long click moving by dragging doesn't seem to work on the computer
    // version"*. Touch never does this, so it only ever broke on a laptop.
    // Cancel it, and the text selection a held mouse starts, on draggable rows.
    const onNativeDrag = (e: Event) => {
      if (!off) e.preventDefault();
    };
    const onSelectStart = (e: Event) => {
      if (!off && (timer || active)) e.preventDefault();
    };
    node.addEventListener('dragstart', onNativeDrag);
    node.addEventListener('selectstart', onSelectStart);
    node.addEventListener('touchstart', onTouchStart, { passive: true });
    node.addEventListener('touchmove', onTouchMove, { passive: false });
    node.addEventListener('touchend', onTouchEnd);
    node.addEventListener('touchcancel', onTouchCancel);
    node.addEventListener('contextmenu', onContext);
    node.addEventListener('pointerdown', onPointerDown);

    return {
      update: (next: string | { id: string; off?: boolean }) => {
        this.nodes.delete(id);
        ({ id, off } = read(next));
        this.nodes.set(id, node);
        applySelect();
      },
      destroy: () => {
        clearTimer();
        if (this.nodes.get(id) === node) this.nodes.delete(id);
        window.removeEventListener('pointermove', onPointerMove);
        node.removeEventListener('touchstart', onTouchStart);
        node.removeEventListener('touchmove', onTouchMove);
        node.removeEventListener('touchend', onTouchEnd);
        node.removeEventListener('touchcancel', onTouchCancel);
        node.removeEventListener('contextmenu', onContext);
        node.removeEventListener('pointerdown', onPointerDown);
        node.removeEventListener('dragstart', onNativeDrag);
        node.removeEventListener('selectstart', onSelectStart);
      }
    };
  };
}


/**
 * A drag that saves as your own order (rank.ts) rather than as a day's or an
 * era's list. `items` is read at drop time, so the positions come from the
 * rows as they are then, not as they were when the list was built.
 */
export function rankedReorder(
  table: 'todos' | 'ideas' | 'buyItems',
  items: () => Rankable[],
  axis: Axis = 'y'
): Reorder {
  return new Reorder((ids, moved) => {
    const byId = new Map(items().map((x) => [x.id, x]));
    const ordered = ids.map((id) => byId.get(id)).filter((x): x is Rankable => !!x);
    return setRanks(table, placement(ordered, moved));
  }, axis);
}
