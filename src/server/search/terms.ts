/**
 * The request matcher's keywords: what a question is about, without how it's asked. A sharpened
 * question ("How does Raft handle voting in practice, and where does that tend to break?") is full
 * of words that match almost anyone's evidence (practice, break, handle, check, first); matching
 * on them ranks people who share none of the topic. Keyword search uses only the content words;
 * semantic search and reranking still read the whole question.
 */

/** Grammar words. */
const STOP = [
  "i", "a", "an", "the", "to", "at", "in", "on", "of", "how", "want", "works", "work", "does", "do", "did", "with", "and", "or",
  "for", "is", "it", "its", "my", "me", "get", "specifically", "what", "about", "are", "was", "were", "be", "been", "being", "am",
  "you", "your", "yours", "we", "our", "us", "they", "them", "their", "he", "she", "his", "her", "this", "that", "these", "those",
  "there", "here", "if", "so", "but", "not", "no", "yes", "by", "as", "from", "into", "than", "then", "too", "very", "just",
];

/** Words about the asking, or about meeting, that say nothing about the topic. */
const ASKING = [
  "where", "when", "why", "which", "who", "whom", "would", "could", "should", "can", "will", "shall", "may", "might", "must",
  "have", "has", "had", "having", "any", "some", "all", "more", "most", "much", "many", "other", "own", "one", "ones",
  "practice", "practical", "tend", "tends", "break", "breaks", "handle", "handles", "check", "first", "start", "common",
  "mistake", "mistakes", "avoid", "fall", "short", "fix", "fixed", "seen", "path", "biggest", "difference", "made", "make",
  "makes", "making", "experience", "experiences", "use", "used", "using", "best", "good", "better", "way", "ways", "thing",
  "things", "stuff", "help", "helped", "helps", "know", "learn", "understand", "explain", "walk", "through", "think", "thoughts",
  "look", "looks", "looking", "like", "need", "needs", "try", "trying", "tried", "found", "find",
  "someone", "anyone", "people", "person", "question", "questions", "ask", "asking", "chat", "talk", "meet", "minutes",
  "hard", "easy", "really", "actually", "basically", "kind", "sort", "lot", "lots", "well", "also", "still", "again",
  "consider", "role", "part", "take", "taken", "want", "wanted", "happy", "worth", "case", "cases",
];

const IGNORED = new Set([...STOP, ...ASKING]);

/** Lowercase keywords: two or more characters, not grammar or asking words. */
export function contentTerms(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !IGNORED.has(t));
}

/** The question as keywords only, for keyword search; the whole text if it has none. */
export function keywordQuery(text: string): string {
  const terms = contentTerms(text);
  return terms.length ? terms.join(" ") : text;
}
