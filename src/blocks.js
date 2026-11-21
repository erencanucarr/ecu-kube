const OPEN = /^((?:[ \t]*>[ ]?)*)([ \t]*)(`{3,}|~{3,})[ \t]*([^\s`{]*)[^\n`]*$/;
const QUOTE = /^[ \t]*>[ ]?/;
const YAML_LANGS = new Set(["yaml", "yml", "k8s", "kubernetes"]);

export function isYamlLang(lang) {
  return YAML_LANGS.has(String(lang || "").toLowerCase());
}

function unprefix(line, depth, indent) {
  let p = 0;
  for (let d = 0; d < depth; d++) {
    const m = QUOTE.exec(line.slice(p));
    if (!m) return -1;
    p += m[0].length;
  }
  for (let k = 0; k < indent && (line[p] === " " || line[p] === "\t"); k++) p++;
  return p;
}

export function extractBlocks(text) {
  const lines = text.split("\n");
  const out = [];
  let offset = 0;
  let open = null;
  let i = 0;
  if (lines[0] === "---") {
    for (let j = 1; j < lines.length; j++)
      if (/^(---|\.\.\.)\s*$/.test(lines[j])) {
        for (let k = 0; k <= j; k++) offset += lines[k].length + 1;
        i = j + 1;
        break;
      }
  }
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (open) {
      const p = unprefix(line, open.depth, open.indent);
      if (p < 0) open = null;
      else {
        const t = line.slice(p).trim();
        if (t.startsWith(open.fence[0]) && /^(`{3,}|~{3,})$/.test(t) && t.length >= open.fence.length && t[0] === open.fence[0]) {
          if (isYamlLang(open.lang)) {
            const b = { lang: open.lang, openLine: open.line, closeLine: i, firstLine: open.line + 1, from: open.contentFrom, text: open.body.join("\n") };
            if (open.prefix) {
              if (open.starts.length) b.from = open.starts[0];
              Object.assign(b, { prefix: open.prefix, depth: open.depth, indent: open.indent, starts: open.starts, pads: open.pads });
            }
            out.push(b);
          }
          open = null;
        } else {
          open.body.push(line.slice(p));
          open.starts.push(offset + p);
          open.pads.push(p);
        }
        offset += line.length + 1;
        continue;
      }
    }
    const m = OPEN.exec(line);
    if (m && !(m[3][0] === "`" && m[4].includes("`")))
      open = { fence: m[3], lang: m[4].toLowerCase(), line: i, contentFrom: offset + line.length + 1, body: [], starts: [], pads: [], prefix: m[1] + m[2], depth: (m[1].match(/>/g) || []).length, indent: m[2].length };
    offset += line.length + 1;
  }
  return out;
}

export function toDoc(block, off) {
  if (!block.starts || !block.starts.length) return block.from + off;
  const before = block.text.slice(0, off);
  const k = Math.min(before.split("\n").length - 1, block.starts.length - 1);
  return block.starts[k] + off - (before.lastIndexOf("\n") + 1);
}

export function toDocLine(block, line, col) {
  return { line: block.firstLine + line - 1, ch: col - 1 + ((block.pads && block.pads[line - 1]) || 0) };
}

function stripLines(block, raw) {
  const parts = raw.split("\n");
  for (let j = 1; j < parts.length; j++) {
    const p = unprefix(parts[j], block.depth, block.indent);
    if (p < 0) return null;
    parts[j] = parts[j].slice(p);
  }
  return parts.join("\n");
}

function reprefix(block, insert) {
  const parts = insert.split("\n");
  return parts.map((s, j) => (j === 0 ? s : (s === "" && j < parts.length - 1 ? block.prefix.trimEnd() : block.prefix) + s)).join("\n");
}

export function docFix(block, fix, doc) {
  const from = toDoc(block, fix.from);
  const to = toDoc(block, fix.to);
  if (to > doc.length) return null;
  const raw = doc.slice(from, to);
  if (!block.starts) return raw === fix.expect ? { from, to, insert: fix.insert, expect: raw } : null;
  if (stripLines(block, raw) !== fix.expect) return null;
  return { from, to, insert: reprefix(block, fix.insert), expect: raw };
}
