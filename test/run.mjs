import esbuild from "esbuild";
import { readFileSync, readdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const out = join(mkdtempSync(join(tmpdir(), "ecu-kube-test-")), "v.mjs");
await esbuild.build({ stdin: { contents: 'export * from "./src/validate.js"; export * from "./src/messages.js"; export * from "./src/blocks.js";', resolveDir: process.cwd() }, bundle: true, format: "esm", platform: "browser", outfile: out, logLevel: "error" });
const { validate, validateMany, formatIssue, extractBlocks } = await import(pathToFileURL(out));

const lang = process.env.LANG_UI || "en";
const files = process.argv.slice(2);
if (files.length) {
  for (const f of files) {
    const raw = readFileSync(f, "utf8");
    const parts = f.endsWith(".md") ? extractBlocks(raw) : [{ text: raw, firstLine: 0 }];
    const many = validateMany(parts.map((p) => p.text));
    for (const [pi, part] of parts.entries()) {
      const r = many[pi];
      console.log(`\n== ${f}${f.endsWith(".md") ? " @" + (part.firstLine + 1) : ""}${r.skipped ? " (skipped: " + r.skipped + ")" : ""}`);
      const off = part.firstLine;
      for (const d of r.docs) if (d.kind) console.log(`  [${d.line + off}-${d.endLine + off}] ${d.apiVersion} ${d.kind} ${d.name || ""} ${JSON.stringify(d.facts)} ${d.links.map((l) => l.rel + ":" + l.kind + "/" + l.name).join(" ")}`);
      for (const i of r.issues) console.log(`  ${i.level.padEnd(7)} L${i.line + off}:${i.col} ${i.code}  ${formatIssue(i, lang)}`);
    }
  }
  process.exit(0);
}

const cases = (await import(pathToFileURL(join(process.cwd(), "test/cases.js")))).default.map(([name, yaml, expect]) => ({ name, yaml, expect }));
let fail = 0;
for (const c of cases) {
  const r = validate(c.yaml);
  const got = r.issues.map((i) => `${i.code}@${i.line}`);
  const want = c.expect;
  const ok = want.length === got.length && want.every((w) => got.includes(w));
  if (!ok) {
    fail++;
    console.log(`FAIL ${c.name}\n  want ${JSON.stringify(want)}\n  got  ${JSON.stringify(got)}`);
    for (const i of r.issues) console.log("     ", formatIssue(i, "en"));
  } else console.log(`ok   ${c.name}`);
}
const many = [
  ["before/after blocks are not duplicates", ["apiVersion: v1\nkind: ConfigMap\nmetadata: {name: c}\ndata: {a: '1'}", "apiVersion: v1\nkind: ConfigMap\nmetadata: {name: c}\ndata: {a: '2'}"], [[], []]],
  ["service in another block: no noMatch warning", ["apiVersion: v1\nkind: Service\nmetadata: {name: s}\nspec:\n  selector: {app: a}\n  ports: [{port: 80}]", "apiVersion: apps/v1\nkind: Deployment\nmetadata: {name: d}\nspec:\n  selector: {matchLabels: {app: b}}\n  template:\n    metadata: {labels: {app: b}}\n    spec: {containers: [{name: c, image: 'n:1', resources: {}}]}"], [[], []]],
  ["service in the same block still warns", ["apiVersion: v1\nkind: Service\nmetadata: {name: s}\nspec:\n  selector: {app: a}\n  ports: [{port: 80}]\n---\napiVersion: apps/v1\nkind: Deployment\nmetadata: {name: d}\nspec:\n  selector: {matchLabels: {app: b}}\n  template:\n    metadata: {labels: {app: b}}\n    spec: {containers: [{name: c, image: 'n:1', resources: {}}]}"], [["service.noMatch@5"]]],
  ["links still cross blocks", ["apiVersion: v1\nkind: Service\nmetadata: {name: s}\nspec:\n  selector: {app: a}\n  ports: [{port: 80}]", "apiVersion: apps/v1\nkind: Deployment\nmetadata: {name: d}\nspec:\n  selector: {matchLabels: {app: a}}\n  template:\n    metadata: {labels: {app: a}}\n    spec: {containers: [{name: c, image: 'n:1', resources: {}}]}"], [[], []], (r) => r[0].docs[0].links.length === 1],
];
for (const [name, texts, want, extra] of many) {
  const r = validateMany(texts);
  const got = r.map((x) => x.issues.map((i) => `${i.code}@${i.line}`));
  const ok = JSON.stringify(got) === JSON.stringify(want) && (!extra || extra(r));
  if (!ok) {
    fail++;
    console.log(`FAIL ${name}\n  want ${JSON.stringify(want)}\n  got  ${JSON.stringify(got)}`);
  } else console.log(`ok   ${name}`);
}
console.log(fail ? `${fail} failed` : "all passed");
process.exit(fail ? 1 : 0);
