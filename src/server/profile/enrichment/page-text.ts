/**
 * Plain text from one fetched public-profile page, and the access rules it
 * must respect. Pure functions: no network, no logging.
 *
 * HTML is scanned with indexOf and anchored regexes, never with patterns that
 * can backtrack across the page, so a hostile 1 MiB page stays linear.
 */

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", bull: "•", middot: "·", copy: "©", reg: "®", trade: "™",
  aacute: "á", agrave: "à", acirc: "â", auml: "ä", aring: "å", atilde: "ã", ccedil: "ç", eacute: "é", egrave: "è",
  ecirc: "ê", euml: "ë", iacute: "í", igrave: "ì", icirc: "î", iuml: "ï", ntilde: "ñ", oacute: "ó", ograve: "ò",
  ocirc: "ô", ouml: "ö", oslash: "ø", otilde: "õ", szlig: "ß", uacute: "ú", ugrave: "ù", ucirc: "û", uuml: "ü",
  yacute: "ý", Aacute: "Á", Auml: "Ä", Eacute: "É", Oacute: "Ó", Ouml: "Ö", Uuml: "Ü", Ccedil: "Ç", Ntilde: "Ñ",
};

/** Decodes character references; an unknown named one is left as written. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[\da-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, (whole, entity: string) => {
    if (entity[0] !== "#") return ENTITIES[entity] ?? ENTITIES[entity.toLowerCase()] ?? whole;
    const value = entity[1].toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    return value > 0 && value <= 0x10ffff && !(value >= 0xd800 && value <= 0xdfff) ? String.fromCodePoint(value) : " ";
  });
}

/** At most `max` UTF-16 units, never ending in half of a surrogate pair. */
export function bounded(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return /[\ud800-\udbff]$/.test(cut) ? cut.slice(0, -1) : cut;
}

/** One line of display text: no markup, controls or runs of spaces. */
export function oneLine(text: string, max: number): string {
  return bounded(decodeEntities(text.replace(/<[^<>]{0,500}>/g, "")).replace(/[\u0000-\u001f\u007f-\u009f<>]/g, " ").replace(/\s+/g, " ").trim(), max);
}

/** Pasted or extracted text: controls removed, spaces collapsed per line, blank lines dropped. */
export function tidyText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

/** Charset from the header, else a <meta> in the first 2 KiB, else UTF-8. Unknown labels fall back to UTF-8. */
export function decodePage(bytes: Buffer, contentType: string | undefined): string {
  const fromHeader = /charset\s*=\s*"?([\w.:-]{1,40})/i.exec(contentType ?? "")?.[1];
  const head = bytes.subarray(0, 2048).toString("latin1");
  const fromMeta = /<meta[^>]{0,200}?charset\s*=\s*["']?([\w.:-]{1,40})/i.exec(head)?.[1];
  for (const label of [fromHeader, fromMeta]) {
    if (!label) continue;
    try {
      return new TextDecoder(label).decode(bytes);
    } catch {
      // unsupported label: try the next
    }
  }
  return new TextDecoder().decode(bytes);
}

// Never content: scripts, styles, embedded objects, navigation, page chrome and forms.
const SKIP = new Set([
  "script", "style", "noscript", "template", "svg", "math", "iframe", "object", "embed", "canvas", "video", "audio",
  "head", "title", "nav", "header", "footer", "aside", "form", "button", "select", "textarea", "dialog",
]);
const BLOCK = new Set([
  "address", "article", "blockquote", "br", "dd", "div", "dl", "dt", "figcaption", "figure", "h1", "h2", "h3", "h4", "h5",
  "h6", "hr", "li", "main", "ol", "p", "pre", "section", "table", "td", "th", "tr", "ul",
]);

/** The <main> (or else <article>) part of the page when it has one, from its first opening to its last closing tag. */
function mainPart(html: string): string | null {
  for (const name of ["main", "article"]) {
    const open = new RegExp(`<${name}\\b`, "i").exec(html);
    if (!open) continue;
    const closing = new RegExp(`</${name}\\s*>`, "gi");
    let end = -1;
    for (let match = closing.exec(html); match; match = closing.exec(html)) end = match.index;
    if (end > open.index) return html.slice(open.index, end);
  }
  return null;
}

/** Visible text of the page's main content, one block per line. */
export function htmlToText(html: string): string {
  const main = mainPart(html);
  const source = main ?? html;
  // Inside <main>/<article>, a header or footer belongs to the content (often the person's name), not the site.
  const skip = (name: string) => SKIP.has(name) && !(main && (name === "header" || name === "footer"));
  let out = "";
  let i = 0;
  while (i < source.length) {
    const lt = source.indexOf("<", i);
    if (lt === -1) {
      out += source.slice(i);
      break;
    }
    out += source.slice(i, lt);
    if (source.startsWith("<!--", lt)) {
      const end = source.indexOf("-->", lt + 4);
      i = end === -1 ? source.length : end + 3;
      continue;
    }
    const gt = source.indexOf(">", lt + 1);
    if (gt === -1) break;
    i = gt + 1;
    const tag = /^<(\/?)([a-z][a-z\d-]{0,30})/i.exec(source.slice(lt, Math.min(gt + 1, lt + 40)));
    if (!tag) continue; // doctype, processing instruction or a stray "<"
    const name = tag[2].toLowerCase();
    if (!tag[1] && skip(name) && source[gt - 1] !== "/") {
      // Skip to this element's closing tag. HTML may leave </head> out, so <body> also ends a head;
      // any other unclosed element hides the rest of the page.
      const close = new RegExp(name === "head" ? "</head\\s*>|<body\\b" : `</${name}\\s*>`, "gi");
      close.lastIndex = i;
      const found = close.exec(source);
      i = found ? found.index + (found[0].startsWith("</") ? found[0].length : 0) : source.length;
      out += "\n";
      continue;
    }
    if (BLOCK.has(name)) out += "\n";
  }
  return tidyText(decodeEntities(out).replace(/[<>]/g, " "));
}

/** The page's title: og:title, else <title>, else nothing. */
export function pageTitle(html: string): string {
  const og = /<meta\s[^>]{0,300}?property\s*=\s*["']og:title["'][^>]{0,300}?content\s*=\s*"([^"]{1,500})"/i.exec(html)?.[1];
  const title = /<title[^>]{0,100}>([\s\S]{1,1000}?)<\/title/i.exec(html)?.[1];
  return oneLine(og ?? title ?? "", 300);
}

/** A robots directive (meta tag or X-Robots-Tag) that asks not to be indexed or used. */
export function robotsDirectiveBlocks(html: string, header: string | string[] | undefined, token: string): boolean {
  const blocks = (value: string) => /\b(noindex|none)\b/i.test(value);
  const headers = (Array.isArray(header) ? header : header ? [header] : []).flatMap((h) => h.split(/,(?=\s*[\w-]+\s*:)/));
  for (const value of headers) {
    const agent = /^\s*([\w-]+)\s*:\s*(.*)$/.exec(value);
    // "googlebot: noindex" is for that crawler only; an unnamed directive is for everyone.
    if (agent && !/^(noindex|none|nofollow|all|noarchive|nosnippet)$/i.test(agent[1])) {
      if ([token.toLowerCase(), "robots"].includes(agent[1].toLowerCase()) && blocks(agent[2])) return true;
    } else if (blocks(value)) return true;
  }
  const names = ["robots", token.toLowerCase()];
  for (const meta of html.matchAll(/<meta\s[^>]{0,500}>/gi)) {
    const name = /\bname\s*=\s*["']?([\w-]+)/i.exec(meta[0])?.[1]?.toLowerCase();
    const content = /\bcontent\s*=\s*["']([^"']{0,200})/i.exec(meta[0])?.[1] ?? "";
    if (name && names.includes(name) && blocks(content)) return true;
  }
  return false;
}

/** A password field: the page is a login wall, not a public profile. */
export function hasLoginForm(html: string): boolean {
  return /<input\s[^>]{0,500}?type\s*=\s*["']?password\b/i.test(html);
}

/** Does `pattern` (robots.txt: `*` any run, trailing `$` end) match the start of `path`? Linear in practice, no regex. */
function robotsMatch(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith("$");
  const p = anchored ? pattern.slice(0, -1) : pattern;
  let i = 0;
  let j = 0;
  let star = -1;
  let resume = 0;
  while (j < path.length) {
    if (i < p.length && p[i] !== "*" && p[i] === path[j]) {
      i++;
      j++;
    } else if (i < p.length && p[i] === "*") {
      star = i++;
      resume = j;
    } else if (i === p.length && !anchored) {
      return true; // prefix matched
    } else if (star !== -1) {
      i = star + 1;
      j = ++resume;
    } else {
      return false;
    }
  }
  while (i < p.length && p[i] === "*") i++;
  return i === p.length;
}

/**
 * RFC 9309: the groups naming `token` (else `*`) apply; the longest matching
 * rule wins and Allow wins a tie. No matching rule means allowed.
 */
export function robotsAllows(robots: string, path: string, token: string): boolean {
  type Group = { agents: string[]; rules: { allow: boolean; pattern: string }[] };
  const groups: Group[] = [];
  let current: Group | null = null;
  let collectingAgents = false;
  for (const raw of robots.split(/\r\n|\r|\n/).slice(0, 10_000)) {
    const line = /^\s*([a-z-]+)\s*:\s*([^#]*)/i.exec(raw);
    if (!line) continue;
    const key = line[1].toLowerCase();
    const value = line[2].trim();
    if (key === "user-agent") {
      if (!current || !collectingAgents) groups.push((current = { agents: [], rules: [] }));
      current.agents.push(value.toLowerCase());
      collectingAgents = true;
    } else if ((key === "allow" || key === "disallow") && current) {
      collectingAgents = false;
      if (value && value.length <= 2000) current.rules.push({ allow: key === "allow", pattern: value });
    }
  }
  const me = token.toLowerCase();
  const named = groups.filter((g) => g.agents.includes(me));
  const rules = (named.length ? named : groups.filter((g) => g.agents.includes("*"))).flatMap((g) => g.rules).slice(0, 2000);
  let best: { allow: boolean; length: number } | null = null;
  for (const rule of rules) {
    if (!robotsMatch(rule.pattern, path)) continue;
    const length = rule.pattern.length;
    if (!best || length > best.length || (length === best.length && rule.allow)) best = { allow: rule.allow, length };
  }
  return best?.allow ?? true;
}
