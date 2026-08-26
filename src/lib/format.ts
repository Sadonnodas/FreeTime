/** Small display helpers, shared so two screens can't drift apart. */

/** "today" / "3d ago" / "6w ago". Deliberately vague at the long end — the
 *  difference between 51 and 58 days is not information the user needs. */
export function ago(iso?: string): string {
  if (!iso) return 'not yet';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  if (days < 60) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

/** "3 Aug" — for dated obligations. */
export function shortDate(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y!, m! - 1, d!).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short'
  });
}
