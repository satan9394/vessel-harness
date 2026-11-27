/**
 * Display labels for workspace roots.
 *
 * `projectName()` only keeps the last path segment, so a machine with several
 * `...\ws` workspaces shows a column of indistinguishable `ws` rows. These
 * helpers keep that behaviour for an unambiguous list and add a disambiguating
 * parent-directory (or short-hash) suffix only when two roots share a basename.
 *
 * Display only: no root path is ever rewritten or persisted.
 */

/** Last path segment, matching the historical `projectName()` behaviour. */
export function projectName(root: string): string {
  return root.split(/[\\/]/).filter(Boolean).at(-1) || root;
}

/** Directory containing the root, or '' for a bare drive/relative segment. */
function parentName(root: string): string {
  const parts = root.split(/[\\/]/).filter(Boolean);
  return parts.length > 1 ? parts.at(-2)! : '';
}

/**
 * FNV-1a digest of the full root, used only as a last resort.
 *
 * The *raw* root is hashed — no case folding, no locale: `toLocaleLowerCase()`
 * would map `…\ws` and `…\Ws` to the same digest (so two case-only-different
 * roots would still collide) and would drift across system locales.
 */
function shortHash(root: string, length = 4): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < root.length; index += 1) {
    hash ^= root.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  const full = (hash >>> 0).toString(16).padStart(8, '0');
  return full.slice(0, Math.min(Math.max(length, 1), 8));
}

/** Case-insensitive membership test; locale-free so labels do not depend on it. */
function taken(used: ReadonlySet<string>, label: string): boolean {
  return used.has(label.toLowerCase());
}

/**
 * Longest parent-directory suffix kept in a label. The sidebar row is ~220px
 * wide, so a longer suffix would be clipped at exactly the end that tells the
 * two workspaces apart; the tail is kept and the head elided instead.
 */
const MAX_SUFFIX = 22;

function parentSuffix(root: string): string {
  const parent = parentName(root);
  if (!parent) return '';
  return parent.length <= MAX_SUFFIX ? parent : `…${parent.slice(-(MAX_SUFFIX - 1))}`;
}

/**
 * Claim a label for `root`, growing the suffix until it is unused.
 *
 * Two different roots can never end up with the same label: the seeded 4-hex
 * digest is retried at 6 and 8 hex, then extended with a counter, and every
 * accepted final string is what gets recorded in `used`.
 */
function claim(base: string, root: string, used: Set<string>): string {
  if (!taken(used, base)) return base;
  for (const length of [4, 6, 8]) {
    const candidate = `${base} (${shortHash(root, length)})`;
    if (!taken(used, candidate)) return candidate;
  }
  for (let counter = 2; ; counter += 1) {
    const candidate = `${base} (${shortHash(root, 8)}-${counter})`;
    if (!taken(used, candidate)) return candidate;
  }
}

/**
 * Map every root to a label that is unique within this list.
 *
 * - distinct basenames are returned untouched (`Vessel_Harness`);
 * - roots sharing a basename get `ws · vessel-geom2-SDP7GI`, falling back to
 *   `ws (a1b2)` when the parents also collide; when the parent itself had to be
 *   elided the digest moves in front of it (`ws (a1b2) · …suffix`) because the
 *   row clips its end and the digest is the only distinguishing part;
 * - basename comparison is case-insensitive because Windows paths are, but the
 *   displayed text keeps the original casing;
 * - the returned labels are pairwise distinct by construction: every accepted
 *   label is claimed through `claim()`, which lengthens the digest (4 → 6 → 8
 *   hex) and then adds a counter until the final string is unused.
 */
export function projectLabels(roots: readonly string[]): Map<string, string> {
  const unique = [...new Set(roots)];
  const labels = new Map<string, string>();
  const used = new Set<string>();

  const groups = new Map<string, string[]>();
  for (const root of unique) {
    const key = projectName(root).toLowerCase();
    const group = groups.get(key);
    if (group) group.push(root);
    else groups.set(key, [root]);
  }

  // Unambiguous names first, so they keep today's label exactly.
  for (const group of groups.values()) {
    if (group.length !== 1) continue;
    const root = group[0]!;
    const label = projectName(root);
    labels.set(root, label);
    used.add(label.toLowerCase());
  }

  for (const group of groups.values()) {
    if (group.length === 1) continue;
    // Group the duplicated roots by their parent-derived stem, case-insensitively
    // (`ws · tmp` and `Ws · tmp` are one stem for display purposes). A stem
    // claimed by a single root stays readable; a stem shared by several roots
    // gets a digest for every member, chosen from that member's own path so the
    // result does not depend on list order.
    const stems = new Map<string, string[]>();
    const stemOf = (root: string): string => {
      const suffix = parentSuffix(root);
      return suffix ? `${projectName(root)} · ${suffix}` : `${projectName(root)} (${shortHash(root)})`;
    };
    for (const root of group) {
      const key = stemOf(root).toLowerCase();
      const entry = stems.get(key);
      if (entry) entry.push(root);
      else stems.set(key, [root]);
    }
    for (const members of stems.values()) {
      const candidates = members.map((root) => {
        if (members.length === 1) return stemOf(root);
        let length = 4;
        for (; length < 8; length += 2) {
          const prefix = shortHash(root, length);
          if (!members.some((other) => other !== root && shortHash(other, length) === prefix)) break;
        }
        const digest = shortHash(root, length);
        const suffix = parentSuffix(root);
        // An elided parent (`…tail`) is identical for every member of this stem,
        // and `.side-item` clips the *end* of the row, so a digest appended after
        // it would be the first thing cut — leaving two rows that render the same.
        // Put the digest before the parent there; short parents stay readable
        // with the digest at the end (`ws · tmp (6cea)`).
        return suffix.startsWith('…')
          ? `${projectName(root)} (${digest}) · ${suffix}`
          : `${stemOf(root)} (${digest})`;
      });
      members.forEach((root, index) => {
        const label = claim(candidates[index]!, root, used);
        labels.set(root, label);
        used.add(label.toLowerCase());
      });
    }
  }

  return labels;
}

/** Label for one root out of a list, falling back to the bare basename. */
export function labelFor(labels: ReadonlyMap<string, string>, root: string): string {
  return labels.get(root) ?? projectName(root);
}
