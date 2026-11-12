import type { AskType } from "@/contracts/types";
import type { AiService } from "./index";
import { AskBlockedError } from "./blocked";
import { MEETING_MINUTES } from "./minutes";

function classify(text: string): AskType {
  const t = text.toLowerCase();
  if (/\b(collaborat|co-?author|work(ing)? together|team up|partner)|\bwith me\b/.test(t)) return "collaboration";
  if (/\b(hire|hiring|recruit\w*|candidates?)\b/.test(t)) return "hiring";
  if (/\b(job|role|career|interview|referral|hired|work at|get into|break into)\b/.test(t)) return "career";
  if (/\blooking for\b/.test(t)) return "hiring";
  return "knowledge";
}

/*
 * The rule-based rewriter behind the canned refineAsk. It tidies the ask, spots its
 * shape (how something works, how to do something, a comparison, a problem, a career
 * move...) and turns it into one answerable question for one person. Each shape has a
 * few phrasings, picked by a hash of the text, so different asks read differently and
 * the same ask always gets the same suggestion. It only rearranges the asker's words:
 * every term they typed is kept, and nothing (no product, name or fact) is added.
 */

const MAX_WORDS = 40;
const QUESTION_WORD = /^(how|what|what's|why|when|where|which|who|is|are|was|were|do|does|did|can|could|should|would|will|has|have)\b/i;
const NOT_A_TOPIC = new Set(["the", "a", "an", "some", "this", "that", "any", "of", "with", "about", "on", "and", "or"]);
const SPELLING: Record<string, string> = {
  i: "I", im: "I'm", ive: "I've", dont: "don't", doesnt: "doesn't", cant: "can't", isnt: "isn't",
  whats: "what's", wanna: "want to", gonna: "going to",
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const asQuestion = (s: string) => `${cap(s)}?`;
const asSentence = (s: string) => `${cap(s)}.`;
const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

function seed(text: string): number {
  let h = 0;
  for (const c of text.toLowerCase()) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}

/** Spacing, spelling, throat-clearing and vague filler; drops the end punctuation. */
function tidy(raw: string): string {
  let t = raw.replace(/\s+/g, " ").trim();
  const lead = /^(?:hey|hi|hello|so|ok|okay|um+|uh+|quick question)\b[,:!.\s-]*/i;
  while (lead.test(t) && t.replace(lead, "")) t = t.replace(lead, "");
  return t
    .replace(/\b(i|im|ive|dont|doesnt|cant|isnt|whats|wanna|gonna)\b(?!\.)/gi, (w) => SPELLING[w.toLowerCase()])
    .replace(/\b(?:basically|kinda|sorta|literally)\b,?\s*/gi, "")
    .replace(/\bdo (?:the|that|this) ((?:[\w-]+ ){0,2}[\w-]+) thing\b/gi, "handle $1")
    .replace(/\b(?:the|that|this) (?:whole )?((?:[\w-]+ ){0,2}[\w-]+) thing\b/gi, (_, x: string) => (/ing$/i.test(x) ? x : `the ${x}`))
    .replace(/,?\s+(?:and|or) (?:stuff|things|whatever|so on|something like that)\b/gi, "")
    .replace(/\b([\w-]+) stuff\b/gi, (m, x: string) => (NOT_A_TOPIC.has(x.toLowerCase()) ? m : x))
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[\s,;:.?!]+$/, "");
}

/** "I want to understand how X works" -> "how does X work"; "can you explain eBPF" -> "eBPF". */
function dropPreamble(t: string): string {
  const intro = /^(?:I(?:'d| would)? (?:really )?(?:want|like|love|need) to (?:understand|know(?: more)?(?: about)?|learn(?: more)?(?: about)?|figure out|hear about)|I'm (?:curious|wondering)(?: about)?|I was wondering|I wonder|(?:can|could) you (?:explain|tell me(?: about)?)|tell me(?: about)?|explain)\s+/i;
  const m = intro.exec(t);
  if (m && !/^(?:if|whether)\b/i.test(t.slice(m[0].length))) t = t.slice(m[0].length);
  return t.replace(/^how (?!(?:does|do|is|are|did|can|could|should|would|to)\b)(.+?) (works?)\b/i,
    (_, x: string, verb: string) => `how ${verb === "works" ? "does" : "do"} ${x} work`);
}

type Shape = (t: string, n: number) => string | undefined;
const pick = (n: number, options: string[]) => options[n % options.length];

const compare: Shape = (t, n) => {
  const m = /^(?:should (?:I|we) (?:use|pick|choose|go with)|is it better to use|(?:which|what)(?:'s| is) better[,:]?|what(?:'s| is) the difference between)\s+(.+?)\s+(?:or|and)\s+(.+)$/i.exec(t)
    ?? /^(?:thoughts on |opinions on )?(.+?)\s+(?:vs\.?|versus)\s+(.+)$/i.exec(t);
  if (!m) return;
  const [, a, b] = m;
  return pick(n, [
    `When would you pick ${a} over ${b}, and what decided it on a real project?`,
    `Between ${a} and ${b}, which would you choose today, and what trade-off tipped it?`,
    `Have you used both ${a} and ${b}? Where did each one fall short for you?`,
  ]);
};

const howTo: Shape = (t, n) => {
  const m = /^(?:how (?:do|can|should|would|could) (?:I|we|you|one)|how to|what(?:'s| is) the best way to|best way to)\s+(.+)$/i.exec(t);
  if (!m) return;
  const ask = /^how (?:do|can|should|would|could) /i.test(t) ? asQuestion(t) : `How would you ${m[1]}?`;
  return `${ask} ${pick(n, [
    "What would you check first, and what's a common mistake to avoid?",
    "Where would you start, and what tripped you up the first time?",
    "What's the first thing you'd look at, and what do people usually miss?",
  ])}`;
};

const howItWorks: Shape = (t, n) => {
  const m = /^how (does|do) (.+)$/i.exec(t);
  if (!m) return;
  const ask = `How ${m[1].toLowerCase()} ${m[2]}`;
  return pick(n, [
    `${ask} in practice, and where does that tend to break?`,
    `${ask} in practice? What's the part people most often misunderstand?`,
    `${ask}, and what edge case has caught you out with it?`,
  ]);
};

const why: Shape = (t, n) => {
  if (!/^why (does|do|is|are|did|would|can't|doesn't)\b/i.test(t)) return;
  return pick(n, [
    `${asQuestion(t)} Have you run into it yourself, and what did you do about it?`,
    `${asQuestion(t)} What's usually behind it, and how have you dealt with it?`,
  ]);
};

const whatIs: Shape = (t, n) => {
  const m = /^what(?:'s| is| are)\s+(.+)$/i.exec(t);
  if (!m || words(m[1]) > 6) return;
  return pick(n, [
    `What do you actually use ${m[1]} for, and when is it not worth it?`,
    `Where has ${m[1]} helped you most, and where did it fall short?`,
    `What problem does ${m[1]} solve best, and when would you skip it?`,
  ]);
};

const problem: Shape = (t, n) => {
  if (QUESTION_WORD.test(t)) return;
  const symptom = /\b(?:keeps?|kept) [\w-]+ing\b|\b(?:is|are|was|were|seems?|gets?) (?:really |very |so )?(?:slow|broken|failing|crashing|stuck|flaky|timing out|down|hanging|leaking)\b|\b(?:won't|doesn't|does not|can't|cannot|isn't|aren't|never) \w+|\b(?:fails?|failing|crash(?:es|ing)?|errors?|timeouts?|leaks?|leaking)\b/i;
  if (!symptom.test(t)) return;
  return `${asSentence(t)} ${pick(n, [
    "What would you check first, and what usually turns out to be the cause?",
    "Where would you start debugging that, and what fixed it when you've seen it?",
    "Have you hit that yourself, and what made the difference?",
  ])}`;
};

const fallback: Shape = (t, n) => {
  if (QUESTION_WORD.test(t)) {
    return `${asQuestion(t)} ${pick(n, [
      "What's your own experience been?",
      "What would you tell someone new to it?",
      "What have you seen work in practice?",
    ])}`;
  }
  if (/^(?:I|I'm|I've|we|we're|my|our|it|it's|this|that|there)\b/i.test(t) || words(t) > 8) {
    return `${asSentence(t)} ${pick(n, [
      "Does that match what you've seen, and what would you do?",
      "How would you approach it, from your own experience?",
      "What's your take, and what would you try first?",
    ])}`;
  }
  return pick(n, [
    `What's your experience with ${t}, and what do people most often get wrong about it?`,
    `What should someone know about ${t} that the docs don't cover?`,
    `Where does ${t} get hard in practice, and how have you dealt with it?`,
  ]);
};

const KNOWLEDGE: Shape[] = [compare, howTo, howItWorks, why, whatIs, problem, fallback];

function career(t: string, n: number): string {
  const opener = QUESTION_WORD.test(t) ? asQuestion(t) : asSentence(t);
  const follow = /\binterview/i.test(t)
    ? ["What did your own preparation look like, and what mattered most on the day?",
       "What would you focus on if you were preparing again?",
       "How did you prepare for yours, and what would you skip next time?"]
    : ["What did your own path look like, and what made the biggest difference?",
       "How did you get to where you are, and what would you do differently now?",
       "What do you wish you'd known earlier in your own career?"];
  return `${opener} ${pick(n, follow)}`;
}

function hiring(t: string, n: number): string {
  if (QUESTION_WORD.test(t)) return `${asQuestion(t)} ${pick(n, ["What would you want to know about it first?", "Could we find time to talk it through?"])}`;
  const pitch = /^(?:hiring|recruiting|looking for)\b/i.test(t) ? `We're ${t}` : t;
  return `${asSentence(pitch)} ${pick(n, [
    "Would you be open to a chat about it?",
    "Is that something you'd consider, and what would you want to know first?",
    "Would that interest you, and what would make a move like that worth it?",
  ])}`;
}

function collaboration(t: string, n: number): string {
  const invite = t
    .replace(/^(?:does |is )?(?:anyone|anybody|someone|somebody) (?:wants?|wanna) to\s+/i, "would you want to ")
    .replace(/^who wants to\s+/i, "would you want to ")
    .replace(/^(?:is )?(?:anyone|anybody|someone|somebody|who(?:'s| is)) (interested|keen) in\s+/i, "would you be $1 in ")
    .replace(/^(?:is )?(?:anyone|anybody|someone|somebody|who(?:'s| is)) up for\s+/i, "would you be up for ");
  if (QUESTION_WORD.test(invite)) {
    return `${asQuestion(invite)} ${pick(n, [
      "If so, which part would you want to take on?",
      "If so, where would you start?",
      "What would you want to get out of it?",
    ])}`;
  }
  return `${asSentence(invite)} ${pick(n, [
    "Would you be up for it, and which part would you take on?",
    "Would that interest you, and where would you start?",
    "Is that something you'd want to do together?",
  ])}`;
}

/** A sharper question for one person, in the asker's own terms. */
export function sharpen(rawText: string, type: AskType): string {
  const tidied = tidy(rawText);
  if (!tidied) return rawText.trim();
  const n = seed(tidied);
  let text: string;
  if (type === "career") text = career(tidied, n);
  else if (type === "hiring") text = hiring(tidied, n);
  else if (type === "collaboration") text = collaboration(tidied, n);
  else {
    const t = dropPreamble(tidied);
    text = KNOWLEDGE.reduce<string | undefined>((found, shape) => found ?? shape(t, n), undefined)!;
  }
  // Too long to add to: the tidied ask, as a question, is still better than the raw one.
  return words(text) <= MAX_WORDS ? text : asQuestion(tidied);
}

/** Deterministic stand-in for the model; tests and the fake API rely on it costing nothing. */
export const cannedAi: AiService = {
  async refineAsk(rawText) {
    await cannedAi.moderate(rawText);
    const type = classify(rawText);
    return { text: sharpen(rawText, type), type, minutes: MEETING_MINUTES };
  },

  async moderate(text) {
    // Stands in for moderation, so the blocked-ask screen can be built with the fake API.
    if (/\bidiot\b/i.test(text)) throw new AskBlockedError();
  },

  async explain(ask, candidates) {
    // No fit, so the fake API and fallbacks never drop anyone; except "[demo:nearest]" in the ask, which rates
    // everyone a partial fit so screens can show "no close match" (the real model judges each person).
    const nearest = ask.text.includes("[demo:nearest]");
    return candidates.map((c) => ({
      why: c.highlights.length ? `Evidence: ${c.highlights[0]}.` : `Profile mentions what you're asking about.`,
      ...(nearest ? { fit: "partial" as const } : {}),
    }));
  },
};
