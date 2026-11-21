import { Plugin, ItemView, PluginSettingTab, Setting, MarkdownView, TFile, Notice, setIcon, debounce } from "obsidian";
import * as obsidian from "obsidian";
import { StateField, StateEffect, Compartment } from "@codemirror/state";
import { EditorView, Decoration, WidgetType, ViewPlugin } from "@codemirror/view";
import { validateMany, SCHEMA_INFO } from "./validate.js";
import { formatIssue } from "./messages.js";
import { extractBlocks, isYamlLang, toDoc, toDocLine, docFix } from "./blocks.js";
import { applyFixes, fixable } from "./fixes.js";

const STRINGS = {
  en: {
    "panel.title": "Kubernetes check",
    "panel.refresh": "Check again",
    "panel.scan": "Check the whole vault",
    "panel.back": "Back to current note",
    "panel.noFile": "Open a note or a YAML file.",
    "panel.noYaml": "No YAML in this file.",
    "panel.clean": "No problems found.",
    "panel.block": "Block at line {line}",
    "panel.file": "Whole file",
    "panel.scanning": "Checking {n} files…",
    "panel.scanDone": "{files} files with YAML, {bad} with problems",
    "panel.scanClean": "Every YAML in the vault looks fine.",
    "panel.schema": "Kubernetes {k8s} schema, Gateway API {gateway}, MetalLB {metallb}, cert-manager {certManager}, Prometheus Operator {prometheusOperator}, Argo CD {argocd}. Works offline.",
    "sum.ok": "No problems",
    "sum.errors": "{n} errors",
    "sum.error": "1 error",
    "sum.warnings": "{n} warnings",
    "sum.warning": "1 warning",
    "sum.hints": "{n} hints",
    "sum.hint": "1 hint",
    "sum.template": "Template (Helm/Jinja), not checked",
    "sum.line": "line {n}",
    "sum.show": "Show",
    "sum.hide": "Hide",
    "fact.replicas": "{n} replicas",
    "fact.replica": "1 replica",
    "fact.keys": "{n} keys",
    "fact.range": "{min}–{max} replicas",
    "fact.custom": "custom resource, basic checks only",
    "fact.beta": "not checked",
    "level.error": "Error",
    "level.warning": "Warning",
    "level.hint": "Hint",
    "status.tooltip": "Kubernetes check: click for details",
    "cmd.panel": "Open Kubernetes check panel",
    "cmd.scan": "Check all YAML in the vault",
    "cmd.hints": "Toggle best-practice hints",
    "cmd.fixHere": "Fix the problem at the cursor",
    "cmd.fixAll": "Fix everything fixable in this file",
    "fix.apply": "Fix: {label}",
    "fix.insert": "Add {label}",
    "fix.removeLine": "Remove the line",
    "fix.tabs": "Tabs to spaces",
    "fix.base64": "Encode as base64",
    "fix.all": "Fix all ({n})",
    "fix.stale": "The text changed since the check; try again.",
    "fix.none": "Nothing to fix here.",
    "fix.done": "Applied {n} fixes.",
    "set.lang": "Language",
    "set.langDesc": "Language of the interface and messages.",
    "set.langAuto": "Same as the app",
    "set.underline": "Underline problems in the editor",
    "set.underlineDesc": "Wavy underline on the exact key or value; hover it to read the message.",
    "set.summary": "Summary under YAML blocks",
    "set.summaryDesc": "Shows what the block defines (kind, name, replicas, image, links) and its problems, in editing and reading view.",
    "set.hints": "Best-practice hints",
    "set.hintsDesc": "Also mention untagged or :latest images, containers without resources, unused volumes and similar.",
    "set.status": "Status bar",
    "set.statusDesc": "Show the result for the current file in the status bar.",
    "set.ribbon": "Ribbon icon",
    "set.ribbonDesc": "Show an icon in the ribbon that opens the Kubernetes check panel. Useful on mobile, where there is no status bar.",
    "set.files": "Check .yaml / .yml files",
    "set.filesDesc": "Underline problems in YAML files opened with ecu-codekit, and include them in the panel.",
    "set.about": "About the checks",
    "set.aboutDesc": "Uses the Kubernetes {k8s} API schema plus Gateway API, MetalLB, cert-manager, Prometheus Operator and Argo CD, bundled in the plugin. Nothing is sent anywhere. Blocks with Helm or Jinja templates and values like <name> are skipped.",
  },
  tr: {
    "panel.title": "Kubernetes kontrolü",
    "panel.refresh": "Yeniden kontrol et",
    "panel.scan": "Tüm kasayı kontrol et",
    "panel.back": "Geçerli nota dön",
    "panel.noFile": "Bir not ya da YAML dosyası aç.",
    "panel.noYaml": "Bu dosyada YAML yok.",
    "panel.clean": "Sorun bulunmadı.",
    "panel.block": "{line}. satırdaki blok",
    "panel.file": "Dosyanın tamamı",
    "panel.scanning": "{n} dosya kontrol ediliyor…",
    "panel.scanDone": "YAML içeren {files} dosya, {bad} tanesinde sorun var",
    "panel.scanClean": "Kasadaki tüm YAML'lar sorunsuz görünüyor.",
    "panel.schema": "Kubernetes {k8s} şeması, Gateway API {gateway}, MetalLB {metallb}, cert-manager {certManager}, Prometheus Operator {prometheusOperator}, Argo CD {argocd}. İnternetsiz çalışır.",
    "sum.ok": "Sorun yok",
    "sum.errors": "{n} hata",
    "sum.error": "1 hata",
    "sum.warnings": "{n} uyarı",
    "sum.warning": "1 uyarı",
    "sum.hints": "{n} öneri",
    "sum.hint": "1 öneri",
    "sum.template": "Şablon (Helm/Jinja), kontrol edilmedi",
    "sum.line": "{n}. satır",
    "sum.show": "Göster",
    "sum.hide": "Gizle",
    "fact.replicas": "{n} replika",
    "fact.replica": "1 replika",
    "fact.keys": "{n} anahtar",
    "fact.range": "{min}–{max} replika",
    "fact.custom": "özel kaynak, temel kontroller",
    "fact.beta": "kontrol edilmedi",
    "level.error": "Hata",
    "level.warning": "Uyarı",
    "level.hint": "Öneri",
    "status.tooltip": "Kubernetes kontrolü: ayrıntı için tıkla",
    "cmd.panel": "Kubernetes kontrol panelini aç",
    "cmd.scan": "Kasadaki tüm YAML'ları kontrol et",
    "cmd.hints": "En iyi uygulama önerilerini aç/kapat",
    "cmd.fixHere": "İmleçteki sorunu düzelt",
    "cmd.fixAll": "Bu dosyadaki düzeltilebilir her şeyi düzelt",
    "fix.apply": "Düzelt: {label}",
    "fix.insert": "Ekle: {label}",
    "fix.removeLine": "Satırı sil",
    "fix.tabs": "Tab'ları boşluğa çevir",
    "fix.base64": "base64'e çevir",
    "fix.all": "Tümünü düzelt ({n})",
    "fix.stale": "Kontrolden sonra metin değişmiş; tekrar dene.",
    "fix.none": "Burada düzeltilecek bir şey yok.",
    "fix.done": "{n} düzeltme uygulandı.",
    "set.lang": "Dil",
    "set.langDesc": "Arayüzün ve mesajların dili.",
    "set.langAuto": "Uygulamayla aynı",
    "set.underline": "Sorunların altını editörde çiz",
    "set.underlineDesc": "Sorunlu anahtarın ya da değerin altı dalgalı çizilir; mesajı okumak için üzerine gel.",
    "set.summary": "YAML bloklarının altında özet",
    "set.summaryDesc": "Bloğun ne tanımladığını (tür, ad, replika, image, bağlantılar) ve sorunlarını düzenleme ve okuma görünümünde gösterir.",
    "set.hints": "En iyi uygulama önerileri",
    "set.hintsDesc": "Etiketsiz ya da :latest image, resources tanımlanmamış konteyner, kullanılmayan volume gibi durumları da belirt.",
    "set.status": "Durum çubuğu",
    "set.statusDesc": "Geçerli dosyanın sonucunu durum çubuğunda göster.",
    "set.ribbon": "Şerit simgesi",
    "set.ribbonDesc": "Kubernetes kontrol panelini açan bir simgeyi şeritte göster. Durum çubuğu olmayan mobilde işe yarar.",
    "set.files": ".yaml / .yml dosyalarını kontrol et",
    "set.filesDesc": "ecu-codekit ile açılan YAML dosyalarında sorunların altını çiz ve onları panele dahil et.",
    "set.about": "Kontroller hakkında",
    "set.aboutDesc": "Eklentiye gömülü Kubernetes {k8s} API şemasını, Gateway API, MetalLB, cert-manager, Prometheus Operator ve Argo CD'yi kullanır. Hiçbir şey dışarı gönderilmez. Helm ya da Jinja şablonu içeren bloklar ve <ad> gibi yer tutucular atlanır.",
  },
};

let uiLang = "en";
function t(key, vars) {
  const s = (STRINGS[uiLang] && STRINGS[uiLang][key]) || STRINGS.en[key] || key;
  return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m)) : s;
}
function resolveUiLang(pref) {
  if (pref === "en" || pref === "tr") return pref;
  let code = "";
  try {
    code = typeof obsidian.getLanguage === "function" ? obsidian.getLanguage() : obsidian.moment.locale();
  } catch (e) {
    code = "";
  }
  return /^tr/i.test(code) ? "tr" : "en";
}
function setUiLang(pref) {
  uiLang = resolveUiLang(pref);
  return uiLang;
}

const VIEW_PANEL = "ecu-kube-panel";
const CODEKIT_VIEW = "ecu-codekit-file";
const YAML_EXTS = new Set(["yaml", "yml"]);
const DEFAULTS = { uiLang: "auto", underline: true, summary: true, hints: true, statusBar: true, ribbon: true, yamlFiles: true };
const LEVEL_ICON = { error: "circle-x", warning: "triangle-alert", hint: "lightbulb" };
const ICON_FALLBACKS = {
  "circle-x": ["x-circle"],
  "triangle-alert": ["alert-triangle"],
  "circle-check": ["check-circle"],
  "ship-wheel": ["anchor"],
  "folder-search": ["search"],
  wand: ["wand-2", "wand-sparkles", "sparkles"],
  lightbulb: ["lamp"],
  braces: ["curly-braces", "code"],
  "refresh-cw": ["rotate-cw"],
  "arrow-left": ["chevron-left"],
};
const iconCache = new Map();
function iconName(name) {
  if (iconCache.has(name)) return iconCache.get(name);
  let pick = name;
  if (typeof obsidian.getIcon === "function") {
    const found = [name].concat(ICON_FALLBACKS[name] || []).find((n) => {
      try {
        return !!obsidian.getIcon(n);
      } catch (e) {
        return false;
      }
    });
    if (found) pick = found;
  }
  iconCache.set(name, pick);
  return pick;
}
function icon(el, name) {
  setIcon(el, iconName(name));
}
const REVERSE = new Set(["exposedBy", "routedBy", "scaledBy"]);

const refreshEffect = StateEffect.define();

function fixLabel(fix) {
  if (fix.kind === "delete") return t("fix.removeLine");
  if (fix.kind === "tabs") return t("fix.tabs");
  if (fix.kind === "base64") return t("fix.base64");
  if (fix.kind === "insert") return t("fix.insert", { label: fix.label });
  const label = fix.label.length > 40 ? fix.label.slice(0, 39) + "…" : fix.label;
  return t("fix.apply", { label });
}

function fixInView(cm, items) {
  const doc = cm.state.doc.toString();
  const sorted = items.map(({ block, fix }) => docFix(block, fix, doc)).filter(Boolean).sort((a, b) => a.from - b.from || a.to - b.to);
  const changes = [];
  let last = -1;
  for (const { from, to, insert } of sorted) {
    if (from < last) continue;
    changes.push({ from, to, insert });
    last = Math.max(to, from + 1);
  }
  if (!changes.length) {
    new Notice(t("fix.stale"));
    return 0;
  }
  cm.dispatch({ changes, effects: refreshEffect.of(null), userEvent: "input" });
  return changes.length;
}

function plural(n, one, many) {
  return n === 1 ? t(one) : t(many, { n });
}

function countLevels(issues) {
  const c = { error: 0, warning: 0, hint: 0 };
  for (const i of issues) c[i.level]++;
  return c;
}

function worthShowing(res) {
  return !!(res.skipped || res.issues.length || res.docs.some((d) => d.kind));
}

function shortAccess(modes) {
  const m = { ReadWriteOnce: "RWO", ReadOnlyMany: "ROX", ReadWriteMany: "RWX", ReadWriteOncePod: "RWOP" };
  return Array.isArray(modes) ? modes.map((x) => m[x] || x).join(",") : "";
}

function factsText(d) {
  const f = d.facts || {};
  const out = [];
  if (d.custom) out.push(t("fact.custom"));
  else if (d.unchecked) out.push(t("fact.beta"));
  if (typeof f.replicas === "number") out.push(f.replicas === 1 ? t("fact.replica") : t("fact.replicas", { n: f.replicas }));
  if (f.images && f.images.length) out.push(f.images[0] + (f.images.length > 1 ? ` +${f.images.length - 1}` : ""));
  if (d.kind === "Service" && f.type) {
    const ports = (f.ports || []).map((p) => (p.target != null && String(p.target) !== String(p.port) ? `${p.port}→${p.target}` : String(p.port)) + (p.nodePort ? `:${p.nodePort}` : ""));
    out.push([f.type, ports.join(", ")].filter(Boolean).join(" "));
  }
  if (f.hosts && f.hosts.length) out.push(f.hosts.join(", "));
  if (typeof f.keys === "number") out.push(t("fact.keys", { n: f.keys }));
  if (f.schedule) out.push(f.schedule);
  if (f.storage) out.push([f.storage, shortAccess(f.access)].filter(Boolean).join(" "));
  if (typeof f.max === "number") out.push(t("fact.range", { min: f.min, max: f.max }));
  return out;
}

class SummaryWidget extends WidgetType {
  constructor(plugin, block, sig) {
    super();
    this.plugin = plugin;
    this.block = block;
    this.sig = sig;
  }
  eq(o) {
    return o.sig === this.sig;
  }
  toDOM(view) {
    const el = view.dom.win.createDiv({ cls: "ek-widget", attr: { contenteditable: "false" } });
    const block = this.block;
    this.plugin.renderSummary(el, this.block.res, {
      lineOffset: this.block.firstLine,
      onFix: (fixes) => fixInView(view, fixes.map((fix) => ({ block, fix }))),
      onJump: (issue) => {
        const pos = Math.min(toDoc(block, issue.from), view.state.doc.length);
        view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
        view.focus();
      },
    });
    return el;
  }
  ignoreEvent() {
    return true;
  }
}

class KubePanel extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.mode = "file";
    this.scan = null;
  }
  getViewType() {
    return VIEW_PANEL;
  }
  getDisplayText() {
    return t("panel.title");
  }
  getIcon() {
    return iconName("ship-wheel");
  }
  async onOpen() {
    this.contentEl.addClass("ek-panel");
    this.render();
  }
  async onClose() {
    this.contentEl.empty();
  }
  async render() {
    const el = this.contentEl;
    el.empty();
    const head = el.createDiv({ cls: "ek-panel-head" });
    head.createDiv({ cls: "ek-panel-title", text: t("panel.title") });
    const tools = head.createDiv({ cls: "ek-panel-tools" });
    const btn = (name, label, fn) => {
      const b = tools.createDiv({ cls: "clickable-icon", attr: { "aria-label": label } });
      icon(b, name);
      b.addEventListener("click", fn);
    };
    if (this.mode === "scan") btn("arrow-left", t("panel.back"), () => this.showFile());
    btn("refresh-cw", t("panel.refresh"), () => (this.mode === "scan" ? this.runScan() : this.render()));
    if (this.mode !== "scan") btn("folder-search", t("panel.scan"), () => this.runScan());
    const body = el.createDiv({ cls: "ek-panel-body" });
    if (this.mode === "scan") this.renderScan(body);
    else await this.renderFile(body);
    el.createDiv({ cls: "ek-panel-foot", text: t("panel.schema", SCHEMA_INFO) });
  }
  showFile() {
    this.mode = "file";
    this.render();
  }
  async renderFile(body) {
    const target = this.plugin.targetFile();
    if (!target) return body.createDiv({ cls: "ek-empty", text: t("panel.noFile") });
    body.createDiv({ cls: "ek-panel-file", text: target.file.path });
    const text = await this.plugin.fileText(target);
    const mode = YAML_EXTS.has(target.file.extension) ? "yaml" : "markdown";
    const blocks = this.plugin.analyze(text, mode, true);
    if (!blocks.length) return body.createDiv({ cls: "ek-empty", text: t("panel.noYaml") });
    for (const b of blocks) {
      if (mode === "markdown") body.createDiv({ cls: "ek-block-label", text: t("panel.block", { line: b.openLine + 1 }) });
      const box = body.createDiv();
      this.plugin.renderSummary(box, b.res, {
        lineOffset: b.firstLine,
        expand: true,
        onFix: (fixes) => this.plugin.fixInTarget(target, mode, b, fixes),
        onJump: (issue) => {
          const p = toDocLine(b, issue.line, issue.col);
          this.plugin.jumpTo(target, p.line, p.ch);
        },
      });
    }
  }
  async runScan() {
    this.mode = "scan";
    const files = this.plugin.app.vault.getFiles().filter((f) => f.extension === "md" || (this.plugin.settings.yamlFiles && YAML_EXTS.has(f.extension)));
    this.scan = { running: true, n: files.length, rows: [] };
    this.render();
    const rows = [];
    for (const f of files) {
      const text = await this.plugin.app.vault.cachedRead(f);
      if (f.extension === "md" && !/^[ \t>]*(```|~~~)\s*(ya?ml|k8s|kubernetes)\b/im.test(text)) continue;
      const blocks = this.plugin.analyze(text, f.extension === "md" ? "markdown" : "yaml", false);
      if (!blocks.length) continue;
      const c = countLevels(blocks.flatMap((b) => b.res.issues));
      rows.push({ file: f, c, objects: blocks.reduce((a, b) => a + b.res.docs.filter((d) => d.kind).length, 0) });
    }
    rows.sort((a, b) => b.c.error - a.c.error || b.c.warning - a.c.warning || a.file.path.localeCompare(b.file.path));
    this.scan = { running: false, n: files.length, rows };
    if (this.mode === "scan") this.render();
  }
  renderScan(body) {
    const s = this.scan;
    if (!s || s.running) return body.createDiv({ cls: "ek-empty", text: t("panel.scanning", { n: s ? s.n : 0 }) });
    const bad = s.rows.filter((r) => r.c.error || r.c.warning).length;
    body.createDiv({ cls: "ek-scan-sum", text: bad ? t("panel.scanDone", { files: s.rows.length, bad }) : t("panel.scanClean") });
    const list = body.createDiv({ cls: "ek-scan-list" });
    for (const r of s.rows) {
      const row = list.createDiv({ cls: "ek-scan-row" });
      const ic = row.createSpan({ cls: "ek-scan-icon" });
      const level = r.c.error ? "error" : r.c.warning ? "warning" : "ok";
      ic.addClass("ek-" + level);
      icon(ic, level === "ok" ? "circle-check" : LEVEL_ICON[level]);
      row.createSpan({ cls: "ek-scan-path", text: r.file.path });
      const counts = row.createSpan({ cls: "ek-scan-counts" });
      if (r.c.error) counts.createSpan({ cls: "ek-error", text: String(r.c.error) });
      if (r.c.warning) counts.createSpan({ cls: "ek-warning", text: String(r.c.warning) });
      if (r.c.hint) counts.createSpan({ cls: "ek-hint", text: String(r.c.hint) });
      row.addEventListener("click", async () => {
        await this.plugin.app.workspace.getLeaf(false).openFile(r.file);
        this.showFile();
      });
    }
  }
}

class KubeSettings extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const el = this.containerEl;
    el.empty();
    const p = this.plugin;
    const toggle = (key, name, desc) =>
      new Setting(el)
        .setName(t(name))
        .setDesc(t(desc))
        .addToggle((tg) =>
          tg.setValue(p.settings[key]).onChange(async (v) => {
            p.settings[key] = v;
            await p.saveSettings();
          })
        );
    new Setting(el)
      .setName(t("set.lang"))
      .setDesc(t("set.langDesc"))
      .addDropdown((d) =>
        d
          .addOption("auto", t("set.langAuto"))
          .addOption("en", "English")
          .addOption("tr", "Türkçe")
          .setValue(p.settings.uiLang)
          .onChange(async (v) => {
            p.settings.uiLang = v;
            setUiLang(v);
            await p.saveSettings();
            this.display();
          })
      );
    toggle("underline", "set.underline", "set.underlineDesc");
    toggle("summary", "set.summary", "set.summaryDesc");
    toggle("hints", "set.hints", "set.hintsDesc");
    toggle("statusBar", "set.status", "set.statusDesc");
    toggle("ribbon", "set.ribbon", "set.ribbonDesc");
    toggle("yamlFiles", "set.files", "set.filesDesc");
    new Setting(el).setName(t("set.about")).setHeading();
    el.createEl("p", { cls: "setting-item-description", text: t("set.aboutDesc", SCHEMA_INFO) });
  }
}

export default class EcuKube extends Plugin {
  async onload() {
    this.settings = Object.assign({}, DEFAULTS, await this.loadData());
    setUiLang(this.settings.uiLang);
    this.cache = new Map();
    this.codeComp = new Compartment();

    this.mdField = this.makeField("markdown");
    this.yamlField = this.makeField("yaml");
    this.recheck = ViewPlugin.fromClass(
      class {
        constructor(view) {
          this.view = view;
          this.timer = null;
        }
        update(u) {
          if (!u.docChanged) return;
          clearTimeout(this.timer);
          this.timer = setTimeout(() => {
            try {
              this.view.dispatch({ effects: refreshEffect.of(null) });
            } catch (e) {
            }
          }, 350);
        }
        destroy() {
          clearTimeout(this.timer);
        }
      }
    );
    this.registerEditorExtension([this.mdField, this.recheck]);

    this.registerView(VIEW_PANEL, (leaf) => new KubePanel(leaf, this));
    this.registerMarkdownPostProcessor((el, ctx) => this.decorateReading(el, ctx));

    this.statusEl = this.addStatusBarItem();
    this.statusEl.addClass("ek-status", "mod-clickable");
    this.statusEl.setAttr("aria-label", t("status.tooltip"));
    this.statusEl.addEventListener("click", () => this.openPanel());
    this.syncRibbon();

    this.addCommand({ id: "open-panel", name: t("cmd.panel"), callback: () => this.openPanel() });
    this.addCommand({
      id: "check-vault",
      name: t("cmd.scan"),
      callback: async () => {
        const leaf = await this.openPanel();
        if (leaf && leaf.view instanceof KubePanel) leaf.view.runScan();
      },
    });
    this.addCommand({
      id: "toggle-hints",
      name: t("cmd.hints"),
      callback: async () => {
        this.settings.hints = !this.settings.hints;
        await this.saveSettings();
      },
    });
    this.addCommand({ id: "fix-at-cursor", name: t("cmd.fixHere"), editorCallback: (editor) => this.fixAtCursor(editor) });
    this.addCommand({ id: "fix-all", name: t("cmd.fixAll"), editorCallback: (editor) => this.fixAllInEditor(editor) });
    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu, editor) => {
        const hit = this.issueAtCursor(editor);
        if (!hit) return;
        menu.addItem((item) =>
          item
            .setTitle(fixLabel(hit.issue.fix))
            .setIcon(iconName("wand"))
            .onClick(() => fixInView(editor.cm, [{ block: hit.block, fix: hit.issue.fix }]))
        );
      })
    );
    this.addSettingTab(new KubeSettings(this.app, this));

    this.refreshSoon = debounce(() => this.refreshSide(), 400, true);
    const ws = this.app.workspace;
    this.registerEvent(ws.on("active-leaf-change", () => this.onLayout()));
    this.registerEvent(ws.on("file-open", () => this.onLayout()));
    this.registerEvent(ws.on("layout-change", () => this.onLayout()));
    this.registerEvent(ws.on("editor-change", () => this.refreshSoon()));
    this.registerEvent(
      this.app.vault.on("modify", (f) => {
        const tf = this.targetFile();
        if (tf && tf.file === f) this.refreshSoon();
      })
    );
    ws.onLayoutReady(() => this.onLayout());
  }

  onunload() {
    for (const leaf of this.app.workspace.getLeavesOfType(CODEKIT_VIEW)) {
      const ed = leaf.view && leaf.view.editor;
      if (ed && ed.state && ed.state.field(this.yamlField, false) !== undefined) ed.dispatch({ effects: this.codeComp.reconfigure([]) });
    }
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.syncRibbon();
    this.cache.clear();
    this.refreshAll();
  }

  cachedValidate(texts) {
    const key = (this.settings.hints ? "h:" : "n:") + texts.join("\u0000--\u0000");
    let r = this.cache.get(key);
    if (r) {
      this.cache.delete(key);
      this.cache.set(key, r);
      return r;
    }
    r = validateMany(texts, { hints: this.settings.hints });
    this.cache.set(key, r);
    if (this.cache.size > 12) this.cache.delete(this.cache.keys().next().value);
    return r;
  }

  analyze(text, mode, all) {
    const blocks = mode === "yaml" ? [{ from: 0, firstLine: 0, openLine: -1, closeLine: -1, text }] : extractBlocks(text);
    if (!blocks.length) return [];
    const results = this.cachedValidate(blocks.map((b) => b.text));
    const out = [];
    blocks.forEach((b, i) => {
      const res = results[i];
      if (!worthShowing(res) && !(all && mode === "yaml")) return;
      out.push(Object.assign({}, b, { res }));
    });
    return out;
  }

  makeField(mode) {
    const plugin = this;
    const build = (state) => {
      const s = plugin.settings;
      if (!s.underline && !(s.summary && mode === "markdown")) return Decoration.none;
      if (mode === "yaml" && !s.yamlFiles) return Decoration.none;
      const text = state.doc.toString();
      if (mode === "markdown" && !/^[ \t>]*(```|~~~)\s*(ya?ml|k8s|kubernetes)\b/im.test(text)) return Decoration.none;
      const len = state.doc.length;
      const ranges = [];
      for (const b of plugin.analyze(text, mode, false)) {
        if (s.underline)
          for (const i of b.res.issues) {
            const from = Math.min(toDoc(b, i.from), len);
            let to = Math.min(toDoc(b, i.to), len);
            const line = state.doc.lineAt(from);
            if (to > line.to) to = line.to;
            const msg = formatIssue(i, uiLang);
            if (to > from) ranges.push(Decoration.mark({ class: `ek-u ek-u-${i.level}`, attributes: { title: msg } }).range(from, to));
            ranges.push(Decoration.line({ class: `ek-l-${i.level}` }).range(line.from));
          }
        if (s.summary && mode === "markdown" && b.closeLine >= 0 && b.closeLine + 1 <= state.doc.lines) {
          const end = state.doc.line(b.closeLine + 1).to;
          const sig = uiLang + "|" + b.firstLine + "|" + b.from + "|" + (b.starts ? b.starts.join(",") : "") + "|" + JSON.stringify(b.res);
          ranges.push(Decoration.widget({ widget: new SummaryWidget(plugin, b, sig), block: true, side: 1 }).range(end));
        }
      }
      return Decoration.set(ranges, true);
    };
    return StateField.define({
      create: (state) => build(state),
      update: (deco, tr) => {
        if (tr.effects.some((e) => e.is(refreshEffect))) return build(tr.state);
        return tr.docChanged ? deco.map(tr.changes) : deco;
      },
      provide: (f) => EditorView.decorations.from(f),
    });
  }

  renderSummary(el, res, opts = {}) {
    const c = countLevels(res.issues);
    const level = c.error ? "error" : c.warning ? "warning" : "ok";
    const box = el.createDiv({ cls: `ek-summary ek-is-${level}` });
    const head = box.createDiv({ cls: "ek-sum-head" });
    const ic = head.createSpan({ cls: `ek-sum-icon ek-${level === "ok" && c.hint ? "hint" : level}` });
    icon(ic, res.skipped ? "braces" : level === "ok" ? "circle-check" : LEVEL_ICON[level]);
    const objs = head.createDiv({ cls: "ek-objs" });
    if (res.skipped) objs.createSpan({ cls: "ek-obj-facts", text: t("sum.template") });
    for (const d of res.docs.filter((x) => x.kind)) {
      const o = objs.createSpan({ cls: "ek-obj" });
      o.createSpan({ cls: "ek-obj-kind", text: d.kind });
      if (d.name) o.createSpan({ cls: "ek-obj-name", text: d.name + (d.namespace ? ` (${d.namespace})` : "") });
      const facts = factsText(d);
      if (facts.length) o.createSpan({ cls: "ek-obj-facts", text: facts.join(" · ") });
      for (const l of d.links || []) o.createSpan({ cls: "ek-obj-link", text: `${REVERSE.has(l.rel) ? "←" : "→"} ${l.kind}/${l.name}` });
    }
    const counts = head.createDiv({ cls: "ek-counts" });
    if (!res.issues.length && !res.skipped) counts.createSpan({ cls: "ek-ok", text: t("sum.ok") });
    if (c.error) counts.createSpan({ cls: "ek-error", text: plural(c.error, "sum.error", "sum.errors") });
    if (c.warning) counts.createSpan({ cls: "ek-warning", text: plural(c.warning, "sum.warning", "sum.warnings") });
    if (c.hint) counts.createSpan({ cls: "ek-hint", text: plural(c.hint, "sum.hint", "sum.hints") });
    if (!res.issues.length) return box;
    const stop = (e) => {
      e.preventDefault();
      e.stopPropagation();
    };
    const fixes = fixable(res.issues);
    if (opts.onFix && fixes.length > 1) {
      const all = counts.createEl("button", { cls: "ek-fix ek-fix-all", text: t("fix.all", { n: fixes.length }) });
      all.addEventListener("mousedown", stop);
      all.addEventListener("click", (e) => {
        stop(e);
        opts.onFix(fixes.map((i) => i.fix));
      });
    }

    const list = box.createDiv({ cls: "ek-issues" });
    const collapsed = !opts.expand && !c.error && !c.warning;
    if (collapsed) {
      list.addClass("ek-collapsed");
      head.addClass("ek-clickable");
      head.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        list.toggleClass("ek-collapsed", !list.hasClass("ek-collapsed"));
      });
    }
    for (const i of res.issues) {
      const row = list.createDiv({ cls: `ek-issue ek-issue-${i.level}` });
      const ic = row.createSpan({ cls: `ek-issue-icon ek-${i.level}`, attr: { "aria-label": t("level." + i.level) } });
      icon(ic, LEVEL_ICON[i.level]);
      const msg = row.createSpan({ cls: "ek-issue-msg", text: formatIssue(i, uiLang) });
      if (i.fix && opts.onFix) {
        const b = msg.createEl("button", { cls: "ek-fix", text: fixLabel(i.fix) });
        b.addEventListener("mousedown", stop);
        b.addEventListener("click", (e) => {
          stop(e);
          opts.onFix([i.fix]);
        });
      }
      const lineNo = opts.lineOffset != null ? opts.lineOffset + i.line : i.line;
      row.createSpan({ cls: "ek-issue-line", text: t("sum.line", { n: lineNo }) });
      if (opts.onJump) {
        row.addClass("ek-clickable");
        row.addEventListener("mousedown", (e) => {
          e.preventDefault();
          e.stopPropagation();
        });
        row.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          opts.onJump(i);
        });
      }
    }
    return box;
  }

  decorateReading(el, ctx) {
    if (!this.settings.summary) return;
    const codes = Array.from(el.querySelectorAll("pre > code")).filter((code) => {
      const cls = Array.from(code.classList).find((c) => c.startsWith("language-"));
      return cls && isYamlLang(cls.slice(9));
    });
    if (!codes.length) return;
    let base = null;
    try {
      const info = ctx.getSectionInfo(el);
      if (info) base = info.lineStart + 1;
    } catch (e) {
      base = null;
    }
    const file = ctx.sourcePath ? this.app.vault.getAbstractFileByPath(ctx.sourcePath) : null;
    const notePromise = file instanceof TFile ? this.app.vault.cachedRead(file).catch(() => null) : Promise.resolve(null);
    notePromise.then((note) => {
      const blocks = note ? this.analyze(note, "markdown", false) : [];
      for (const code of codes) {
        const pre = code.parentElement;
        if (!pre || (pre.nextElementSibling && pre.nextElementSibling.classList.contains("ek-reading"))) continue;
        const text = code.textContent.replace(/\n$/, "");
        const hit = blocks.find((b) => b.text === text);
        const res = hit ? hit.res : this.cachedValidate([text])[0];
        if (!worthShowing(res)) continue;
        const box = pre.win.createDiv({ cls: "ek-reading" });
        this.renderSummary(box, res, {
          lineOffset: hit ? hit.firstLine : base,
          onFix: file instanceof TFile ? (fixes) => this.fixInFile(file, "markdown", text, fixes) : null,
        });
        pre.insertAdjacentElement("afterend", box);
      }
    });
  }

  issueAtCursor(editor) {
    const cm = editor && editor.cm;
    if (!cm || !this.settings.underline) return null;
    const pos = cm.state.selection.main.head;
    for (const block of this.analyze(cm.state.doc.toString(), "markdown", false)) {
      if (pos < block.from || pos > toDoc(block, block.text.length)) continue;
      const issue = block.res.issues.find((i) => i.fix && i.fix.kind !== "tabs" && pos >= toDoc(block, i.from) && pos <= toDoc(block, i.to));
      if (issue) return { block, issue };
      const tabs = block.res.issues.find((i) => i.fix && i.fix.kind === "tabs");
      if (tabs) return { block, issue: tabs };
    }
    return null;
  }

  fixAtCursor(editor) {
    const hit = this.issueAtCursor(editor);
    if (!hit) return new Notice(t("fix.none"));
    fixInView(editor.cm, [{ block: hit.block, fix: hit.issue.fix }]);
  }

  fixAllInEditor(editor) {
    const cm = editor && editor.cm;
    if (!cm) return;
    const items = [];
    for (const b of this.analyze(cm.state.doc.toString(), "markdown", false)) for (const i of fixable(b.res.issues)) items.push({ block: b, fix: i.fix });
    if (!items.length) return new Notice(t("fix.none"));
    const n = fixInView(cm, items);
    if (n) new Notice(t("fix.done", { n }));
  }

  editorViewOf(target) {
    const v = target && target.view;
    if (v instanceof MarkdownView && v.getMode && v.getMode() === "source" && v.editor && v.editor.cm) return v.editor.cm;
    if (v && v.editor && v.editor.state && v.editor.dispatch) return v.editor;
    return null;
  }

  fixInTarget(target, mode, block, fixes) {
    const cm = this.editorViewOf(target);
    if (cm) return fixInView(cm, fixes.map((fix) => ({ block, fix })));
    return this.fixInFile(target.file, mode, block.text, fixes);
  }

  async fixInFile(file, mode, blockText, fixes) {
    let applied = 0;
    await this.app.vault.process(file, (data) => {
      let block = { from: 0 };
      if (mode === "markdown") {
        block = extractBlocks(data).find((x) => x.text === blockText);
        if (!block) return data;
      } else if (data !== blockText) return data;
      const r = applyFixes(data, fixes.map((fix) => docFix(block, fix, data)));
      applied = r.applied;
      return r.text;
    });
    if (!applied) new Notice(t("fix.stale"));
    return applied;
  }

  targetFile() {
    const ws = this.app.workspace;
    const leaf = ws.getMostRecentLeaf ? ws.getMostRecentLeaf() : null;
    const view = leaf && leaf.view;
    const file = view && view.file;
    if (!(file instanceof TFile)) return null;
    if (file.extension === "md" || (this.settings.yamlFiles && YAML_EXTS.has(file.extension))) return { leaf, view, file };
    return null;
  }

  async fileText(target) {
    const v = target.view;
    if (v instanceof MarkdownView && v.editor) return v.editor.getValue();
    if (v && v.editor && v.editor.state && v.editor.state.doc) return v.editor.state.doc.toString();
    return this.app.vault.cachedRead(target.file);
  }

  jumpTo(target, line, ch) {
    const v = target.view;
    const ws = this.app.workspace;
    ws.setActiveLeaf(target.leaf, { focus: true });
    if (v instanceof MarkdownView) {
      if (v.getMode && v.getMode() === "preview") {
        v.setEphemeralState({ line });
        return;
      }
      const pos = { line, ch: Math.max(0, ch) };
      v.editor.setCursor(pos);
      v.editor.scrollIntoView({ from: pos, to: pos }, true);
      v.editor.focus();
      return;
    }
    const ed = v && v.editor;
    if (ed && ed.state) {
      const l = ed.state.doc.line(Math.min(line + 1, ed.state.doc.lines));
      ed.dispatch({ selection: { anchor: Math.min(l.from + Math.max(0, ch), l.to) }, scrollIntoView: true });
      ed.focus();
    }
  }

  syncRibbon() {
    const title = t("cmd.panel");
    if (this.ribbonEl && (!this.settings.ribbon || this.ribbonTitle !== title)) {
      const ribbon = this.app.workspace.leftRibbon;
      if (ribbon && typeof ribbon.removeRibbonAction === "function") ribbon.removeRibbonAction(this.manifest.id + ":" + this.ribbonTitle);
      this.ribbonEl.detach();
      this.ribbonEl = null;
    }
    if (this.settings.ribbon && !this.ribbonEl) {
      this.ribbonTitle = title;
      this.ribbonEl = this.addRibbonIcon(iconName("ship-wheel"), title, () => this.openPanel());
    }
  }

  async openPanel() {
    const ws = this.app.workspace;
    let leaf = ws.getLeavesOfType(VIEW_PANEL)[0];
    if (!leaf) {
      leaf = ws.getRightLeaf(false);
      if (!leaf) return null;
      await leaf.setViewState({ type: VIEW_PANEL, active: true });
    }
    ws.revealLeaf(leaf);
    return leaf;
  }

  onLayout() {
    this.attachCodeViews();
    this.refreshSoon();
  }

  attachCodeViews() {
    if (!this.settings.yamlFiles) return;
    for (const leaf of this.app.workspace.getLeavesOfType(CODEKIT_VIEW)) {
      const v = leaf.view;
      const ed = v && v.editor;
      if (!ed || !ed.state || !v.file || !YAML_EXTS.has(v.file.extension)) continue;
      if (ed.state.field(this.yamlField, false) !== undefined) continue;
      try {
        ed.dispatch({ effects: StateEffect.appendConfig.of(this.codeComp.of([this.yamlField, this.recheck])) });
      } catch (e) {
        console.error("ecu-kube: could not attach to code view", e);
      }
    }
  }

  async refreshSide() {
    await this.updateStatus();
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_PANEL)) if (leaf.view instanceof KubePanel && leaf.view.mode === "file") leaf.view.render();
  }

  async updateStatus() {
    const el = this.statusEl;
    if (!el) return;
    el.empty();
    const target = this.settings.statusBar ? this.targetFile() : null;
    if (!target) return el.hide();
    const text = await this.fileText(target);
    const mode = YAML_EXTS.has(target.file.extension) ? "yaml" : "markdown";
    if (mode === "markdown" && !/^[ \t>]*(```|~~~)\s*(ya?ml|k8s|kubernetes)\b/im.test(text)) return el.hide();
    const blocks = this.analyze(text, mode, false);
    if (!blocks.length) return el.hide();
    el.show();
    const c = countLevels(blocks.flatMap((b) => b.res.issues));
    const level = c.error ? "error" : c.warning ? "warning" : "ok";
    const ic = el.createSpan({ cls: "ek-status-icon ek-" + level });
    icon(ic, level === "ok" ? "ship-wheel" : LEVEL_ICON[level]);
    el.createSpan({ text: level === "ok" ? "K8s" : String(c.error || c.warning) });
  }

  refreshAll() {
    const ws = this.app.workspace;
    for (const leaf of ws.getLeavesOfType("markdown")) {
      const v = leaf.view;
      const cm = v && v.editor && v.editor.cm;
      if (cm) cm.dispatch({ effects: refreshEffect.of(null) });
      if (v && v.previewMode && v.previewMode.rerender) v.previewMode.rerender(true);
    }
    for (const leaf of ws.getLeavesOfType(CODEKIT_VIEW)) {
      const ed = leaf.view && leaf.view.editor;
      if (ed && ed.dispatch) ed.dispatch({ effects: refreshEffect.of(null) });
    }
    this.attachCodeViews();
    this.refreshSide();
  }
}
