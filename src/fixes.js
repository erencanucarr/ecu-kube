export function applyFixes(text, fixes) {
  const list = fixes.filter(Boolean).slice().sort((a, b) => b.from - a.from || b.to - a.to);
  let applied = 0;
  let limit = Infinity;
  for (const f of list) {
    if (f.to > limit) continue;
    if (text.slice(f.from, f.to) !== f.expect) continue;
    text = text.slice(0, f.from) + f.insert + text.slice(f.to);
    limit = f.from;
    applied++;
  }
  return { text, applied };
}

export function fixable(issues) {
  const out = [];
  const whole = issues.find((i) => i.fix && i.fix.kind === "tabs");
  if (whole) return [whole];
  for (const i of issues) if (i.fix) out.push(i);
  return out;
}
