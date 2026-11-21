import esbuild from "esbuild";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const out = join(mkdtempSync(join(tmpdir(), "ecu-kube-fix-")), "v.mjs");
await esbuild.build({ stdin: { contents: 'export * from "./src/validate.js"; export * from "./src/fixes.js";', resolveDir: process.cwd() }, bundle: true, format: "esm", platform: "browser", outfile: out, logLevel: "error" });
const { validate, applyFixes } = await import(pathToFileURL(out));
const cases = (await import(pathToFileURL(join(process.cwd(), "test/cases.js")))).default;

let fail = 0;
for (const [name, yaml] of cases) {
  const before = validate(yaml);
  const fixable = before.issues.filter((i) => i.fix);
  if (!fixable.length) continue;
  const fixed = applyFixes(yaml, fixable.map((i) => i.fix));
  const after = validate(fixed.text);
  const left = after.issues.filter((a) => fixable.some((f) => f.code === a.code && f.vars.path === a.vars.path && f.line === a.line));
  const yamlErr = after.issues.filter((a) => a.code.startsWith("yaml."));
  const ok = !left.length && !yamlErr.length && fixed.applied === fixable.length;
  if (!ok) fail++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${fixable.map((i) => i.code).join(", ")} -> left ${JSON.stringify(left.map((i) => i.code))} yaml ${yamlErr.length} applied ${fixed.applied}/${fixable.length}`);
  if (process.env.SHOW) console.log(fixed.text + "\n");
}
console.log(fail ? `${fail} failed` : "all fixes ok");
process.exit(fail ? 1 : 0);
