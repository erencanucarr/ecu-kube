import esbuild from "esbuild";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const out = join(mkdtempSync(join(tmpdir(), "ecu-kube-blocks-")), "v.mjs");
await esbuild.build({ stdin: { contents: 'export * from "./src/validate.js"; export * from "./src/fixes.js"; export * from "./src/blocks.js";', resolveDir: process.cwd() }, bundle: true, format: "esm", platform: "browser", outfile: out, logLevel: "error" });
const { validate, applyFixes, fixable, extractBlocks, toDoc, toDocLine, docFix } = await import(pathToFileURL(out));

let fail = 0;
const check = (name, ok, info) => {
  if (!ok) fail++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${!ok && info !== undefined ? " " + JSON.stringify(info) : ""}`);
};

function fixDoc(doc, block, codes) {
  const issues = validate(block.text).issues.filter((i) => i.fix && (!codes || codes.includes(i.code)));
  const mapped = issues.map((i) => docFix(block, i.fix, doc));
  return { issues, mapped, ...applyFixes(doc, mapped) };
}

function lineAt(doc, pos) {
  const start = doc.lastIndexOf("\n", pos - 1) + 1;
  return { n: doc.slice(0, start).split("\n").length - 1, ch: pos - start };
}

const callout = ["# Note", "", "> [!note] Manifest", "> ```yaml", "> apiVersion: v1", "> kind: ConfigMap", "> metadata:", ">   name: c", ">   lables: {a: b}", "> ```", "after"].join("\n");
{
  const [b] = extractBlocks(callout);
  check("callout: extracted", !!b && b.openLine === 3 && b.closeLine === 9 && b.firstLine === 4);
  check("callout: text stripped", b.text === "apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: c\n  lables: {a: b}", b.text);
  check("callout: from", b.from === callout.indexOf("apiVersion"), b.from);
  const local = b.text.indexOf("lables");
  check("callout: toDoc", toDoc(b, local) === callout.indexOf("lables"), toDoc(b, local));
  check("callout: toDoc end", toDoc(b, b.text.length) === callout.lastIndexOf("\n> ```"), toDoc(b, b.text.length));
  const typo = validate(b.text).issues.find((i) => i.code === "field.typo");
  const p = toDocLine(b, typo.line, typo.col);
  const at = lineAt(callout, callout.indexOf("lables"));
  check("callout: jump line/ch", p.line === at.n && p.ch === at.ch, { p, at });
  const r = fixDoc(callout, b, ["field.typo"]);
  check("callout: field.typo applied", r.applied === 1 && r.text === callout.replace(">   lables:", ">   labels:"), r.text);
  const after = extractBlocks(r.text)[0];
  check("callout: re-extract clean", !validate(after.text).issues.some((i) => i.code === "field.typo"));
}

const nested = ["> outer", "> > ```yaml", "> > kind: Pod", "> > metadata: {name: p}", "> > spec:", "> >   containers: [{name: c, image: a:1}]", "> > ```", "> tail"].join("\n");
{
  const blocks = extractBlocks(nested);
  const b = blocks[0];
  check("nested: one block", blocks.length === 1 && b.depth === 2 && b.prefix === "> > ", blocks);
  check("nested: text stripped", b.text === "kind: Pod\nmetadata: {name: p}\nspec:\n  containers: [{name: c, image: a:1}]", b.text);
  check("nested: from", b.from === nested.indexOf("kind"), b.from);
  const r = fixDoc(nested, b, ["obj.noApiVersion"]);
  const want = ["> outer", "> > ```yaml", "> > apiVersion: v1", "> > kind: Pod", "> > metadata: {name: p}", "> > spec:", "> >   containers: [{name: c, image: a:1}]", "> > ```", "> tail"].join("\n");
  check("nested: multi-line insert keeps prefix", r.applied === 1 && r.text === want, r.text);
  const again = extractBlocks(r.text)[0];
  check("nested: re-extract", again && again.text.startsWith("apiVersion: v1\nkind: Pod") && !validate(again.text).issues.some((i) => i.code === "obj.noApiVersion"));
}

{
  const doc = ["> ```yaml", "> kind: Pod", "> metadata: {name: p}", "> ```"].join("\n");
  const b = extractBlocks(doc)[0];
  const r = fixDoc(doc, b, ["obj.noApiVersion"]);
  check("callout: noApiVersion insert", r.text === ["> ```yaml", "> apiVersion: v1", "> kind: Pod", "> metadata: {name: p}", "> ```"].join("\n"), r.text);
}

const list = ["- step", "    - sub", "        ```yaml", "        apiVersion: v1", "        kind: ConfigMap", "        metadata:", "          name: c", "          lables: {a: b}", "        ```", "- next"].join("\n");
{
  const [b] = extractBlocks(list);
  check("list: extracted", !!b && b.indent === 8 && b.openLine === 2 && b.closeLine === 8, b);
  check("list: text stripped", b.text === "apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: c\n  lables: {a: b}", b.text);
  check("list: toDoc", toDoc(b, b.text.indexOf("lables")) === list.indexOf("lables"));
  const r = fixDoc(list, b, ["field.typo"]);
  check("list: field.typo applied", r.applied === 1 && r.text === list.replace("lables", "labels"), r.text);
  const doc = ["- step", "    ```yaml", "    kind: Pod", "    metadata: {name: p}", "    ```"].join("\n");
  const r2 = fixDoc(doc, extractBlocks(doc)[0], ["obj.noApiVersion"]);
  check("list: insert indented", r2.text === ["- step", "    ```yaml", "    apiVersion: v1", "    kind: Pod", "    metadata: {name: p}", "    ```"].join("\n"), r2.text);
}

{
  const doc = ["- a", "\t- b", "\t\t```yaml", "\t\tapiVersion: v1", "\t\tkind: ConfigMap", "\t\tmetadata:", "\t\t  name: c", "\t\t```"].join("\n");
  const [b] = extractBlocks(doc);
  check("tab list: text stripped", b && b.text === "apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: c", b && b.text);
}

{
  const doc = ["> ```yaml", "> apiVersion: v1", "> kind: ConfigMap", "> metadata:", "> \tname: c", ">", "> data: {a: b}", "> ```"].join("\n");
  const b = extractBlocks(doc)[0];
  check("callout: empty quoted line", b.text === "apiVersion: v1\nkind: ConfigMap\nmetadata:\n\tname: c\n\ndata: {a: b}", b.text);
  const issues = fixable(validate(b.text).issues);
  const tabs = issues.find((i) => i.fix.kind === "tabs");
  if (tabs) {
    const r = applyFixes(doc, [docFix(b, tabs.fix, doc)]);
    const again = extractBlocks(r.text)[0];
    check("callout: tabs fix re-prefixes", r.applied === 1 && r.text.split("\n").every((l) => l.startsWith(">")) && again && !again.text.includes("\t"), r.text);
  } else check("callout: tabs fix offered", false, issues.map((i) => i.code));
}

{
  const doc = ["> ```yaml", "> kind: Pod", "not quoted", "```yaml", "apiVersion: v1", "kind: ConfigMap", "metadata: {name: c}", "```"].join("\n");
  const blocks = extractBlocks(doc);
  check("callout: block ends when quote is missing", blocks.length === 1 && blocks[0].openLine === 3, blocks);
}

{
  const b = extractBlocks(callout)[0];
  const fix = validate(b.text).issues.find((i) => i.code === "field.typo").fix;
  const stale = callout.replace("lables", "lab3ls");
  check("callout: stale expect rejected", docFix(b, fix, stale) === null);
}

const plain = ["---", "title: x", "---", "text", "```yaml", "kind: Pod", "metadata: {name: p}", "spec:", "  containers: [{name: c, image: a:1}]", "```", "", "  ```yml", "  apiVersion: v1", "  kind: ConfigMap", "  metadata: {name: c}", "  ```"].join("\n");
{
  const blocks = extractBlocks(plain);
  const b = blocks[0];
  check("plain: same shape", Object.keys(b).join() === "lang,openLine,closeLine,firstLine,from,text", Object.keys(b));
  check("plain: from/text", b.from === plain.indexOf("kind: Pod") && b.text === "kind: Pod\nmetadata: {name: p}\nspec:\n  containers: [{name: c, image: a:1}]");
  check("plain: toDoc linear", toDoc(b, 17) === b.from + 17);
  check("plain: toDocLine", JSON.stringify(toDocLine(b, 3, 2)) === JSON.stringify({ line: b.firstLine + 2, ch: 1 }));
  const fixes = validate(b.text).issues.filter((i) => i.fix).map((i) => i.fix);
  const viaMap = applyFixes(plain, fixes.map((f) => docFix(b, f, plain)));
  const slice = applyFixes(b.text, fixes);
  check("plain: same as slice fix", viaMap.applied === slice.applied && viaMap.text === plain.slice(0, b.from) + slice.text + plain.slice(b.from + b.text.length), viaMap.text);
  check("plain: indented fence stripped", blocks[1] && blocks[1].text === "apiVersion: v1\nkind: ConfigMap\nmetadata: {name: c}" && toDoc(blocks[1], 0) === plain.indexOf("apiVersion"), blocks[1]);
}

console.log(fail ? `${fail} failed` : "all block tests ok");
process.exit(fail ? 1 : 0);
