// The kinds of AI challenge Tutorise raises against AI tutor responses, in the
// order the owner lists them. Names coming from the backend are matched
// loosely ("response_unsure", "RESPONSE_UNSURE", "ResponseUnsure" …).
export const AI_TYPES = [
  'Response unsure',
  'Content drift',
  'Reported errors',
  'Reversals',
  'Rule breaks',
  'Unsupported claims',
  'Board claims',
  'Verifier findings',
  'Educator',
];

const key = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const singular = (s) => s.replace(/s$/, '');
const CANON = AI_TYPES.map((label) => ({ label, k: singular(key(label)) }));

/** Map a backend type name to its display label (unknown names are kept, tidied). */
export function aiTypeLabel(name) {
  const k = singular(key(name));
  if (!k) return 'Other';
  const hit = CANON.find((c) => k === c.k || k.startsWith(c.k) || (k.length >= 5 && c.k.startsWith(k)));
  if (hit) return hit.label;
  const t = String(name).replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim().toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}
