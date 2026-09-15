import type { Action } from 'svelte/action';

/**
 * Moves an element to the end of <body> for as long as it is mounted.
 *
 * For the printable paper laid over the app: printing has to show ONLY the
 * paper, and the simplest reliable way to say "only this" in a print
 * stylesheet is "hide every child of body except this one" — which needs it to
 * BE a child of body, rather than buried inside the scrolling app shell whose
 * height, overflow and chrome all fight a printer.
 */
export const portal: Action<HTMLElement> = (node) => {
  document.body.appendChild(node);
  return {
    destroy() {
      node.remove();
    }
  };
};
