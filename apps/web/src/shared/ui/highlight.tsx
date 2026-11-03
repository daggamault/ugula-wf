export type TextPart = { text: string; isMatch: boolean };

/** Splits `text` around every case-insensitive occurrence of `query`. */
export const highlightParts = (text: string, query: string): TextPart[] => {
  const needle = query.trim().toLowerCase();
  if (!needle || !text) return text ? [{ text, isMatch: false }] : [];
  const haystack = text.toLowerCase();
  const parts: TextPart[] = [];
  let at = 0;
  for (let found = haystack.indexOf(needle); found !== -1; found = haystack.indexOf(needle, at)) {
    if (found > at) parts.push({ text: text.slice(at, found), isMatch: false });
    parts.push({ text: text.slice(found, found + needle.length), isMatch: true });
    at = found + needle.length;
  }
  if (at < text.length) parts.push({ text: text.slice(at), isMatch: false });
  return parts;
};

const lower = (s: string) => s.toLowerCase();

/**
 * Splits off the start of `text` that `query` matches as a prefix once both are reduced by
 * `keyOf`, for searches that match from the start of a normalized value (like name keys).
 */
export const prefixParts = (
  text: string,
  query: string,
  keyOf: (s: string) => string = lower
): TextPart[] => {
  const whole = text ? [{ text, isMatch: false }] : [];
  const want = keyOf(query.trim());
  if (!want) return whole;
  let built = '';
  let at = 0;
  for (const char of text) {
    built += keyOf(char);
    at += char.length;
    if (built.length < want.length) continue;
    if (!built.startsWith(want)) return whole;
    // Keep combining marks with the letter they belong to.
    for (const mark of text.slice(at)) {
      if (!/\p{M}/u.test(mark)) break;
      at += mark.length;
    }
    const rest = text.slice(at);
    return [
      { text: text.slice(0, at), isMatch: true },
      ...(rest ? [{ text: rest, isMatch: false }] : [])
    ];
  }
  return whole;
};

export type HighlightProps = {
  text: string;
  query: string;
  /** Mark only a match at the start, compared by `keyOf`, to mirror a prefix search. */
  isPrefix?: boolean;
  keyOf?: (s: string) => string;
};

/** Shows `text` with the parts matching a search marked. */
export const Highlight = ({ text, query, isPrefix = false, keyOf }: HighlightProps) => (
  <>
    {(isPrefix ? prefixParts(text, query, keyOf) : highlightParts(text, query)).map((p, i) =>
      p.isMatch ? (
        <mark
          key={i}
          className="bg-warning/35 text-surface-fg rounded-sm [box-decoration-break:clone] px-px"
        >
          {p.text}
        </mark>
      ) : (
        p.text
      )
    )}
  </>
);
