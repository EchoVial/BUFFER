/**
 * "hi im ved" -> "Ved". People answer "what should i call you?" in sentences;
 * keep the name, drop the sentence. Up to two words, capitalised.
 */
const FILLER =
  /\b(hi|hii|hiii|hey|heyy|hello|helo|yo|hiya|heya|sup|there|buffer|please|pls|thanks|thank you|i|am|im|i'm|it's|its|it is|this is|name|my|is|the|call|me|you|can|here|and|so|ok|okay|well|uh|um|hmm|lol|haha)\b/gi;

export function extractName(raw: string): string {
  let t = raw.trim().replace(/[.!?,;:]+$/g, "");
  const m = t.match(/\b(?:i'?m|i am|im|my name is|my name's|name is|names|call me|it'?s me,?|it'?s|this is|its me,?|its|you can call me)\s+([a-z][a-z'\-]*(?:\s+[a-z][a-z'\-]*)?)/i);
  if (m) t = m[1];
  else t = t.replace(FILLER, " ");
  const words = t
    .replace(/[^a-z' \-]/gi, " ")
    .split(/\s+/)
    .filter(Boolean)
    .filter((w) => !/^(here|there|btw)$/i.test(w))
    .slice(0, 2);
  const name = words.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
  return name || raw.trim().split(/\s+/)[0] || "";
}
