const OPEN = /^( {0,3})(`{3,}|~{3,})[ \t]*([^\s`{]*)[^\n`]*$/;
const YAML_LANGS = new Set(["yaml", "yml", "k8s", "kubernetes"]);

export function isYamlLang(lang) {
  return YAML_LANGS.has(String(lang || "").toLowerCase());
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
    if (!open) {
      const m = OPEN.exec(line);
      if (m && !(m[2][0] === "`" && m[3].includes("`"))) open = { fence: m[2], lang: m[3].toLowerCase(), line: i, contentFrom: offset + line.length + 1, body: [] };
    } else {
      const t = line.trim();
      if (t.startsWith(open.fence[0]) && /^(`{3,}|~{3,})$/.test(t) && t.length >= open.fence.length && t[0] === open.fence[0]) {
        if (isYamlLang(open.lang)) out.push({ lang: open.lang, openLine: open.line, closeLine: i, firstLine: open.line + 1, from: open.contentFrom, text: open.body.join("\n") });
        open = null;
      } else open.body.push(line);
    }
    offset += line.length + 1;
  }
  return out;
}
