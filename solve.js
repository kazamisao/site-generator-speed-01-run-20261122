// A faster drop-in for makefun-site 1.0.0 (site-generator-speed-01-run-20261122).
//
// Written from the makefun-site README's rules and its reference code's behaviour,
// in my own structure: one fused pass over each source, templates compiled once per
// case into flat node arrays, and output assembled into parts arrays joined once.
// No dependency, no clock, no randomness, no file or environment reads: the answer
// is a function of the input alone, exactly as the reference's is.

/** Code-unit order (never the locale's). */
const byCodeUnits = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** The HTML escape table, in the reference's order: & < > " ' (README, "Text"). */
const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** `text` with & < > " and ' escaped. A native regex scan; a string with nothing to escape is returned as-is. */
const ESC_RE = /[&<>"']/g;
function escapeHtml(text) {
  return text.replace(ESC_RE, (c) => ESCAPES[c]);
}

/** The most characters a slug keeps before a collision suffix. */
const SLUG_MAX = 64;

/** The slug of pure-ASCII `text`: A-Z lowered, every run of other characters one "-", none at either end. */
function slugAscii(text) {
  let out = '';
  let gap = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    let keep = -1;
    if (c >= 65 && c <= 90) keep = c + 32;
    else if ((c >= 97 && c <= 122) || (c >= 48 && c <= 57)) keep = c;
    if (keep === -1) {
      gap = out.length > 0;
      continue;
    }
    if (gap) out += '-';
    gap = false;
    out += String.fromCharCode(keep);
  }
  out = out.slice(0, SLUG_MAX).replace(/-+$/, '');
  return out === '' ? 'untitled' : out;
}

/** The slug of `text`: NFKD, combining marks dropped, then the ASCII rule above. */
function slugUnicode(text) {
  const plain = text.normalize('NFKD').replace(/\p{M}/gu, '');
  let out = '';
  let gap = false;
  for (const ch of plain) {
    let keep = null;
    if (ch >= 'A' && ch <= 'Z') keep = ch.toLowerCase();
    else if ((ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9')) keep = ch;
    if (keep === null) {
      gap = out.length > 0;
      continue;
    }
    if (gap) out += '-';
    gap = false;
    out += keep;
  }
  out = out.slice(0, SLUG_MAX).replace(/-+$/, '');
  return out === '' ? 'untitled' : out;
}

/** `slug` made unique against `taken` (and added to it): the first of slug, slug-2, slug-3 ... not taken. */
function uniqueSlug(slug, taken) {
  let out = slug;
  for (let n = 2; taken.has(out); n++) out = `${slug}-${n}`;
  taken.add(out);
  return out;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** A YYYY-MM-DD date in words, from the string alone: "2026-11-09" is "9 November 2026". */
function longDate(date) {
  const y = date.slice(0, 4);
  const m = date.slice(5, 7);
  const d = date.slice(8, 10);
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
}

// ---------------------------------------------------------------- front matter

/** The keys a source's front matter may give. */
const FM_KEYS = ['title', 'date', 'tags', 'draft', 'layout', 'slug', 'summary'];

/** The days of month `m` (1-12) of year `y`, by the Gregorian rule. */
function daysIn(y, m) {
  if (m === 2) return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28;
  return m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31;
}

/** A string value: "..." with \" and \\ its only escapes, or bare, the rest of the line (never opening on " or [). */
function stringOf(raw) {
  if (raw[0] === '"') {
    if (raw.length < 2 || raw[raw.length - 1] !== '"') return { error: 'a quoted string is not closed' };
    const parts = [];
    for (let i = 1; i < raw.length - 1; i++) {
      const c = raw[i];
      if (c === '\\') {
        const n = raw[i + 1];
        if ((n !== '"' && n !== '\\') || i + 1 === raw.length - 1) return { error: 'a quoted string holds an escape other than \\" or \\\\' };
        parts.push(n);
        i++;
      } else if (c === '"') return { error: 'a quoted string holds a stray quote' };
      else parts.push(c);
    }
    return { value: parts.join('') };
  }
  if (raw[0] === '[') return { error: 'a bare string opens on [' };
  return { value: raw };
}

/** One key's value, or why it is refused. */
function valueOf(key, raw) {
  switch (key) {
    case 'title':
    case 'summary': {
      const s = stringOf(raw);
      return 'error' in s ? { error: `key "${key}": ${s.error}` } : s;
    }
    case 'date': {
      const ok = raw.length === 10 && raw[4] === '-' && raw[7] === '-'
        && raw[0] >= '0' && raw[0] <= '9' && raw[1] >= '0' && raw[1] <= '9'
        && raw[2] >= '0' && raw[2] <= '9' && raw[3] >= '0' && raw[3] <= '9'
        && raw[5] >= '0' && raw[5] <= '9' && raw[6] >= '0' && raw[6] <= '9'
        && raw[8] >= '0' && raw[8] <= '9' && raw[9] >= '0' && raw[9] <= '9';
      const y = ok ? Number(raw.slice(0, 4)) : 0;
      const mo = ok ? Number(raw.slice(5, 7)) : 0;
      const d = ok ? Number(raw.slice(8, 10)) : 0;
      if (!ok || y < 1970 || y > 2099 || mo < 1 || mo > 12 || d < 1 || d > daysIn(y, mo)) return { error: 'key "date": not a date from 1970-01-01 to 2099-12-31 (YYYY-MM-DD)' };
      return { value: raw };
    }
    case 'tags': {
      if (raw[0] !== '[' || raw[raw.length - 1] !== ']') return { error: 'key "tags": not a list [a, b]' };
      const inner = raw.slice(1, -1);
      if (inner.trim() === '') return { value: [] };
      const tags = inner.split(',').map((t) => t.trim());
      for (const t of tags) {
        if (t === '') return { error: 'key "tags": an empty tag, or one holding " [ or ]' };
        for (let i = 0; i < t.length; i++) {
          const c = t[i];
          if (c === '"' || c === '[' || c === ']') return { error: 'key "tags": an empty tag, or one holding " [ or ]' };
        }
      }
      return { value: tags };
    }
    case 'draft':
      return raw === 'true' ? { value: true } : raw === 'false' ? { value: false } : { error: 'key "draft": true or false' };
    case 'layout': {
      let good = raw.length > 0;
      for (let i = 0; i < raw.length; i++) {
        const c = raw.charCodeAt(i);
        if (!((c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 45)) { good = false; break; }
      }
      return good ? { value: raw } : { error: 'key "layout": not a template name' };
    }
    case 'slug': {
      let good = raw.length > 0 && raw.length <= 64;
      let prevDash = true;
      for (let i = 0; i < raw.length; i++) {
        const c = raw.charCodeAt(i);
        const alnum = (c >= 97 && c <= 122) || (c >= 48 && c <= 57);
        if (c === 45) {
          if (prevDash) { good = false; break; }
          prevDash = true;
        } else if (alnum) prevDash = false;
        else { good = false; break; }
      }
      if (prevDash) good = false;
      return good ? { value: raw } : { error: 'key "slug": not a slug' };
    }
    default:
      return { error: `unknown key "${key}"` };
  }
}

/** One front-matter line into `data`, or its refusal reason (null when the line is blank, a comment, or fine). */
function fmLine(data, line, ln) {
  let k = 0;
  while (k < line.length && (line[k] === ' ' || line[k] === '\t')) k++;
  if (k === line.length) return null;
  if (line.charCodeAt(0) === 35) return null;
  let e = 0;
  while (e < line.length) {
    const c = line.charCodeAt(e);
    if ((c >= 97 && c <= 122) || c === 95) e++;
    else break;
  }
  if (e === 0 || line[e] !== ':') return `line ${ln} is not "key: value"`;
  const key = line.slice(0, e);
  const rest = line.slice(e + 1);
  let raw;
  if (rest === '') raw = '';
  else if (rest[0] === ' ') raw = rest.slice(1);
  else return `line ${ln} is not "key: value"`;
  raw = raw.replace(/[ \t]+$/, '');
  if (!FM_KEYS.includes(key)) return `unknown key "${key}"`;
  if (Object.hasOwn(data, key)) return `key "${key}" is given twice`;
  if (raw === '') return `key "${key}" has no value`;
  const v = valueOf(key, raw);
  if ('error' in v) return v.error;
  data[key] = v.value;
  return null;
}

/**
 * A source's front matter and body: { data, body }, or { error } with the first reason it is refused.
 * `text` has "\n" line ends. The body is sliced out of the text, never split and re-joined.
 */
function parseFrontMatter(text) {
  const nl0 = text.indexOf('\n');
  const first = nl0 === -1 ? text : text.slice(0, nl0);
  if (first !== '---') return { error: 'no front matter' };
  if (nl0 === -1) return { error: 'the front matter is not closed' };
  let pos = nl0 + 1;
  let closeLine = -1;
  let closeEnd = -1;
  let lineNo = 2;
  while (pos <= text.length) {
    const nl = text.indexOf('\n', pos);
    const end = nl === -1 ? text.length : nl;
    if (end - pos === 3 && text.charCodeAt(pos) === 45 && text.charCodeAt(pos + 1) === 45 && text.charCodeAt(pos + 2) === 45) {
      closeLine = lineNo;
      closeEnd = end;
      break;
    }
    if (nl === -1) break;
    pos = nl + 1;
    lineNo++;
  }
  if (closeLine === -1) return { error: 'the front matter is not closed' };
  const data = {};
  pos = nl0 + 1;
  for (let ln = 2; ln < closeLine; ln++) {
    const nl = text.indexOf('\n', pos);
    const end = nl === -1 ? text.length : nl;
    const err = fmLine(data, text.slice(pos, end), ln);
    if (err !== null) return { error: err };
    pos = end + 1;
  }
  if (!Object.hasOwn(data, 'title')) return { error: 'no title' };
  return { data, body: closeEnd + 1 <= text.length ? text.slice(closeEnd + 1) : '' };
}

// ---------------------------------------------------------------- templates

/** The deepest an include nests: one past it renders nothing. */
const INCLUDE_DEPTH = 8;

const PATH_RE = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;
const FOR_RE = /^for ([A-Za-z_][A-Za-z0-9_]*) in (\S+)$/;
const IF_RE = /^if (not )?(\S+)$/;
const INCLUDE_RE = /^include "([a-z0-9-]+)"$/;

/** A template that does not parse: its name and why. */
class TemplateError extends Error {}

/** The path `text` names, split at its dots, or a TemplateError. */
function pathOf(name, text) {
  if (!PATH_RE.test(text)) throw new TemplateError(`template "${name}": ${JSON.stringify(text)} is not a path`);
  return text.split('.');
}

/**
 * `src`'s tokens: text, {{ }}, {{{ }}} and {% %}, a standalone tag's line taken with it.
 * Node shapes (arrays, built once per case): ['t', text], ['v', path, raw],
 * ['i', not, path, then, else|null], ['f', name, path, body], ['c', name].
 */
function tokenize(name, src) {
  const tokens = [];
  let text = '';
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf('{', i);
    if (open === -1 || open === src.length - 1) {
      text += src.slice(i);
      break;
    }
    const next = src[open + 1];
    if (next !== '{' && next !== '%') {
      text += src.slice(i, open + 1);
      i = open + 1;
      continue;
    }
    text += src.slice(i, open);
    if (next === '{') {
      const raw = src[open + 2] === '{';
      const close = src.indexOf(raw ? '}}}' : '}}', open + (raw ? 3 : 2));
      if (close === -1) throw new TemplateError(`template "${name}": a ${raw ? '{{{' : '{{'} is not closed`);
      if (text !== '') tokens.push({ t: 'text', text });
      text = '';
      tokens.push({ t: raw ? 'raw' : 'var', path: pathOf(name, src.slice(open + (raw ? 3 : 2), close).trim()) });
      i = close + (raw ? 3 : 2);
      continue;
    }
    const close = src.indexOf('%}', open + 2);
    if (close === -1) throw new TemplateError(`template "${name}": a {% is not closed`);
    const end = close + 2;
    const lineStart = src.lastIndexOf('\n', open - 1) + 1;
    const nl = src.indexOf('\n', end);
    const lineEnd = nl === -1 ? src.length : nl;
    const standalone = /^[ \t]*$/.test(src.slice(lineStart, open)) && /^[ \t]*$/.test(src.slice(end, lineEnd));
    if (standalone) text = text.slice(0, text.length - (open - lineStart));
    if (text !== '') tokens.push({ t: 'text', text });
    text = '';
    tokens.push({ t: 'tag', tag: src.slice(open + 2, close).trim() });
    i = standalone ? (nl === -1 ? src.length : nl + 1) : end;
  }
  if (text !== '') tokens.push({ t: 'text', text });
  return tokens;
}

/** `src` compiled into its tree of nodes (a TemplateError when it does not parse). */
function compileTemplate(name, src) {
  const root = [];
  const stack = [{ kind: 'root', arr: null, body: root }];
  let body = root;
  for (const tok of tokenize(name, src)) {
    if (tok.t === 'text') body.push(['t', tok.text]);
    else if (tok.t === 'var' || tok.t === 'raw') body.push(['v', tok.path, tok.t === 'raw']);
    else {
      const tag = tok.tag;
      const top = stack[stack.length - 1];
      let m;
      if ((m = FOR_RE.exec(tag)) !== null) {
        const node = ['f', m[1], pathOf(name, m[2]), []];
        body.push(node);
        stack.push({ kind: 'for', arr: node, body: node[3] });
        body = node[3];
      } else if ((m = IF_RE.exec(tag)) !== null) {
        const node = ['i', m[1] !== undefined, pathOf(name, m[2]), [], null];
        body.push(node);
        stack.push({ kind: 'if', arr: node, body: node[3] });
        body = node[3];
      } else if (tag === 'else') {
        if (top.kind !== 'if' || top.arr[4] !== null) throw new TemplateError(`template "${name}": an else outside an if`);
        top.arr[4] = [];
        top.body = top.arr[4];
        body = top.arr[4];
      } else if (tag === 'endfor' || tag === 'endif') {
        if (top.kind !== (tag === 'endfor' ? 'for' : 'if')) throw new TemplateError(`template "${name}": an ${tag} with no open ${tag.slice(3)}`);
        stack.pop();
        const parent = stack[stack.length - 1];
        body = parent.body;
      } else if ((m = INCLUDE_RE.exec(tag)) !== null) body.push(['c', m[1]]);
      else throw new TemplateError(`template "${name}": {% ${tag} %} is not a tag`);
    }
  }
  if (stack.length > 1) throw new TemplateError(`template "${name}": a ${stack[stack.length - 1].kind} is not closed`);
  return root;
}

/** The value at `path` in the scope chain: its first name from the nearest scope holding it, then own properties. */
function lookup(scopes, path) {
  let v;
  let found = false;
  for (let d = scopes.length - 1; d >= 0; d--) {
    const frame = scopes[d];
    if (Object.hasOwn(frame, path[0])) {
      v = frame[path[0]];
      found = true;
      break;
    }
  }
  if (!found) return undefined;
  for (let k = 1; k < path.length; k++) {
    if (v === null || typeof v !== 'object' || !Object.hasOwn(v, path[k])) return undefined;
    v = v[path[k]];
  }
  return v;
}

/** A value as text: a string itself, a number in JavaScript's digits, true or false, an array's items joined by ", ", else "". */
function textOf(v) {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) return v.map(textOf).join(', ');
  return '';
}

/** Whether a value counts as true in an if: not undefined, null, false, "", 0 or an empty array. */
function truthy(v) {
  if (Array.isArray(v)) return v.length > 0;
  return v !== undefined && v !== null && v !== false && v !== '' && v !== 0;
}

/** `nodes` rendered into `out` (a parts array) in the scope chain `scopes`; `ctx` holds the compiled templates and the render memo. */
function renderNodes(nodes, scopes, ctx, depth, out) {
  const templates = ctx.templates;
  for (let n = 0; n < nodes.length; n++) {
    const node = nodes[n];
    const kind = node[0];
    if (kind === 't') {
      out.push(node[1]);
    } else if (kind === 'v') {
      const v = textOf(lookup(scopes, node[1]));
      out.push(node[2] ? v : escapeHtml(v));
    } else if (kind === 'i') {
      const v = truthy(lookup(scopes, node[2]));
      const branch = v !== node[1] ? node[3] : node[4];
      if (branch !== null) renderNodes(branch, scopes, ctx, depth, out);
    } else if (kind === 'f') {
      const xs = lookup(scopes, node[2]);
      if (!Array.isArray(xs)) continue;
      const name = node[1];
      const body = node[3];
      for (let k = 0; k < xs.length; k++) {
        const frame = { [name]: xs[k], loop: { index: k + 1, first: k === 0, last: k === xs.length - 1, length: xs.length } };
        scopes.push(frame);
        renderNodes(body, scopes, ctx, depth, out);
        scopes.pop();
      }
    } else {
      const name = node[1];
      const t = templates.get(name);
      if (t === undefined || depth >= INCLUDE_DEPTH) continue;
      const mi = ctx.memoInfo.get(name);
      if (mi === undefined || shadowed(scopes)) {
        renderNodes(t, scopes, ctx, depth + 1, out);
        continue;
      }
      const key = mi.keyNames.length === 0 ? 0 : lookup(scopes, [mi.keyNames[0]]);
      const got = memoGet(ctx.memo, name, depth, key);
      if (got !== undefined) {
        out.push(got);
        continue;
      }
      const sub = [];
      renderNodes(t, scopes, ctx, depth + 1, sub);
      const str = sub.join('');
      memoSet(ctx.memo, name, depth, key, str);
      out.push(str);
    }
  }
}

/** Whether an enclosing for binds `site`, `tags` or `recent`: then a memoised render would read the shadow, not the root. */
function shadowed(scopes) {
  for (let d = 1; d < scopes.length; d++) {
    const f = scopes[d];
    if (Object.hasOwn(f, 'site') || Object.hasOwn(f, 'tags') || Object.hasOwn(f, 'recent')) return true;
  }
  return false;
}

function memoGet(memo, name, depth, key) {
  const byDepth = memo.get(name);
  if (byDepth === undefined) return undefined;
  const byKey = byDepth.get(depth);
  if (byKey === undefined) return undefined;
  return byKey.get(key);
}

function memoSet(memo, name, depth, key, str) {
  let byDepth = memo.get(name);
  if (byDepth === undefined) {
    byDepth = new Map();
    memo.set(name, byDepth);
  }
  let byKey = byDepth.get(depth);
  if (byKey === undefined) {
    byKey = new Map();
    byDepth.set(depth, byKey);
  }
  byKey.set(key, str);
}

/**
 * The first names `nodes` reads from the caller's scope, given `bound` (names bound by enclosing fors).
 * A for's own name and `loop` count as bound inside its body. `external` holds the in-progress
 * per-template sets for the include edges.
 */
function analyzeExternal(nodes, bound, external) {
  const out = new Set();
  for (const node of nodes) {
    const kind = node[0];
    if (kind === 'v') {
      if (!bound.has(node[1][0])) out.add(node[1][0]);
    } else if (kind === 'i') {
      if (!bound.has(node[2][0])) out.add(node[2][0]);
      for (const x of analyzeExternal(node[3], bound, external)) out.add(x);
      if (node[4] !== null) for (const x of analyzeExternal(node[4], bound, external)) out.add(x);
    } else if (kind === 'f') {
      if (!bound.has(node[2][0])) out.add(node[2][0]);
      const b2 = new Set(bound);
      b2.add(node[1]);
      b2.add('loop');
      for (const x of analyzeExternal(node[3], b2, external)) out.add(x);
    } else if (kind === 'c') {
      const ext = external.get(node[1]);
      if (ext !== undefined) for (const x of ext) if (!bound.has(x)) out.add(x);
    }
  }
  return out;
}

/** The names a template can ever read from its caller, by fixed point over the include graph. */
function computeExternal(templates) {
  const external = new Map();
  for (const name of templates.keys()) external.set(name, new Set());
  let changed = true;
  while (changed) {
    changed = false;
    for (const [name, nodes] of templates) {
      const next = analyzeExternal(nodes, new Set(), external);
      const cur = external.get(name);
      for (const x of next) {
        if (!cur.has(x)) {
          cur.add(x);
          changed = true;
        }
      }
    }
  }
  return external;
}

/** The names that never change within one case: the root scope's site, tags and recent. */
const CONSTANT_NAMES = ['site', 'tags', 'recent'];

// ---------------------------------------------------------------- markdown

/** Whether `ch` (a one-character string) is JavaScript whitespace (\s). */
const WS_TABLE = new Uint8Array(65536);
for (const cp of [9, 10, 11, 12, 13, 32, 160, 5760, 8232, 8233, 8239, 8287, 12288, 65279]) WS_TABLE[cp] = 1;
for (let cp = 8192; cp <= 8202; cp++) WS_TABLE[cp] = 1;
function isSpaceCh(ch) {
  return WS_TABLE[ch.charCodeAt(0)] === 1;
}

/** Whether `line` holds only spaces and tabs. */
function isBlank(line) {
  for (let i = 0; i < line.length; i++) {
    const c = line.charCodeAt(i);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}

/** A fence's language when `line` opens one, else null. */
function fenceOpen(line) {
  if (line.charCodeAt(0) !== 96 || line.charCodeAt(1) !== 96 || line.charCodeAt(2) !== 96) return null;
  let j = 3;
  while (j < line.length) {
    const c = line.charCodeAt(j);
    if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 95 || c === 43 || c === 45) j++;
    else break;
  }
  const lang = line.slice(3, j);
  while (j < line.length && (line.charCodeAt(j) === 32 || line.charCodeAt(j) === 9)) j++;
  return j === line.length ? lang : null;
}

/** Whether `line` closes a fence: three backticks, then spaces or tabs only. */
function isFenceClose(line) {
  if (line.charCodeAt(0) !== 96 || line.charCodeAt(1) !== 96 || line.charCodeAt(2) !== 96) return false;
  for (let j = 3; j < line.length; j++) {
    const c = line.charCodeAt(j);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}

/** A heading line's level and text, or null (a heading's text is never empty). */
function headingOf(line) {
  let d = 0;
  while (d < 6 && line.charCodeAt(d) === 35) d++;
  if (d === 0) return null;
  const c = line.charCodeAt(d);
  if (c !== 32 && c !== 9) return null;
  let s = d;
  while (s < line.length && (line.charCodeAt(s) === 32 || line.charCodeAt(s) === 9)) s++;
  let e = line.length;
  while (e > s && (line.charCodeAt(e - 1) === 32 || line.charCodeAt(e - 1) === 9)) e--;
  if (e === s) return null;
  return { depth: d, text: line.slice(s, e) };
}

/** Whether `line` is a thematic break: `---` or `***`, then spaces or tabs only. */
function isHr(line) {
  const a = line.charCodeAt(0);
  const b = line.charCodeAt(1);
  const c = line.charCodeAt(2);
  if (!((a === 45 && b === 45 && c === 45) || (a === 42 && b === 42 && c === 42))) return false;
  for (let j = 3; j < line.length; j++) {
    const ch = line.charCodeAt(j);
    if (ch !== 32 && ch !== 9) return false;
  }
  return true;
}

/** A bullet item's text after `- ` or `* `, else null. */
function bulletOf(line) {
  const a = line.charCodeAt(0);
  if ((a === 45 || a === 42) && line.charCodeAt(1) === 32) return line.slice(2);
  return null;
}

/** An ordered item's start number and text after `n. `, else null. */
function orderedOf(line) {
  let j = 0;
  while (j < 9) {
    const c = line.charCodeAt(j);
    if (c >= 48 && c <= 57) j++;
    else break;
  }
  if (j === 0) return null;
  if (line.charCodeAt(j) === 46 && line.charCodeAt(j + 1) === 32) return { start: Number(line.slice(0, j)), text: line.slice(j + 2) };
  return null;
}

/** Whether `line` continues a list item: two or more spaces, then a non-space. */
function isContinued(line) {
  if (line.charCodeAt(0) !== 32 || line.charCodeAt(1) !== 32) return false;
  let j = 2;
  while (line.charCodeAt(j) === 32) j++;
  if (j >= line.length) return false;
  return !isSpaceCh(line[j]);
}

/** A line as it is rendered: spaces and tabs at either end dropped. */
function trimLine(line) {
  let s = 0;
  let e = line.length;
  while (s < e && (line.charCodeAt(s) === 32 || line.charCodeAt(s) === 9)) s++;
  while (e > s && (line.charCodeAt(e - 1) === 32 || line.charCodeAt(e - 1) === 9)) e--;
  return line.slice(s, e);
}

/** Whether `line` ends a paragraph: a blank line, a fence, a heading or a thematic break. */
function endsParagraph(line) {
  if (line.length === 0) return true;
  const c0 = line.charCodeAt(0);
  if (c0 === 32 || c0 === 9) return isBlank(line);
  if (c0 === 35) return headingOf(line) !== null;
  if (c0 === 96) return fenceOpen(line) !== null;
  if (c0 === 45 || c0 === 42) return isHr(line);
  return false;
}

/** The characters a backslash escapes. */
const ESCAPABLE = new Set(['\\', '`', '*', '_', '[', ']', '(', ')', '#', '+', '-', '.', '!', '>']);

/** The first index from `from` where `s` holds `what` outside a backslash escape, or -1. */
function findUnescaped(s, what, from) {
  for (let j = from; j <= s.length - what.length; j++) {
    if (s[j] === '\\' && j + 1 < s.length && ESCAPABLE.has(s[j + 1])) {
      j++;
      continue;
    }
    if (s.startsWith(what, j)) return j;
  }
  return -1;
}

/** The first single * from `from` (one whose run is not **), outside an escape, or -1. */
function findSingleStar(s, from) {
  for (let j = from; j < s.length; j++) {
    const c = s[j];
    if (c === '\\' && j + 1 < s.length && ESCAPABLE.has(s[j + 1])) {
      j++;
      continue;
    }
    if (c !== '*') continue;
    if (s[j + 1] === '*') {
      j++;
      continue;
    }
    return j;
  }
  return -1;
}

/**
 * `s` rendered inline into the parts array `out`; `link(target)` is a link's href.
 * One pass: plain runs are pushed raw (the five HTML characters are escaped at their
 * own positions, so no run ever needs a second scan), and only code spans and link
 * targets go through the escaper.
 */
function inlineInto(s, link, out) {
  const n = s.length;
  let i = 0;
  let start = 0;
  while (i < n) {
    const c = s[i];
    if (c === '&' || c === '<' || c === '>' || c === '"' || c === "'") {
      if (i > start) out.push(s.slice(start, i));
      out.push(ESCAPES[c]);
      i++;
      start = i;
      continue;
    }
    if (c === '\\' && i + 1 < n && ESCAPABLE.has(s[i + 1])) {
      if (i > start) out.push(s.slice(start, i));
      out.push(ESCAPES[s[i + 1]] ?? s[i + 1]);
      i += 2;
      start = i;
      continue;
    }
    if (c === '`') {
      const j = s.indexOf('`', i + 1);
      if (j > i + 1) {
        if (i > start) out.push(s.slice(start, i));
        out.push('<code>', escapeHtml(s.slice(i + 1, j)), '</code>');
        i = j + 1;
        start = i;
      } else i++;
      continue;
    }
    if (c === '*') {
      if (s[i + 1] === '*') {
        const j = findUnescaped(s, '**', i + 2);
        if (j > i + 2) {
          if (i > start) out.push(s.slice(start, i));
          out.push('<strong>');
          inlineInto(s.slice(i + 2, j), link, out);
          out.push('</strong>');
          i = j + 2;
          start = i;
        } else i += 2;
        continue;
      }
      const j = findSingleStar(s, i + 1);
      if (j > i + 1) {
        if (i > start) out.push(s.slice(start, i));
        out.push('<em>');
        inlineInto(s.slice(i + 1, j), link, out);
        out.push('</em>');
        i = j + 1;
        start = i;
      } else i++;
      continue;
    }
    if (c === '[') {
      const k = findUnescaped(s, ']', i + 1);
      const m = k !== -1 && s[k + 1] === '(' ? s.indexOf(')', k + 2) : -1;
      const target = m === -1 ? '' : s.slice(k + 2, m);
      if (target !== '' && !/\s/.test(target)) {
        if (i > start) out.push(s.slice(start, i));
        out.push('<a href="', escapeHtml(link(target)), '">');
        inlineInto(s.slice(i + 1, k), link, out);
        out.push('</a>');
        i = m + 1;
        start = i;
      } else i++;
      continue;
    }
    i++;
  }
  if (n > start) out.push(s.slice(start));
}

/** `s` rendered inline, as one string. */
function inlineStr(s, link) {
  const out = [];
  inlineInto(s, link, out);
  return out.join('');
}

/**
 * `src` rendered in one fused pass: its HTML (each block on its own lines, a "\n" after the last),
 * its table of contents (every level 2 and 3 heading: level, id and its inline HTML) and its
 * excerpt (the first paragraph's inline HTML, or "").
 */
function renderMarkdown(src, link, slugify) {
  const lines = src.split('\n');
  const n = lines.length;
  const out = [];
  const toc = [];
  const ids = new Set();
  let excerpt = null;
  let i = 0;
  while (i < n) {
    const line = lines[i];
    if (line.length === 0) {
      i++;
      continue;
    }
    const c0 = line.charCodeAt(0);
    if (c0 === 32 || c0 === 9) {
      if (isBlank(line)) {
        i++;
        continue;
      }
    } else if (c0 === 62) {
      const body = [];
      while (i < n && lines[i].charCodeAt(0) === 62) {
        const l = lines[i++];
        const stripped = l[1] === ' ' ? l.slice(2) : l.slice(1);
        const t = trimLine(stripped);
        if (t !== '') body.push(t);
      }
      if (body.length === 0) out.push('<blockquote>\n</blockquote>\n');
      else {
        out.push('<blockquote>\n<p>');
        inlineInto(body.join('\n'), link, out);
        out.push('</p>\n</blockquote>\n');
      }
      continue;
    } else if (c0 === 96) {
      const lang = fenceOpen(line);
      if (lang !== null) {
        i++;
        out.push('<pre><code');
        if (lang !== '') {
          out.push(' class="language-');
          out.push(escapeHtml(lang));
          out.push('"');
        }
        out.push('>');
        while (i < n && !isFenceClose(lines[i])) {
          out.push(escapeHtml(lines[i]));
          out.push('\n');
          i++;
        }
        i++;
        out.push('</code></pre>\n');
        continue;
      }
    } else if (c0 === 35) {
      const h = headingOf(line);
      if (h !== null) {
        const id = uniqueSlug(slugify(h.text), ids);
        if (h.depth === 2 || h.depth === 3) {
          const html = inlineStr(h.text, link);
          out.push(`<h${h.depth} id="${id}">`, html, `</h${h.depth}>\n`);
          toc.push({ level: h.depth, id, html });
        } else {
          out.push(`<h${h.depth} id="${id}">`);
          inlineInto(h.text, link, out);
          out.push(`</h${h.depth}>\n`);
        }
        i++;
        continue;
      }
    } else if (c0 === 45 || c0 === 42) {
      const bullet = bulletOf(line);
      if (bullet !== null) {
        const items = [];
        while (i < n) {
          const l = lines[i];
          const b = bulletOf(l);
          if (b !== null) {
            items.push([trimLine(b)]);
            i++;
          } else if (isContinued(l)) {
            items[items.length - 1].push(trimLine(l));
            i++;
          } else break;
        }
        out.push('<ul>\n');
        for (const item of items) {
          out.push('<li>');
          inlineInto(item.join('\n'), link, out);
          out.push('</li>\n');
        }
        out.push('</ul>\n');
        continue;
      }
      if (isHr(line)) {
        out.push('<hr>\n');
        i++;
        continue;
      }
    } else if (c0 >= 48 && c0 <= 57) {
      const ordered = orderedOf(line);
      if (ordered !== null) {
        const items = [];
        while (i < n) {
          const l = lines[i];
          const o = orderedOf(l);
          if (o !== null) {
            items.push([trimLine(o.text)]);
            i++;
          } else if (isContinued(l)) {
            items[items.length - 1].push(trimLine(l));
            i++;
          } else break;
        }
        if (ordered.start !== 1) out.push(`<ol start="${ordered.start}">\n`);
        else out.push('<ol>\n');
        for (const item of items) {
          out.push('<li>');
          inlineInto(item.join('\n'), link, out);
          out.push('</li>\n');
        }
        out.push('</ol>\n');
        continue;
      }
    }
    const body = [trimLine(line)];
    i++;
    while (i < n && !endsParagraph(lines[i])) {
      body.push(trimLine(lines[i]));
      i++;
    }
    if (excerpt === null) {
      const html = inlineStr(body.join('\n'), link);
      excerpt = html;
      out.push('<p>', html, '</p>\n');
    } else {
      out.push('<p>');
      inlineInto(body.join('\n'), link, out);
      out.push('</p>\n');
    }
  }
  return { html: out.join(''), toc, excerpt: excerpt ?? '' };
}

// ---------------------------------------------------------------- the build

/** The top-level directories the generator writes itself, which no page's slug at the root may take. */
const RESERVED = ['posts', 'tags', 'page'];

/** The report file every build writes. */
const REPORT_FILE = 'build-report.txt';

/** The words of a body: its runs of characters other than whitespace. One scan, no allocation. */
function wordsOf(text) {
  let count = 0;
  let inWord = false;
  for (let i = 0; i < text.length; i++) {
    if (WS_TABLE[text.charCodeAt(i)] === 1) inWord = false;
    else if (!inWord) {
      inWord = true;
      count++;
    }
  }
  return count;
}

/** `rel` (a link's path, "/"-separated) from the directory `dir` of a source, or null when it climbs out of the root. */
function resolvePath(dir, rel) {
  const parts = dir === '' ? [] : dir.split('/');
  for (const seg of rel.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (parts.length === 0) return null;
      parts.pop();
    } else parts.push(seg);
  }
  return parts.join('/');
}

const dirOf = (path) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

/** One site's output tree: path -> text. */
export function run(input) {
  const slugCache = new Map();
  const dateCache = new Map();
  const slugify = (text) => {
    let v = slugCache.get(text);
    if (v === undefined) {
      v = /[^\x00-\x7F]/.test(text) ? slugUnicode(text) : slugAscii(text);
      slugCache.set(text, v);
    }
    return v;
  };
  const longDateOf = (date) => {
    let v = dateCache.get(date);
    if (v === undefined) {
      v = longDate(date);
      dateCache.set(date, v);
    }
    return v;
  };

  // Templates, parsed in code-unit order of their name; one that does not parse is reported and left out.
  const templates = new Map();
  const report = [];
  for (const name of Object.keys(input.templates).sort(byCodeUnits)) {
    try {
      templates.set(name, compileTemplate(name, input.templates[name]));
    } catch (err) {
      if (!(err instanceof TemplateError)) throw err;
      report.push(err.message);
    }
  }
  const base = input.site.base_url.replace(/\/+$/, '');

  // 1. Sources, in code-unit order of their paths, line ends made "\n"; a source that is not .md is static.
  const files = [...input.files].sort((x, y) => byCodeUnits(x.path, y.path));
  let sources = [];
  const statics = [];
  for (const f of files) {
    if (f.path.endsWith('.md')) {
      const text = f.content.includes('\r') ? f.content.replace(/\r\n?/g, '\n') : f.content;
      sources.push({ path: f.path, text });
    } else statics.push({ path: f.path, content: f.content });
  }

  // 2. Each source's front matter: a refused source is reported and dropped, and so is a draft.
  const kept = [];
  for (const s of sources) {
    const fm = parseFrontMatter(s.text);
    if ('error' in fm) {
      report.push(`refused ${s.path}: ${fm.error}`);
      continue;
    }
    s.data = fm.data;
    s.body = fm.body;
    s.post = s.path.startsWith('posts/');
    let own;
    for (const d of RESERVED) {
      if (d !== 'posts' && s.path.startsWith(`${d}/`)) {
        own = d;
        break;
      }
    }
    if (own !== undefined) {
      report.push(`refused ${s.path}: ${own}/ is the generator's own`);
      continue;
    }
    if (s.post && !Object.hasOwn(s.data, 'date')) {
      report.push(`refused ${s.path}: a post needs a date`);
      continue;
    }
    const layout = s.data.layout ?? (s.post ? 'post' : 'page');
    if (!templates.has(layout)) {
      report.push(`refused ${s.path}: layout "${layout}" is no template that parses`);
      continue;
    }
    s.layout = layout;
    if (s.data.draft === true) {
      report.push(`draft ${s.path}`);
      continue;
    }
    kept.push(s);
  }
  sources = kept;

  // 3. Each page's output directory and url: its slug made unique in its directory, in source order.
  const taken = new Map();
  const bySource = new Map();
  for (const s of sources) {
    const dir = s.post ? 'posts' : dirOf(s.path);
    let set = taken.get(dir);
    if (set === undefined) {
      set = new Set(dir === '' ? RESERVED : []);
      taken.set(dir, set);
    }
    const slug = uniqueSlug(s.data.slug ?? slugify(s.data.title), set);
    s.slug = slug;
    s.outDir = dir === '' ? slug : `${dir}/${slug}`;
    s.url = `${base}/${s.outDir}/`;
    bySource.set(s.path, s);
  }

  // 4. Each body's Markdown, its links resolved to the pages and static files they name.
  const staticPaths = new Set(statics.map((f) => f.path));
  const broken = new Set();
  for (const s of sources) {
    const dir = dirOf(s.path);
    const link = (target) => {
      if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(target) || target.startsWith('/') || target.startsWith('#')) return target;
      const hash = target.indexOf('#');
      const rel = hash === -1 ? target : target.slice(0, hash);
      const frag = hash === -1 ? '' : target.slice(hash);
      const path = rel === '' ? null : resolvePath(dir, rel);
      if (path !== null && bySource.has(path)) return `${bySource.get(path).url}${frag}`;
      if (path !== null && staticPaths.has(path)) return `${base}/${path}${frag}`;
      broken.add(`broken-link ${s.path} -> ${target}`);
      return target;
    };
    const md = renderMarkdown(s.body, link, slugify);
    s.html = md.html;
    s.toc = md.toc;
    s.excerpt = md.excerpt;
  }

  // 5. The posts, newest first and then by slug; each post's newer and older neighbours.
  const posts = sources.filter((s) => s.post);
  posts.sort((x, y) => byCodeUnits(y.data.date, x.data.date) || byCodeUnits(x.slug, y.slug));
  posts.forEach((p, k) => {
    p.newer = k === 0 ? null : posts[k - 1];
    p.older = k === posts.length - 1 ? null : posts[k + 1];
  });

  // 6. The tags: grouped by their slug, each named as first met in the posts' order, ordered by count and then slug.
  const bySlug = new Map();
  const ownTags = (s) => {
    const seen = new Set();
    const out = [];
    for (const name of s.data.tags ?? []) {
      const slug = slugify(name);
      if (!seen.has(slug)) {
        seen.add(slug);
        out.push(name);
      }
    }
    return out;
  };
  for (const p of posts) {
    p.tagRefs = [];
    for (const name of ownTags(p)) {
      const slug = slugify(name);
      let tag = bySlug.get(slug);
      if (tag === undefined) {
        tag = { name, slug, url: `${base}/tags/${slug}/`, posts: [] };
        bySlug.set(slug, tag);
      }
      tag.posts.push(p);
      p.tagRefs.push(tag);
    }
  }
  for (const s of sources) {
    if (!s.post) {
      s.tagRefs = ownTags(s).map((name) => {
        const slug = slugify(name);
        return bySlug.get(slug) ?? { name, slug, url: '', posts: [] };
      });
    }
  }
  const tags = [...bySlug.values()].sort((x, y) => y.posts.length - x.posts.length || byCodeUnits(x.slug, y.slug));

  // 7. Every page through its layout, the index pages and the tag pages through theirs.
  const linkOf = (s) => (s === null ? null : { title: s.data.title, url: s.url, date: s.data.date ?? '', date_long: s.data.date === undefined ? '' : longDateOf(s.data.date) });
  const output = {};
  for (const s of sources) {
    const card = {
      title: s.data.title,
      url: s.url,
      date: s.data.date ?? '',
      date_long: s.data.date === undefined ? '' : longDateOf(s.data.date),
      summary: s.data.summary ?? '',
      excerpt: s.excerpt,
      reading_minutes: Math.max(1, Math.ceil(wordsOf(s.body) / 200)),
      tags: s.tagRefs.map((t) => ({ name: t.name, slug: t.slug, url: t.url })),
    };
    s.card = card;
    s.page = {
      ...card,
      slug: s.slug,
      content: s.html,
      toc: s.toc.map((h) => ({ level: h.level, id: h.id, html: h.html })),
      newer: linkOf(s.newer ?? null),
      older: linkOf(s.older ?? null),
      is_post: s.post,
    };
  }
  const site = { title: input.site.title, base_url: base };
  const allTags = tags.map((t) => ({ name: t.name, slug: t.slug, url: t.url, count: t.posts.length }));
  const recent = posts.slice(0, input.site.recent).map((p) => p.card);
  // A template whose render depends only on the case-constant roots, or on them plus one
  // caller value, is rendered once per (template, depth, value) and reused: the header,
  // footer and filler partials are the same on every page, and a post's card is the same
  // on its index page and on each of its tag pages. The memo lives only for this case.
  const external = computeExternal(templates);
  const memoInfo = new Map();
  for (const [name, ext] of external) {
    const keyNames = [...ext].filter((x) => !CONSTANT_NAMES.includes(x)).sort(byCodeUnits);
    if (keyNames.length <= 1) memoInfo.set(name, { keyNames });
  }
  const ctx = { templates, memo: new Map(), memoInfo };
  const render = (name, vars) => {
    const nodes = templates.get(name);
    if (nodes === undefined) return null;
    const out = [];
    const scopes = [{ site, tags: allTags, recent, ...vars }];
    renderNodes(nodes, scopes, ctx, 0, out);
    return out.join('');
  };
  for (const s of sources) output[`${s.outDir}/index.html`] = render(s.layout, { page: s.page });
  const per = input.site.per_page;
  const pages = Math.max(1, Math.ceil(posts.length / per));
  const indexUrl = (k) => (k === 1 ? `${base}/` : `${base}/page/${k}/`);
  for (let k = 1; k <= pages; k++) {
    const html = render('index', {
      posts: posts.slice((k - 1) * per, k * per).map((p) => p.card),
      pager: { number: k, total: pages, url: indexUrl(k), newer_url: k === 1 ? '' : indexUrl(k - 1), older_url: k === pages ? '' : indexUrl(k + 1) },
    });
    if (html !== null) output[k === 1 ? 'index.html' : `page/${k}/index.html`] = html;
  }
  for (const t of tags) {
    const html = render('tag', { tag: { name: t.name, slug: t.slug, url: t.url, count: t.posts.length, posts: t.posts.map((p) => p.card) } });
    if (html !== null) output[`tags/${t.slug}/index.html`] = html;
  }
  const tagsHtml = render('tags', {});
  if (tagsHtml !== null) output['tags/index.html'] = tagsHtml;
  for (const f of statics) {
    if (Object.hasOwn(output, f.path)) report.push(`shadowed ${f.path}: a built page has its path`);
    else output[f.path] = f.content;
  }

  // 8. The report: every refusal, draft, broken link and template that did not parse, sorted, then the counts.
  const lines = [...report, ...broken].sort(byCodeUnits);
  const pageCount = sources.filter((s) => !s.post).length;
  lines.push(`built ${pageCount} pages, ${posts.length} posts, ${tags.length} tags and ${statics.length} static files`);
  output[REPORT_FILE] = `${lines.join('\n')}\n`;
  return output;
}
