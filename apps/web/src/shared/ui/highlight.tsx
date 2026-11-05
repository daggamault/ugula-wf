import { dailyNumberOf } from '@ugula/billing';
import { formatDate } from '../format.ts';

type TextPart = { text: string; isMatch: boolean };

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

type HighlightProps = {
  text: string;
  query: string;
  isPrefix?: boolean;
  keyOf?: (s: string) => string;
};

export const Highlight = ({ text, query, isPrefix = false, keyOf }: HighlightProps) => (
  <>
    {(isPrefix ? prefixParts(text, query, keyOf) : highlightParts(text, query)).map((p, i) =>
      p.isMatch ? (
        <mark key={i} className="bg-warning/35 text-surface-fg [box-decoration-break:clone] px-px">
          {p.text}
        </mark>
      ) : (
        p.text
      )
    )}
  </>
);

export const NumberHighlight = ({ number, query }: { number: string; query: string }) => (
  <Highlight text={number} query={dailyNumberOf(query) === number ? number : ''} />
);

export const DateHighlight = ({ day, query }: { day: string | null; query: string }) => {
  const text = formatDate(day);
  return <Highlight text={text} query={day && query.trim() === day ? text : ''} />;
};
