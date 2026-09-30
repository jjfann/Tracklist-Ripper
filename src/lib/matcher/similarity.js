// Fuzzy string similarity tuned for song titles / artist names.

export function normalizeForMatch(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/&/g, ' and ')
    .replace(/\$/g, 's') // Ke$ha, A$AP
    .replace(/['`’]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokens(s) {
  const n = normalizeForMatch(s);
  return n ? n.split(' ') : [];
}

export function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

function levRatio(a, b) {
  const max = Math.max(a.length, b.length);
  return max ? 1 - levenshtein(a, b) / max : 1;
}

/**
 * 0..1 similarity. Combines token overlap (order-insensitive), edit distance
 * (typos) and containment (extra words on one side).
 */
export function similarity(a, b) {
  const na = normalizeForMatch(a);
  const nb = normalizeForMatch(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.replace(/ /g, '') === nb.replace(/ /g, '')) return 0.97; // "lofi" / "lo fi"

  const ta = new Set(na.split(' '));
  const tb = new Set(nb.split(' '));
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const dice = (2 * inter) / (ta.size + tb.size);
  const contain = inter / Math.min(ta.size, tb.size);

  const sortedA = [...ta].sort().join(' ');
  const sortedB = [...tb].sort().join(' ');
  let s = Math.max(dice, levRatio(na, nb), levRatio(sortedA, sortedB));
  if (contain === 1) s = Math.max(s, 0.55 + 0.35 * dice);
  return s;
}
