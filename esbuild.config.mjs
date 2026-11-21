import esbuild from "esbuild";
import { copyFileSync } from "node:fs";

await esbuild.build({
  entryPoints: ["src/main.js"],
  outfile: "main.js",
  bundle: true,
  format: "cjs",
  platform: "browser",
  target: "es2020",
  external: ["obsidian", "electron", "@codemirror/*", "@lezer/*"],
  logLevel: "info",
  legalComments: "eof",
  minifyWhitespace: false,
});
copyFileSync("src/styles.css", "styles.css");
