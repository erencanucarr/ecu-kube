import { parseAllDocuments, LineCounter, isMap, isSeq, isScalar, isAlias, visit } from "yaml";
import SCHEMA from "./schema.json";

const N = SCHEMA.n;
export const SCHEMA_INFO = { k8s: SCHEMA.k8s, gateway: SCHEMA.gateway.replace(/^v/, ""), metallb: SCHEMA.metallb.replace(/^v/, ""), certManager: SCHEMA.certManager.replace(/^v/, ""), prometheusOperator: SCHEMA.prometheusOperator.replace(/^v/, ""), argocd: SCHEMA.argocd.replace(/^v/, "") };

const REMOVED = [
  ["extensions/v1beta1", "Deployment DaemonSet ReplicaSet", "1.16", "apps/v1"],
  ["extensions/v1beta1", "NetworkPolicy", "1.16", "networking.k8s.io/v1"],
  ["extensions/v1beta1", "Ingress", "1.22", "networking.k8s.io/v1"],
  ["extensions/v1beta1", "PodSecurityPolicy", "1.16", ""],
  ["apps/v1beta1", "Deployment StatefulSet ReplicaSet DaemonSet ControllerRevision", "1.16", "apps/v1"],
  ["apps/v1beta2", "Deployment StatefulSet ReplicaSet DaemonSet ControllerRevision", "1.16", "apps/v1"],
  ["networking.k8s.io/v1beta1", "Ingress IngressClass", "1.22", "networking.k8s.io/v1"],
  ["batch/v1beta1", "CronJob", "1.25", "batch/v1"],
  ["batch/v2alpha1", "CronJob", "1.21", "batch/v1"],
  ["policy/v1beta1", "PodDisruptionBudget", "1.25", "policy/v1"],
  ["policy/v1beta1", "PodSecurityPolicy", "1.25", ""],
  ["autoscaling/v2beta1", "HorizontalPodAutoscaler", "1.25", "autoscaling/v2"],
  ["autoscaling/v2beta2", "HorizontalPodAutoscaler", "1.26", "autoscaling/v2"],
  ["rbac.authorization.k8s.io/v1beta1", "Role RoleBinding ClusterRole ClusterRoleBinding", "1.22", "rbac.authorization.k8s.io/v1"],
  ["rbac.authorization.k8s.io/v1alpha1", "Role RoleBinding ClusterRole ClusterRoleBinding", "1.22", "rbac.authorization.k8s.io/v1"],
  ["storage.k8s.io/v1beta1", "StorageClass CSIDriver CSINode VolumeAttachment", "1.22", "storage.k8s.io/v1"],
  ["storage.k8s.io/v1beta1", "CSIStorageCapacity", "1.27", "storage.k8s.io/v1"],
  ["apiextensions.k8s.io/v1beta1", "CustomResourceDefinition", "1.22", "apiextensions.k8s.io/v1"],
  ["admissionregistration.k8s.io/v1beta1", "MutatingWebhookConfiguration ValidatingWebhookConfiguration", "1.22", "admissionregistration.k8s.io/v1"],
  ["apiregistration.k8s.io/v1beta1", "APIService", "1.22", "apiregistration.k8s.io/v1"],
  ["scheduling.k8s.io/v1beta1", "PriorityClass", "1.22", "scheduling.k8s.io/v1"],
  ["certificates.k8s.io/v1beta1", "CertificateSigningRequest", "1.22", "certificates.k8s.io/v1"],
  ["coordination.k8s.io/v1beta1", "Lease", "1.22", "coordination.k8s.io/v1"],
  ["discovery.k8s.io/v1beta1", "EndpointSlice", "1.25", "discovery.k8s.io/v1"],
  ["events.k8s.io/v1beta1", "Event", "1.25", "events.k8s.io/v1"],
  ["node.k8s.io/v1beta1", "RuntimeClass", "1.25", "node.k8s.io/v1"],
  ["flowcontrol.apiserver.k8s.io/v1beta1", "FlowSchema PriorityLevelConfiguration", "1.26", "flowcontrol.apiserver.k8s.io/v1"],
  ["flowcontrol.apiserver.k8s.io/v1beta2", "FlowSchema PriorityLevelConfiguration", "1.29", "flowcontrol.apiserver.k8s.io/v1"],
  ["flowcontrol.apiserver.k8s.io/v1beta3", "FlowSchema PriorityLevelConfiguration", "1.32", "flowcontrol.apiserver.k8s.io/v1"],
];
const REMOVED_MAP = new Map();
for (const [av, kinds, ver, use] of REMOVED) for (const k of kinds.split(" ")) REMOVED_MAP.set(`${av}|${k}`, { ver, use });

const KIND_INDEX = new Map();
for (const [av, m] of Object.entries(SCHEMA.kinds)) for (const k of Object.keys(m)) (KIND_INDEX.get(k) || KIND_INDEX.set(k, []).get(k)).push(av);
const ALL_KINDS = [...KIND_INDEX.keys()];
const BUILTIN_GROUPS = new Set(
  Object.keys(SCHEMA.kinds)
    .map(groupOf)
    .filter((g) => g === "" || !/\.(io|com|org|dev|net)$/.test(g) || g.endsWith("k8s.io"))
);
for (const [av] of REMOVED) BUILTIN_GROUPS.add(groupOf(av));

const WORKLOADS = new Set(["Deployment", "StatefulSet", "DaemonSet", "ReplicaSet", "ReplicationController"]);
const PLACEHOLDER = /<[^<>\n]+>|\$\{[^}]+\}|\$\([^)]+\)|^\$[A-Z_][A-Z0-9_]*$|^(\.\.\.|…)$/;
const DNS_LABEL = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;
const DNS_1035 = /^[a-z]([-a-z0-9]*[a-z0-9])?$/;
const DNS_SUB = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$/;
const LABEL_NAME = /^([A-Za-z0-9][-A-Za-z0-9_.]*)?[A-Za-z0-9]$/;
const QTY = /^[+-]?(\d+(\.\d*)?|\.\d+)(Ki|Mi|Gi|Ti|Pi|Ei|n|u|m|k|M|G|T|P|E|[eE][+-]?\d+)?$/;
const QTY_MUL = { n: 1e-9, u: 1e-6, m: 1e-3, k: 1e3, M: 1e6, G: 1e9, T: 1e12, P: 1e15, E: 1e18, Ki: 1024, Mi: 1024 ** 2, Gi: 1024 ** 3, Ti: 1024 ** 4, Pi: 1024 ** 5, Ei: 1024 ** 6 };
const YAML_CODES = new Set(["DUPLICATE_KEY", "TAB_AS_INDENT", "BAD_INDENT", "MISSING_CHAR", "MULTILINE_IMPLICIT_KEY", "BLOCK_AS_IMPLICIT_KEY", "UNEXPECTED_TOKEN", "BAD_SCALAR_START", "BAD_DQ_ESCAPE"]);

function goYamlTags(tags) {
  return tags.filter((t) => t.tag !== "tag:yaml.org,2002:timestamp" && t.format !== "TIME");
}

function knownApiVersion(apiVersion) {
  if (!apiVersion) return false;
  if (SCHEMA.kinds[apiVersion]) return true;
  return REMOVED.some(([av]) => av === apiVersion);
}

function groupOf(apiVersion) {
  const i = apiVersion.indexOf("/");
  return i < 0 ? "" : apiVersion.slice(0, i);
}

export function parseQuantity(v) {
  if (typeof v === "number") return v;
  const m = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))(Ki|Mi|Gi|Ti|Pi|Ei|n|u|m|k|M|G|T|P|E|[eE][+-]?\d+)?$/.exec(String(v));
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!m[2]) return n;
  if (/^[eE]/.test(m[2])) return n * 10 ** parseInt(m[2].slice(1), 10);
  return n * QTY_MUL[m[2]];
}

function quantityFix(s) {
  const m = /^(\d+(?:\.\d+)?)\s*([A-Za-z]+)$/.exec(s.trim());
  if (!m) return null;
  const u = m[2].toLowerCase();
  if (["kb", "kib", "ki", "k"].includes(u)) return m[1] + "Ki";
  if (["mb", "mib", "mi"].includes(u)) return m[1] + "Mi";
  if (["gb", "gib", "gi", "g"].includes(u)) return m[1] + "Gi";
  if (["tb", "tib", "ti", "t"].includes(u)) return m[1] + "Ti";
  if (["core", "cores", "cpu", "cpus"].includes(u)) return m[1];
  if (["mcpu", "millicores", "millicore"].includes(u)) return m[1] + "m";
  return null;
}

function lev(a, b) {
  if (Math.abs(a.length - b.length) > 3) return 99;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  return d[a.length][b.length];
}

function closest(word, list) {
  const lw = word.toLowerCase();
  const same = list.find((c) => c.toLowerCase() === lw);
  if (same) return same;
  const max = word.length <= 4 ? 1 : 2;
  let best = null;
  let bestD = max + 1;
  for (const c of list) {
    const dd = lev(lw, c.toLowerCase());
    if (dd < bestD) {
      bestD = dd;
      best = c;
    }
  }
  return best;
}

function joinPath(base, key) {
  if (typeof key === "number") return `${base}[${key}]`;
  return base ? `${base}.${key}` : key;
}

function typeName(ref) {
  if (typeof ref === "number") {
    const s = N[ref];
    if (s.t === "o" || s.t === "m") return "map";
    if (s.t === "a") return "list";
    return typeName(s.t);
  }
  return { s: "string", i: "integer", n: "number", b: "boolean", is: "intOrString", q: "quantity" }[ref] || "any";
}

function kindOfNode(node) {
  if (isMap(node)) return "map";
  if (isSeq(node)) return "list";
  if (isScalar(node)) {
    const v = node.value;
    if (typeof v === "number") return "number";
    if (typeof v === "boolean") return "boolean";
    return "string";
  }
  return "any";
}

export function validate(text, opts = {}) {
  return validateMany([text], opts)[0];
}

export function validateMany(texts, opts = {}) {
  const ctx = { hints: opts.hints !== false, objects: [], doc: null, results: [], res: null, cur: null, raws: [] };
  const counters = [];
  texts.forEach((raw, part) => {
    const res = { docs: [], issues: [], skipped: null };
    ctx.results.push(res);
    ctx.res = res;
    ctx.part = part;
    ctx.raws.push(raw);
    const lc = new LineCounter();
    counters.push(lc);
    if (/\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\}/.test(raw)) {
      res.skipped = "template";
      return;
    }
    parseInto(ctx, unwrapHeredoc(raw), lc);
  });
  crossChecks(ctx);
  const rank = { error: 0, warning: 1, hint: 2 };
  ctx.results.forEach((res, part) => {
    const lc = counters[part];
    for (const is of res.issues) {
      const p = lc.linePos(is.from);
      is.line = p.line;
      is.col = p.col;
      is.endLine = lc.linePos(Math.max(is.from, is.to - 1)).line;
    }
    res.issues.sort((a, b) => a.from - b.from || rank[a.level] - rank[b.level]);
    for (const d of res.docs) {
      d.line = lc.linePos(d.from).line;
      d.endLine = lc.linePos(Math.max(d.from, d.to - 1)).line;
    }
  });
  return ctx.results;
}

function parseInto(ctx, text, lc) {
  const res = ctx.res;
  let docs = [];
  try {
    docs = parseAllDocuments(text, { version: "1.1", lineCounter: lc, uniqueKeys: true, prettyErrors: false, merge: true, customTags: goYamlTags });
  } catch (e) {
    add(ctx, "error", "yaml.raw", [0, 0], { msg: String(e.message || e) });
  }
  if (!Array.isArray(docs)) docs = [];
  for (const doc of docs) {
    ctx.doc = doc;
    rootDoc = doc;
    aliasBudget = 0;
    aliasLimit = Math.max(20000, 50 * nodeSize(doc.contents));
    if (doc.errors.length) {
      for (const e of doc.errors.slice(0, 1)) {
        const [from, to] = e.pos || [0, 0];
        const code = YAML_CODES.has(e.code) ? "yaml." + e.code : "yaml.raw";
        const vars = { msg: String(e.message).split("\n")[0].replace(/ at line \d+, column \d+.*$/, "") };
        if (e.code === "DUPLICATE_KEY") vars.key = dupKey(doc, from, to, text);
        if (doc.errors.length > 1 && !doc.errors.every((x) => x.code === "DUPLICATE_KEY")) vars.more = doc.errors.length - 1;
        const issue = add(ctx, "error", code, [from, Math.max(to, from + 1)], vars);
        if (e.code === "TAB_AS_INDENT") {
          const raw = rawOf(ctx);
          const fixed = raw.replace(/^[\t ]+/gm, (m) => m.replace(/\t/g, "  "));
          if (fixed !== raw) setFix(ctx, issue, 0, raw.length, fixed, "", "tabs");
        }
      }
      res.docs.push({ broken: true, from: doc.range[0], to: doc.range[2] });
      continue;
    }
    const root = doc.contents;
    if (!root) continue;
    if (!isMap(root) || (!pairOf(root, "kind") && !pairOf(root, "apiVersion"))) {
      res.docs.push({ generic: true, from: doc.range[0], to: doc.range[2] });
      continue;
    }
    const kind = str(get(root, "kind"));
    const av = str(get(root, "apiVersion"));
    if ((!kind && !knownApiVersion(av)) || (av === "v1" && kind === "Config")) {
      res.docs.push({ generic: true, from: doc.range[0], to: doc.range[2] });
      continue;
    }
    const items = get(root, "items");
    if (/List$/.test(kind || "") && isSeq(items)) {
      for (const it of items.items) if (isMap(res1(it))) processObject(ctx, res1(it));
      continue;
    }
    processObject(ctx, root);
  }
}

function blank(line) {
  return line.replace(/[^\s]/g, " ");
}

function unwrapHeredoc(text) {
  const lines = text.split("\n");
  const first = lines.findIndex((l) => l.trim() !== "");
  if (first < 0) return text;
  const m = /<<-?\s*(['"]?)([A-Za-z_][\w]*)\1/.exec(lines[first]);
  if (!m || /^\s*[\w.-]+\s*:/.test(lines[first])) return text;
  const end = lines.findIndex((l, i) => i > first && l.trim() === m[2]);
  lines[first] = blank(lines[first]);
  if (end > 0) for (let i = end; i < lines.length; i++) lines[i] = blank(lines[i]);
  return lines.join("\n");
}

function dupKey(doc, from, to, text) {
  const s = text.slice(from, to).split(/[:\n]/)[0].trim();
  return s || "?";
}

function add(ctx, level, code, at, vars = {}) {
  if (level === "hint" && !ctx.hints) return;
  let from = 0;
  let to = 0;
  if (Array.isArray(at)) [from, to] = at;
  else if (at && at.range) [from, to] = [at.range[0], at.range[1]];
  if (to <= from) to = from + 1;
  const res = ctx.cur ? ctx.results[ctx.cur.part] : ctx.res;
  const issue = { level, code, vars, from, to, obj: ctx.cur ? ctx.cur.id : null };
  res.issues.push(issue);
  return issue;
}

function rawOf(ctx) {
  return ctx.raws[ctx.cur ? ctx.cur.part : ctx.part];
}

function setFix(ctx, issue, from, to, insert, label, kind) {
  const raw = rawOf(ctx);
  if (!issue || raw == null || from < 0 || to > raw.length || to < from) return issue;
  issue.fix = { from, to, insert, label: label == null ? insert : label, kind: kind || "replace", expect: raw.slice(from, to) };
  return issue;
}

function scalarText(node, value) {
  if (node.type === "QUOTE_DOUBLE") return JSON.stringify(String(value));
  if (node.type === "QUOTE_SINGLE") return "'" + String(value).replace(/'/g, "''") + "'";
  return String(value);
}

function replaceScalar(ctx, issue, node, value, label) {
  if (!issue || !node || !node.range) return issue;
  return setFix(ctx, issue, node.range[0], node.range[1], scalarText(node, value), label == null ? String(value) : label);
}

function insertBefore(ctx, issue, keyN, text) {
  const raw = rawOf(ctx);
  if (!issue || !keyN || !keyN.range || raw == null) return issue;
  const at = keyN.range[0];
  const lineStart = raw.lastIndexOf("\n", at - 1) + 1;
  if (!/^\s*(-\s+)*$/.test(raw.slice(lineStart, at))) return issue;
  const col = at - lineStart;
  return setFix(ctx, issue, at, at, text + "\n" + " ".repeat(col), text, "insert");
}

function b64(str) {
  try {
    let bin = "";
    for (const b of new TextEncoder().encode(str)) bin += String.fromCharCode(b);
    return btoa(bin);
  } catch (e) {
    return null;
  }
}

let aliasBudget = 0;
let aliasLimit = 20000;
const aliasTargets = new WeakMap();
const nodeSizes = new WeakMap();
function aliasTarget(alias) {
  let targets = aliasTargets.get(rootDoc);
  if (!targets) {
    targets = new Map();
    const anchors = new Map();
    const depths = new Map();
    visit(rootDoc, {
      Node: (_k, n, path) => {
        if (n.anchor) anchors.set(n.anchor, n);
        if (!isAlias(n)) return;
        const target = anchors.get(n.source);
        const depth = target && !path.includes(target) ? (depths.get(target) || 0) + 1 : Infinity;
        if (depth > 20) return targets.set(n, null);
        targets.set(n, target);
        for (const p of path) if ((depths.get(p) || 0) < depth) depths.set(p, depth);
      },
    });
    aliasTargets.set(rootDoc, targets);
  }
  return targets.get(alias) || null;
}
function nodeSize(node) {
  if (!node || typeof node !== "object") return 1;
  let size = nodeSizes.get(node);
  if (size) return size;
  size = 1;
  if (isMap(node)) for (const p of node.items) size += nodeSize(p.key) + nodeSize(p.value);
  else if (isSeq(node)) for (const it of node.items) size += nodeSize(it);
  nodeSizes.set(node, size);
  return size;
}
function res1(node) {
  if (isAlias(node) && rootDoc) {
    const target = aliasTarget(node);
    if (!target || (aliasBudget += nodeSize(target)) > aliasLimit) return null;
    return target;
  }
  return node;
}
let rootDoc = null;

function pairOf(map, key) {
  if (!isMap(map)) return null;
  return map.items.find((p) => isScalar(p.key) && String(p.key.value) === key) || null;
}
function get(map, key) {
  const p = pairOf(map, key);
  return p ? res1(p.value) : null;
}
function dig(node, ...keys) {
  for (const k of keys) {
    if (!node) return null;
    node = typeof k === "number" ? (isSeq(node) ? res1(node.items[k]) : null) : get(node, k);
  }
  return node || null;
}
function keyNode(map, key) {
  const p = pairOf(map, key);
  return p ? p.key : null;
}
function str(node) {
  return isScalar(node) && node.value != null ? String(node.value) : null;
}
function setKey(out, k, v) {
  if (k in out) Object.defineProperty(out, k, { value: v, writable: true, enumerable: true, configurable: true });
  else out[k] = v;
}
function plain(node) {
  if (!node) return null;
  node = res1(node);
  if (!node) throw new Error("alias");
  if (isScalar(node)) return node.value;
  if (isSeq(node)) return node.items.map(plain);
  if (!isMap(node)) return null;
  const out = {};
  for (const p of node.items) {
    if (isScalar(p.key) && (p.key.value === "<<" || (typeof p.key.value === "symbol" && p.key.value.description === "<<"))) {
      const src = res1(p.value);
      for (const m of isSeq(src) ? src.items : [src]) {
        const merged = plain(m);
        if (!merged || typeof merged !== "object" || Array.isArray(merged)) throw new Error("merge");
        for (const [k, v] of Object.entries(merged)) if (!Object.prototype.hasOwnProperty.call(out, k)) setKey(out, k, v);
      }
      continue;
    }
    const k = isScalar(p.key) ? String(p.key.value ?? "") : p.key ? JSON.stringify(plain(p.key)) : "";
    setKey(out, k, plain(p.value));
  }
  return out;
}
function js(node) {
  if (!node) return undefined;
  try {
    return plain(node);
  } catch (e) {
    return undefined;
  }
}
function seq(node) {
  return isSeq(node) ? node.items.map(res1) : [];
}
function isPh(v) {
  return typeof v === "string" && PLACEHOLDER.test(v);
}

function processObject(ctx, map) {
  rootDoc = ctx.doc;
  const kindN = get(map, "kind");
  const avN = get(map, "apiVersion");
  const kind = str(kindN);
  let apiVersion = str(avN);
  const meta = get(map, "metadata");
  const obj = {
    id: ctx.objects.length,
    part: ctx.part,
    kind,
    apiVersion,
    name: str(get(meta, "name")),
    namespace: str(get(meta, "namespace")),
    node: map,
    doc: ctx.doc,
    from: map.range[0],
    to: map.range[2],
    facts: {},
    links: [],
  };
  ctx.objects.push(obj);
  ctx.cur = obj;
  ctx.results[ctx.part].docs.push(obj);

  if (!kind && !isPh(apiVersion)) add(ctx, "error", "obj.noKind", map.items[0] ? map.items[0].key : [map.range[0], map.range[0] + 1]);
  if (!apiVersion && !isPh(kind)) {
    const cands = kind ? KIND_INDEX.get(kind) : null;
    const issue = add(ctx, "error", "obj.noApiVersion", kindN || [map.range[0], map.range[0] + 1], { suggest: cands ? cands[0] : "" });
    if (cands && cands.length === 1 && map.items[0]) insertBefore(ctx, issue, map.items[0].key, `apiVersion: ${cands[0]}`);
    if (cands && cands.length === 1) apiVersion = cands[0];
  }
  if (!kind || !apiVersion) return finishObject(ctx, obj);
  if (isPh(kind) || isPh(apiVersion)) {
    obj.unchecked = true;
    return finishObject(ctx, obj);
  }

  let entry = SCHEMA.kinds[apiVersion] && SCHEMA.kinds[apiVersion][kind];
  if (entry === undefined) {
    const removed = REMOVED_MAP.get(`${apiVersion}|${kind}`);
    const others = KIND_INDEX.get(kind);
    const group = groupOf(apiVersion);
    if (removed) {
      const issue = add(ctx, "error", removed.use ? "api.removed" : "api.removedNoReplace", avN || kindN, { apiVersion, kind, ver: removed.ver, use: removed.use });
      if (removed.use && avN) replaceScalar(ctx, issue, avN, removed.use);
    } else if (others && !/alpha|beta/.test(apiVersion)) {
      const issue = add(ctx, "error", "api.wrongVersion", avN || kindN, { apiVersion, kind, use: others.join(", ") });
      if (others.length === 1 && avN) replaceScalar(ctx, issue, avN, others[0]);
    } else if (BUILTIN_GROUPS.has(group) && /alpha|beta/.test(apiVersion)) {
      add(ctx, "hint", "api.beta", avN, { apiVersion });
    } else if (SCHEMA.kinds[apiVersion] || BUILTIN_GROUPS.has(group)) {
      const near = closest(kind, ALL_KINDS);
      const issue = add(ctx, "error", near ? "kind.typo" : "kind.unknown", kindN, { kind, apiVersion, suggest: near || "" });
      if (near) replaceScalar(ctx, issue, kindN, near);
    } else {
      const near = closest(kind, ALL_KINDS);
      if (near && near !== kind && lev(near.toLowerCase(), kind.toLowerCase()) <= 1 && KIND_INDEX.get(near).includes(apiVersion))
        replaceScalar(ctx, add(ctx, "error", "kind.typo", kindN, { kind, apiVersion, suggest: near }), kindN, near);
      else obj.custom = true;
    }
    obj.unchecked = true;
  }
  if (entry !== undefined) {
    obj.clusterScoped = Array.isArray(entry);
    const ref = Array.isArray(entry) ? entry[0] : entry;
    walk(ctx, map, ref, "", null, true);
  }
  semantic(ctx, obj);
  return finishObject(ctx, obj);
}

function finishObject(ctx, obj) {
  ctx.cur = null;
  return obj;
}

function walk(ctx, node, ref, path, keyN, top) {
  node = res1(node);
  if (!node) return;
  if (isScalar(node) && node.value === null) return;
  if (typeof ref === "string") return checkPrim(ctx, node, ref, path, keyN);
  const s = N[ref];
  if (typeof s.t === "string" && s.t !== "o" && s.t !== "a" && s.t !== "m") {
    if (!checkPrim(ctx, node, s.t, path, keyN)) return;
    if (s.e && !s.e.includes(node.value) && !isPh(node.value)) {
      const near = closest(String(node.value), s.e.filter(Boolean));
      const issue = add(ctx, "error", near ? "enum.typo" : "enum.bad", node, { path, value: String(node.value), suggest: near || "", options: s.e.filter(Boolean).join(", ") });
      if (near) replaceScalar(ctx, issue, node, near);
    }
    return;
  }
  if (s.t === "o") {
    if (!isMap(node)) return typeErr(ctx, node, "map", path, keyN);
    const seen = new Set();
    const typoFor = new Set();
    let merged = false;
    for (const pair of node.items) {
      if (!isScalar(pair.key)) continue;
      const k = String(pair.key.value);
      if (k === "<<") {
        merged = true;
        continue;
      }
      seen.add(k);
      if (top && k === "status") continue;
      const sub = s.p[k];
      if (sub === undefined) {
        if (s.u) continue;
        const near = closest(k, Object.keys(s.p));
        if (near) typoFor.add(near);
        const issue = add(ctx, "error", near ? "field.typo" : "field.unknown", pair.key, { path: joinPath(path, k), field: k, suggest: near || "", parent: path || "(root)" });
        if (near) replaceScalar(ctx, issue, pair.key, near);
        continue;
      }
      walk(ctx, pair.value, sub, joinPath(path, k), pair.key, false);
    }
    if (s.r && !merged)
      for (const r of s.r)
        if (!seen.has(r) && !typoFor.has(r)) add(ctx, "error", "field.required", keyN || [node.range[0], node.range[0] + 1], { path: path || "(root)", field: r });
    return;
  }
  if (s.t === "a") {
    if (!isSeq(node)) return typeErr(ctx, node, "list", path, keyN);
    node.items.forEach((it, i) => walk(ctx, it, s.i, joinPath(path, i), null, false));
    return;
  }
  if (s.t === "m") {
    if (!isMap(node)) return typeErr(ctx, node, "map", path, keyN);
    for (const pair of node.items) {
      const k = isScalar(pair.key) ? String(pair.key.value) : "?";
      walk(ctx, pair.value, s.i, joinPath(path, k), pair.key, false);
    }
  }
}

function typeErr(ctx, node, expected, path, keyN) {
  add(ctx, "error", "type.expected", node.range ? node : keyN, { path, expected, got: kindOfNode(node) });
}

function checkPrim(ctx, node, p, path, keyN) {
  if (p === "x") return true;
  if (!isScalar(node)) {
    typeErr(ctx, node, typeName(p), path, keyN);
    return false;
  }
  const v = node.value;
  if (isPh(v)) return false;
  const src = node.source != null ? String(node.source) : String(v);
  switch (p) {
    case "s":
      if (typeof v !== "string") {
        setFix(ctx, add(ctx, "error", "type.quote", node, { path, value: src, got: kindOfNode(node) }), node.range[0], node.range[1], JSON.stringify(src));
        return false;
      }
      return true;
    case "i":
    case "n":
      if (typeof v === "number" && (p === "n" || Number.isInteger(v))) return true;
      if (p === "i" && typeof v === "string" && /^0o[0-7]+$/.test(v)) return true;
      if (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v)) setFix(ctx, add(ctx, "error", "type.unquote", node, { path, value: v, expected: typeName(p) }), node.range[0], node.range[1], v);
      else typeErr(ctx, node, typeName(p), path, keyN);
      return false;
    case "b":
      if (typeof v === "boolean") return true;
      if (typeof v === "string" && /^(true|false)$/i.test(v)) setFix(ctx, add(ctx, "error", "type.unquote", node, { path, value: v, expected: "boolean" }), node.range[0], node.range[1], v.toLowerCase());
      else typeErr(ctx, node, "boolean", path, keyN);
      return false;
    case "is":
      if ((typeof v === "number" && Number.isInteger(v)) || typeof v === "string") return true;
      typeErr(ctx, node, "intOrString", path, keyN);
      return false;
    case "q":
      if (typeof v === "number") return true;
      if (typeof v === "string" && QTY.test(v)) return true;
      if (typeof v === "string") {
        const fix = quantityFix(v);
        const issue = add(ctx, "error", fix ? "qty.fix" : "qty.bad", node, { path, value: v, suggest: fix || "" });
        if (fix) replaceScalar(ctx, issue, node, fix);
      } else typeErr(ctx, node, "quantity", path, keyN);
      return false;
  }
  return true;
}

function podSpecOf(obj) {
  const m = obj.node;
  switch (obj.kind) {
    case "Pod":
      return { spec: get(m, "spec"), path: "spec", labels: dig(m, "metadata", "labels") };
    case "CronJob":
      return { spec: dig(m, "spec", "jobTemplate", "spec", "template", "spec"), path: "spec.jobTemplate.spec.template.spec", labels: dig(m, "spec", "jobTemplate", "spec", "template", "metadata", "labels") };
    default:
      if (WORKLOADS.has(obj.kind) || obj.kind === "Job")
        return { spec: dig(m, "spec", "template", "spec"), path: "spec.template.spec", labels: dig(m, "spec", "template", "metadata", "labels") };
  }
  return null;
}

function semantic(ctx, obj) {
  const m = obj.node;
  const meta = get(m, "metadata");
  const builtin = !obj.custom && !obj.unchecked;
  const group = groupOf(obj.apiVersion || "");

  if (builtin || obj.custom) {
    const nameN = get(meta, "name");
    if (!nameN && !get(meta, "generateName") && (builtin || meta)) add(ctx, "error", "meta.noName", keyNode(m, "metadata") || keyNode(m, "kind") || [m.range[0], m.range[0] + 1]);
    const name = str(nameN);
    if (name && !isPh(name) && builtin && group !== "rbac.authorization.k8s.io") {
      const rule = obj.kind === "Service" ? "dns1035" : obj.kind === "Namespace" ? "label" : "subdomain";
      const ok = rule === "dns1035" ? DNS_1035.test(name) && name.length <= 63 : rule === "label" ? DNS_LABEL.test(name) && name.length <= 63 : DNS_SUB.test(name) && name.length <= 253;
      if (!ok) {
        let fix = name.toLowerCase().replace(/[^a-z0-9.-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "");
        if (rule !== "subdomain") fix = fix.replace(/\./g, "-");
        if (rule === "dns1035") fix = fix.replace(/^[0-9-]+/, "");
        const issue = add(ctx, "error", "meta.badName." + rule, nameN, { name, suggest: fix && fix !== name ? fix : "" });
        if (fix && fix !== name) replaceScalar(ctx, issue, nameN, fix);
      }
    }
    const nsN = get(meta, "namespace");
    const ns = str(nsN);
    if (ns && !isPh(ns) && !(DNS_LABEL.test(ns) && ns.length <= 63)) add(ctx, "error", "meta.badNamespace", nsN, { ns });
    if (ns && obj.clusterScoped) {
      const kN = keyNode(meta, "namespace");
      const issue = add(ctx, "warning", "meta.clusterScoped", kN, { kind: obj.kind });
      const raw = rawOf(ctx);
      if (kN && raw != null) {
        const start = raw.lastIndexOf("\n", kN.range[0] - 1) + 1;
        let end = raw.indexOf("\n", kN.range[0]);
        end = end < 0 ? raw.length : end + 1;
        if (/^\s*namespace\s*:/.test(raw.slice(start, end))) setFix(ctx, issue, start, end, "", "", "delete");
      }
    }
    checkLabels(ctx, get(meta, "labels"), "metadata.labels", true);
    checkLabels(ctx, get(meta, "annotations"), "metadata.annotations", false);
  }
  if (!builtin) return;

  const spec = get(m, "spec");
  const k = obj.kind;
  const f = obj.facts;

  if (WORKLOADS.has(k)) {
    f.replicas = k === "DaemonSet" ? null : (js(get(spec, "replicas")) ?? 1);
    const selN = dig(spec, "selector", "matchLabels") || (k === "ReplicationController" ? get(spec, "selector") : null);
    const tplLabelsN = dig(spec, "template", "metadata", "labels");
    checkLabels(ctx, selN, "spec.selector.matchLabels", true);
    checkLabels(ctx, tplLabelsN, "spec.template.metadata.labels", true);
    const sel = js(selN);
    const tl = js(tplLabelsN) || {};
    if (sel && typeof sel === "object") {
      const bad = Object.entries(sel).filter(([kk, vv]) => tl[kk] !== vv);
      if (bad.length && !bad.some(([, vv]) => isPh(String(vv))))
        add(ctx, "error", "workload.selector", selN, {
          sel: bad.map(([kk, vv]) => `${kk}=${vv}`).join(", "),
          labels: Object.keys(tl).length ? Object.entries(tl).map(([kk, vv]) => `${kk}=${vv}`).join(", ") : "—",
        });
    }
  }

  const ps = podSpecOf(obj);
  if (ps && ps.spec) checkPod(ctx, obj, ps);

  if (k === "Service") checkService(ctx, obj, spec);
  if (k === "Ingress") {
    const hosts = seq(get(spec, "rules")).map((r) => str(get(r, "host"))).filter(Boolean);
    f.hosts = hosts;
  }
  if (k === "Secret") {
    const data = get(m, "data");
    if (isMap(data))
      for (const p of data.items) {
        const v = res1(p.value);
        if (!isScalar(v) || typeof v.value !== "string" || isPh(v.value)) continue;
        const s = v.value.replace(/\s+/g, "");
        if (s && (!/^[A-Za-z0-9+/]*={0,2}$/.test(s) || s.length % 4 !== 0)) {
          const enc = b64(v.value);
          const issue = add(ctx, "error", "secret.base64", v, { key: String(p.key.value) });
          if (enc) setFix(ctx, issue, v.range[0], v.range[1], enc, "", "base64");
        }
      }
    f.keys = (isMap(data) ? data.items.length : 0) + (isMap(get(m, "stringData")) ? get(m, "stringData").items.length : 0);
  }
  if (k === "ConfigMap") {
    const data = get(m, "data");
    f.keys = (isMap(data) ? data.items.length : 0) + (isMap(get(m, "binaryData")) ? get(m, "binaryData").items.length : 0);
    if (isMap(data))
      for (const p of data.items) {
        const key = isScalar(p.key) ? String(p.key.value) : "";
        if (key && !/^[-._a-zA-Z0-9]+$/.test(key)) add(ctx, "error", "configmap.badKey", p.key, { key });
      }
  }
  if (k === "CronJob") {
    const schN = get(spec, "schedule");
    const sch = str(schN);
    f.schedule = sch;
    if (sch && !isPh(sch)) {
      const err = cronError(sch);
      if (err) {
        const issue = add(ctx, "error", err, schN, { value: sch });
        if (err === "cron.seconds") replaceScalar(ctx, issue, schN, sch.trim().split(/\s+/).slice(1).join(" "));
      }
    }
  }
  if (k === "Job" || k === "CronJob") {
    const rp = ps && ps.spec ? str(get(ps.spec, "restartPolicy")) : null;
    if (ps && ps.spec && (!rp || rp === "Always")) {
      const issue = add(ctx, "error", "job.restartPolicy", keyNode(ps.spec, "restartPolicy") || keyNode(ps.spec, "containers") || ps.spec, {});
      if (rp) replaceScalar(ctx, issue, get(ps.spec, "restartPolicy"), "OnFailure");
      else if (isMap(ps.spec) && ps.spec.items[0]) insertBefore(ctx, issue, ps.spec.items[0].key, "restartPolicy: OnFailure");
    }
  }
  if (k === "PersistentVolumeClaim") {
    const st = dig(spec, "resources", "requests", "storage");
    f.storage = str(st);
    f.access = js(get(spec, "accessModes"));
    if (spec && !st && !get(spec, "dataSource") && !get(spec, "volumeName"))
      add(ctx, "error", "pvc.noStorage", keyNode(m, "spec"), {});
  }
  if (k === "PersistentVolume") f.storage = str(dig(spec, "capacity", "storage"));
  if (k === "HorizontalPodAutoscaler") {
    const min = js(get(spec, "minReplicas")) ?? 1;
    const max = js(get(spec, "maxReplicas"));
    f.min = min;
    f.max = max;
    if (typeof max === "number" && typeof min === "number" && min > max) add(ctx, "error", "hpa.minMax", get(spec, "minReplicas"), { min, max });
    const tgt = get(spec, "scaleTargetRef");
    if (tgt) obj.target = { kind: str(get(tgt, "kind")), name: str(get(tgt, "name")) };
  }
}

function checkLabels(ctx, node, path, isLabel) {
  if (!isMap(node)) return;
  for (const p of node.items) {
    if (!isScalar(p.key)) continue;
    const key = String(p.key.value);
    if (isPh(key)) continue;
    const parts = key.split("/");
    let ok = parts.length <= 2;
    const name = parts[parts.length - 1];
    if (ok && parts.length === 2) ok = DNS_SUB.test(parts[0]) && parts[0].length <= 253;
    if (ok) ok = LABEL_NAME.test(name) && name.length <= 63;
    if (!ok) add(ctx, "error", "label.badKey", p.key, { key, path });
    if (!isLabel) continue;
    const v = res1(p.value);
    if (isScalar(v) && typeof v.value === "string" && !isPh(v.value) && v.value !== "" && !(LABEL_NAME.test(v.value) && v.value.length <= 63))
      add(ctx, "error", "label.badValue", v, { key, value: v.value });
  }
}

function cronError(s) {
  s = s.trim();
  if (/^CRON_TZ=|^TZ=/.test(s)) return "cron.tz";
  if (/^@(yearly|annually|monthly|weekly|daily|midnight|hourly)$/.test(s) || /^@every\s+\S+$/.test(s)) return null;
  const parts = s.split(/\s+/);
  if (parts.length !== 5) return parts.length === 6 ? "cron.seconds" : "cron.fields";
  const ranges = [
    [0, 59],
    [0, 23],
    [1, 31],
    [1, 12],
    [0, 7],
  ];
  for (let i = 0; i < 5; i++) {
    const p = parts[i];
    if (!/^[\d*?,\-/A-Za-z]+$/.test(p)) return "cron.bad";
    for (const n of p.match(/\d+/g) || []) {
      const num = parseInt(n, 10);
      if (p.includes("/" + n) && p.indexOf("/" + n) === p.lastIndexOf("/")) continue;
      if (num < ranges[i][0] || num > ranges[i][1]) return "cron.bad";
    }
  }
  return null;
}

function containersOf(podSpec) {
  return [...seq(get(podSpec, "initContainers")), ...seq(get(podSpec, "containers"))].filter(isMap);
}

function checkPod(ctx, obj, ps) {
  const spec = ps.spec;
  const f = obj.facts;
  const main = seq(get(spec, "containers")).filter(isMap);
  const all = containersOf(spec).concat(seq(get(spec, "ephemeralContainers")).filter(isMap));
  f.images = main.map((c) => str(get(c, "image"))).filter(Boolean);
  f.ports = [];

  const rp = str(get(spec, "restartPolicy"));
  if (WORKLOADS.has(obj.kind) && rp && rp !== "Always") add(ctx, "error", "workload.restartPolicy", get(spec, "restartPolicy"), { kind: obj.kind, value: rp });

  const names = new Map();
  for (const c of all) {
    const nN = get(c, "name");
    const n = str(nN);
    if (!n) continue;
    if (names.has(n)) add(ctx, "error", "container.dupName", nN, { name: n });
    names.set(n, true);
    if (!isPh(n) && !(DNS_LABEL.test(n) && n.length <= 63)) add(ctx, "error", "container.badName", nN, { name: n });
  }

  const volumes = new Map();
  for (const v of seq(get(spec, "volumes"))) {
    const n = str(get(v, "name"));
    if (n) volumes.set(n, { node: get(v, "name"), used: false });
  }

  if (obj.kind === "StatefulSet")
    for (const t of seq(dig(obj.node, "spec", "volumeClaimTemplates"))) {
      const n = str(dig(t, "metadata", "name"));
      if (n) volumes.set(n, { node: null, used: true });
    }

  const portKeys = new Map();
  for (const c of containersOf(spec)) {
    const cname = str(get(c, "name")) || "?";
    const imgN = get(c, "image");
    const img = str(imgN);
    if (!imgN && obj.kind !== "PodTemplate") add(ctx, "error", "container.noImage", keyNode(c, "name") || c, { name: cname });
    else if (img && !isPh(img)) {
      const last = img.split("/").pop();
      if (!img.includes("@")) {
        if (!last.includes(":")) add(ctx, "hint", "image.untagged", imgN, { image: img });
        else if (/:latest$/.test(last)) add(ctx, "hint", "image.latest", imgN, { image: img });
      }
    }
    const portNames = new Set();
    for (const p of seq(get(c, "ports"))) {
      const cpN = get(p, "containerPort");
      const cp = js(cpN);
      const proto = str(get(p, "protocol")) || "TCP";
      const pn = str(get(p, "name"));
      if (pn) {
        portNames.add(pn);
        if (pn.length > 15 || !/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(pn) || !/[a-z]/.test(pn)) add(ctx, "error", "port.badName", get(p, "name"), { name: pn });
      }
      if (typeof cp === "number") {
        if (cp < 1 || cp > 65535) add(ctx, "error", "port.range", cpN, { port: cp });
        const key = `${cp}/${proto}`;
        if (portKeys.has(key)) add(ctx, "warning", "port.dup", cpN, { port: key });
        portKeys.set(key, true);
        if (main.includes(c)) f.ports.push({ port: cp, name: pn, proto });
      }
    }
    const envNames = new Set();
    for (const e of seq(get(c, "env"))) {
      const nN = get(e, "name");
      const n = str(nN);
      if (!n) continue;
      if (envNames.has(n)) add(ctx, "warning", "env.dup", nN, { name: n });
      envNames.add(n);
    }
    for (const vm of seq(get(c, "volumeMounts"))) {
      const nN = get(vm, "name");
      const n = str(nN);
      if (!n || isPh(n)) continue;
      if (volumes.has(n)) volumes.get(n).used = true;
      else add(ctx, "error", "mount.noVolume", nN, { name: n, container: cname });
    }
    for (const vd of seq(get(c, "volumeDevices"))) {
      const n = str(get(vd, "name"));
      if (n && volumes.has(n)) volumes.get(n).used = true;
    }
    checkResources(ctx, c, cname, main.includes(c));
    for (const probe of ["livenessProbe", "readinessProbe", "startupProbe"]) {
      const pr = get(c, probe);
      for (const kind of ["httpGet", "tcpSocket", "grpc"]) {
        const portN = dig(pr, kind, "port");
        if (isScalar(portN) && typeof portN.value === "string" && !isPh(portN.value) && !/^\d+$/.test(portN.value) && !portNames.has(portN.value))
          add(ctx, "warning", "probe.namedPort", portN, { port: portN.value, container: cname });
      }
    }
  }
  for (const [n, v] of volumes) if (!v.used && v.node) add(ctx, "hint", "volume.unused", v.node, { name: n });
}

function checkResources(ctx, c, cname, isMain) {
  const r = get(c, "resources");
  if (!r) {
    if (isMain) add(ctx, "hint", "resources.none", keyNode(c, "name") || keyNode(c, "image") || c, { name: cname });
    return;
  }
  const req = get(r, "requests");
  const lim = get(r, "limits");
  for (const res of ["cpu", "memory"]) {
    for (const [which, mapN] of [
      ["requests", req],
      ["limits", lim],
    ]) {
      const vN = get(mapN, res);
      const v = str(vN);
      if (!v || isPh(v)) continue;
      if (res === "memory" && /^\d+(\.\d+)?m$/.test(v)) replaceScalar(ctx, add(ctx, "warning", "qty.memoryMilli", vN, { value: v, suggest: v.replace(/m$/, "Mi") }), vN, v.replace(/m$/, "Mi"));
      if (res === "cpu" && /[KMGTPE]i$/.test(v)) add(ctx, "warning", "qty.cpuBinary", vN, { value: v });
    }
    const rq = parseQuantity(js(get(req, res)));
    const lm = parseQuantity(js(get(lim, res)));
    if (rq != null && lm != null && rq > lm)
      add(ctx, "error", "resources.reqOverLimit", get(req, res), { res, req: String(js(get(req, res))), lim: String(js(get(lim, res))), name: cname });
  }
}

function checkService(ctx, obj, spec) {
  const f = obj.facts;
  const typeN = get(spec, "type");
  const type = str(typeN) || "ClusterIP";
  f.type = type;
  const ports = seq(get(spec, "ports")).filter(isMap);
  f.ports = ports.map((p) => ({ port: js(get(p, "port")), target: js(get(p, "targetPort")), nodePort: js(get(p, "nodePort")), name: str(get(p, "name")), proto: str(get(p, "protocol")) || "TCP" }));
  if (ports.length > 1) {
    const seen = new Set();
    for (const p of ports) {
      const nN = get(p, "name");
      const n = str(nN);
      if (!n) add(ctx, "error", "service.portName", get(p, "port") || p, {});
      else if (seen.has(n)) add(ctx, "error", "service.dupPortName", nN, { name: n });
      if (n) seen.add(n);
    }
  }
  for (const p of ports) {
    const npN = get(p, "nodePort");
    const np = js(npN);
    if (np == null) continue;
    if (type === "ClusterIP" || type === "ExternalName") add(ctx, "error", "service.nodePortType", npN, { type });
    else if (typeof np === "number" && (np < 30000 || np > 32767)) add(ctx, "warning", "service.nodePortRange", npN, { port: np });
  }
  if (type === "ExternalName" && !get(spec, "externalName")) add(ctx, "error", "service.externalName", typeN, {});
  obj.selector = js(get(spec, "selector"));
  obj.selectorNode = get(spec, "selector");
  obj.portNodes = ports;
}

function labelsMatch(sel, labels) {
  return labels && Object.entries(sel).every(([k, v]) => labels[k] === v);
}

function crossChecks(ctx) {
  const objs = ctx.objects;
  const seen = new Map();
  for (const o of objs) {
    if (!o.kind || !o.name) continue;
    const key = `${o.part}|${groupOf(o.apiVersion || "")}|${o.kind}|${o.namespace || ""}|${o.name}`;
    if (seen.has(key)) {
      ctx.cur = o;
      rootDoc = o.doc;
      add(ctx, "warning", "obj.duplicate", dig(o.node, "metadata", "name") || o.node, { kind: o.kind, name: o.name });
      ctx.cur = null;
    }
    seen.set(key, o);
  }
  const workloads = objs
    .map((o) => {
      rootDoc = o.doc;
      const ps = podSpecOf(o);
      if (!ps || !ps.spec || o.kind === "Job" || o.kind === "CronJob") return null;
      return { o, labels: js(ps.labels) || {}, containers: seq(get(ps.spec, "containers")).filter(isMap).map((c) => js(c)) };
    })
    .filter(Boolean);
  const services = objs.filter((o) => o.kind === "Service" && !o.unchecked);
  for (const s of services) {
    rootDoc = s.doc;
    ctx.cur = s;
    const sel = s.selector;
    if (!sel || typeof sel !== "object" || !Object.keys(sel).length || !workloads.length) {
      ctx.cur = null;
      continue;
    }
    if (Object.values(sel).some((v) => isPh(String(v)))) {
      ctx.cur = null;
      continue;
    }
    const ns = s.namespace || "";
    const matched = workloads.filter((w) => (w.o.namespace || "") === ns && labelsMatch(sel, w.labels));
    if (!matched.length) {
      if (workloads.some((w) => w.o.part === s.part))
        add(ctx, "warning", "service.noMatch", s.selectorNode, { sel: Object.entries(sel).map(([k, v]) => `${k}=${v}`).join(", ") });
    } else {
      for (const w of matched) {
        s.links.push({ rel: "selects", kind: w.o.kind, name: w.o.name, id: w.o.id });
        w.o.links.push({ rel: "exposedBy", kind: "Service", name: s.name, id: s.id });
      }
      const cPorts = matched.flatMap((w) => w.containers.flatMap((c) => (Array.isArray(c && c.ports) ? c.ports : [])));
      for (const pN of s.portNodes) {
        const tN = get(pN, "targetPort") || get(pN, "port");
        const t = js(tN);
        if (t == null || isPh(String(t))) continue;
        if (typeof t === "string" && !/^\d+$/.test(t)) {
          if (!cPorts.some((cp) => cp && cp.name === t)) add(ctx, "warning", "service.targetPortName", tN, { port: t });
        } else if (cPorts.length && !cPorts.some((cp) => cp && String(cp.containerPort) === String(t))) {
          add(ctx, "hint", "service.targetPortNum", tN, { port: String(t), ports: [...new Set(cPorts.map((cp) => cp && cp.containerPort).filter(Boolean))].join(", ") });
        }
      }
    }
    ctx.cur = null;
  }
  for (const ing of objs.filter((o) => o.kind === "Ingress" && !o.unchecked)) {
    rootDoc = ing.doc;
    ctx.cur = ing;
    const spec = get(ing.node, "spec");
    const backends = [];
    const db = dig(spec, "defaultBackend", "service");
    if (db) backends.push(db);
    for (const r of seq(get(spec, "rules"))) for (const p of seq(dig(r, "http", "paths"))) {
      const b = dig(p, "backend", "service");
      if (b) backends.push(b);
    }
    for (const b of backends) {
      const nN = get(b, "name");
      const n = str(nN);
      if (!n || isPh(n)) continue;
      const svc = services.find((s) => s.name === n && (s.namespace || "") === (ing.namespace || ""));
      if (!svc) {
        if (services.some((sv) => sv.part === ing.part)) add(ctx, "warning", "ingress.noService", nN, { name: n });
        continue;
      }
      if (!ing.links.some((l) => l.id === svc.id)) {
        ing.links.push({ rel: "routesTo", kind: "Service", name: n, id: svc.id });
        svc.links.push({ rel: "routedBy", kind: "Ingress", name: ing.name, id: ing.id });
      }
      const num = js(dig(b, "port", "number"));
      const pname = str(dig(b, "port", "name"));
      const sp = svc.facts.ports || [];
      if (num != null && !isPh(String(num)) && !sp.some((p) => p.port === num)) add(ctx, "warning", "ingress.badPort", dig(b, "port", "number"), { name: n, port: num, ports: sp.map((p) => p.port).join(", ") });
      if (pname && !isPh(pname) && !sp.some((p) => p.name === pname)) add(ctx, "warning", "ingress.badPortName", dig(b, "port", "name"), { name: n, port: pname });
    }
    ctx.cur = null;
  }
  for (const h of objs.filter((o) => o.kind === "HorizontalPodAutoscaler" && o.target)) {
    const t = objs.find((o) => o.kind === h.target.kind && o.name === h.target.name && (o.namespace || "") === (h.namespace || ""));
    if (t) {
      h.links.push({ rel: "scales", kind: t.kind, name: t.name, id: t.id });
      t.links.push({ rel: "scaledBy", kind: h.kind, name: h.name, id: h.id });
    }
  }
  for (const o of objs) {
    delete o.node;
    delete o.doc;
    delete o.selectorNode;
    delete o.portNodes;
  }
}
