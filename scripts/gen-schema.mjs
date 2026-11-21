import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseAllDocuments } from "yaml";

const K8S = "v1.37.2";
const GATEWAY = "v1.7.0";
const METALLB = "v0.16.2";
const CERT_MANAGER = "v1.21.3";
const PROMETHEUS_OPERATOR = "v0.95.2";
const ARGOCD = "v3.6.2";

const CACHE = process.env.SCHEMA_CACHE || join(tmpdir(), "ecu-kube-schema-src");
mkdirSync(join(CACHE, "v3"), { recursive: true });

async function fetchCached(url, file) {
  const path = join(CACHE, file);
  if (!existsSync(path)) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    writeFileSync(path, Buffer.from(await res.arrayBuffer()));
  }
  return readFileSync(path, "utf8");
}

const ENUMS = {
  "io.k8s.api.core.v1.ServiceSpec.type": ["ClusterIP", "NodePort", "LoadBalancer", "ExternalName"],
  "io.k8s.api.core.v1.ServiceSpec.externalTrafficPolicy": ["Cluster", "Local"],
  "io.k8s.api.core.v1.ServiceSpec.internalTrafficPolicy": ["Cluster", "Local"],
  "io.k8s.api.core.v1.ServiceSpec.sessionAffinity": ["ClientIP", "None"],
  "io.k8s.api.core.v1.ServiceSpec.ipFamilyPolicy": ["SingleStack", "PreferDualStack", "RequireDualStack"],
  "io.k8s.api.core.v1.ServicePort.protocol": ["TCP", "UDP", "SCTP"],
  "io.k8s.api.core.v1.ContainerPort.protocol": ["TCP", "UDP", "SCTP"],
  "io.k8s.api.core.v1.Container.imagePullPolicy": ["Always", "IfNotPresent", "Never"],
  "io.k8s.api.core.v1.Container.terminationMessagePolicy": ["File", "FallbackToLogsOnError"],
  "io.k8s.api.core.v1.Container.restartPolicy": ["Always"],
  "io.k8s.api.core.v1.PodSpec.restartPolicy": ["Always", "OnFailure", "Never"],
  "io.k8s.api.core.v1.PodSpec.dnsPolicy": ["ClusterFirst", "ClusterFirstWithHostNet", "Default", "None"],
  "io.k8s.api.core.v1.PodSpec.preemptionPolicy": ["PreemptLowerPriority", "Never"],
  "io.k8s.api.core.v1.Toleration.operator": ["Exists", "Equal"],
  "io.k8s.api.core.v1.Toleration.effect": ["NoSchedule", "PreferNoSchedule", "NoExecute"],
  "io.k8s.api.core.v1.Taint.effect": ["NoSchedule", "PreferNoSchedule", "NoExecute"],
  "io.k8s.api.core.v1.NodeSelectorRequirement.operator": ["In", "NotIn", "Exists", "DoesNotExist", "Gt", "Lt"],
  "io.k8s.apimachinery.pkg.apis.meta.v1.LabelSelectorRequirement.operator": ["In", "NotIn", "Exists", "DoesNotExist"],
  "io.k8s.api.core.v1.PersistentVolumeSpec.persistentVolumeReclaimPolicy": ["Retain", "Delete", "Recycle"],
  "io.k8s.api.core.v1.PersistentVolumeSpec.volumeMode": ["Filesystem", "Block"],
  "io.k8s.api.core.v1.PersistentVolumeClaimSpec.volumeMode": ["Filesystem", "Block"],
  "io.k8s.api.core.v1.PersistentVolumeSpec.accessModes[]": ["ReadWriteOnce", "ReadOnlyMany", "ReadWriteMany", "ReadWriteOncePod"],
  "io.k8s.api.core.v1.PersistentVolumeClaimSpec.accessModes[]": ["ReadWriteOnce", "ReadOnlyMany", "ReadWriteMany", "ReadWriteOncePod"],
  "io.k8s.api.core.v1.HostPathVolumeSource.type": ["", "DirectoryOrCreate", "Directory", "FileOrCreate", "File", "Socket", "CharDevice", "BlockDevice"],
  "io.k8s.api.core.v1.Capabilities.add[]": null,
  "io.k8s.api.apps.v1.DeploymentStrategy.type": ["RollingUpdate", "Recreate"],
  "io.k8s.api.apps.v1.StatefulSetUpdateStrategy.type": ["RollingUpdate", "OnDelete"],
  "io.k8s.api.apps.v1.DaemonSetUpdateStrategy.type": ["RollingUpdate", "OnDelete"],
  "io.k8s.api.apps.v1.StatefulSetSpec.podManagementPolicy": ["OrderedReady", "Parallel"],
  "io.k8s.api.batch.v1.CronJobSpec.concurrencyPolicy": ["Allow", "Forbid", "Replace"],
  "io.k8s.api.batch.v1.JobSpec.completionMode": ["NonIndexed", "Indexed"],
  "io.k8s.api.networking.v1.HTTPIngressPath.pathType": ["Exact", "Prefix", "ImplementationSpecific"],
  "io.k8s.api.networking.v1.NetworkPolicySpec.policyTypes[]": ["Ingress", "Egress"],
  "io.k8s.api.networking.v1.NetworkPolicyPort.protocol": ["TCP", "UDP", "SCTP"],
  "io.k8s.api.storage.v1.StorageClass.reclaimPolicy": ["Retain", "Delete"],
  "io.k8s.api.storage.v1.StorageClass.volumeBindingMode": ["Immediate", "WaitForFirstConsumer"],
  "io.k8s.api.autoscaling.v2.MetricSpec.type": ["ContainerResource", "External", "Object", "Pods", "Resource"],
  "io.k8s.api.autoscaling.v2.MetricTarget.type": ["AverageValue", "Utilization", "Value"],
  "io.k8s.api.rbac.v1.Subject.kind": ["User", "Group", "ServiceAccount"],
};

const SPECIAL = {
  "io.k8s.apimachinery.pkg.api.resource.Quantity": "q",
  "io.k8s.apimachinery.pkg.util.intstr.IntOrString": "is",
  "io.k8s.apimachinery.pkg.apis.meta.v1.Time": "s",
  "io.k8s.apimachinery.pkg.apis.meta.v1.MicroTime": "s",
  "io.k8s.apimachinery.pkg.runtime.RawExtension": "x",
  "io.k8s.apimachinery.pkg.apis.meta.v1.FieldsV1": "x",
  "io.k8s.apiextensions-apiserver.pkg.apis.apiextensions.v1.JSON": "x",
};

const nodes = [];
const byKey = new Map();

function intern(node) {
  const key = JSON.stringify(node);
  if (byKey.has(key)) return byKey.get(key);
  nodes.push(node);
  byKey.set(key, nodes.length - 1);
  return nodes.length - 1;
}

function prim(s) {
  if (s["x-kubernetes-int-or-string"]) return "is";
  switch (s.type) {
    case "string":
      return "s";
    case "integer":
      return "i";
    case "number":
      return "n";
    case "boolean":
      return "b";
  }
  return null;
}

function withEnum(base, e) {
  if (!e || !e.length) return base;
  return intern({ t: base, e });
}

const defs = {};
const defIndex = new Map();

function refName(s) {
  if (s.$ref) return s.$ref.split("/").pop();
  if (Array.isArray(s.allOf) && s.allOf.length === 1 && s.allOf[0].$ref) return s.allOf[0].$ref.split("/").pop();
  return null;
}

function convK8s(s, enumKey) {
  const r = refName(s);
  if (r) return convDef(r);
  const p = prim(s);
  if (p) return withEnum(p, s.enum || (enumKey && ENUMS[enumKey]));
  if (s.type === "array") return intern({ t: "a", i: convK8s(s.items || {}, enumKey ? enumKey + "[]" : null) });
  if (s.type === "object" || s.properties || s.additionalProperties) {
    if (s.properties) return objNode(s, null);
    if (s.additionalProperties && typeof s.additionalProperties === "object") return intern({ t: "m", i: convK8s(s.additionalProperties) });
    return "x";
  }
  return "x";
}

function objNode(s, name) {
  const p = {};
  for (const [k, v] of Object.entries(s.properties || {})) p[k] = convK8s(v, name ? `${name}.${k}` : null);
  const n = { t: "o", p };
  if (s.required && s.required.length) n.r = [...s.required].sort();
  if (s["x-kubernetes-preserve-unknown-fields"]) n.u = 1;
  return n;
}

function convDef(name) {
  if (SPECIAL[name]) return SPECIAL[name];
  if (defIndex.has(name)) return defIndex.get(name);
  const s = defs[name];
  if (!s) return "x";
  if (!s.properties) {
    if (s.type === "object" && s.additionalProperties) {
      const idx = nodes.push(null) - 1;
      defIndex.set(name, idx);
      nodes[idx] = { t: "m", i: convK8s(s.additionalProperties) };
      return idx;
    }
    const p = prim(s);
    return p ? withEnum(p, s.enum) : "x";
  }
  const idx = nodes.push(null) - 1;
  defIndex.set(name, idx);
  nodes[idx] = objNode(s, name);
  return idx;
}

function convCrd(s) {
  if (!s || typeof s !== "object") return "x";
  if (s["x-kubernetes-int-or-string"]) return "is";
  const p = prim(s);
  if (p) return withEnum(p, s.enum);
  if (s.type === "array") return intern({ t: "a", i: convCrd(s.items || {}) });
  if (s.properties) {
    const props = {};
    for (const [k, v] of Object.entries(s.properties)) props[k] = convCrd(v);
    const n = { t: "o", p: props };
    if (s.required && s.required.length) n.r = [...s.required].sort();
    if (s["x-kubernetes-preserve-unknown-fields"]) n.u = 1;
    return intern(n);
  }
  if (s.additionalProperties && typeof s.additionalProperties === "object") return intern({ t: "m", i: convCrd(s.additionalProperties) });
  return "x";
}

const kinds = {};
function addKind(apiVersion, kind, ref, namespaced) {
  (kinds[apiVersion] ||= {})[kind] = namespaced ? ref : [ref];
}

const list = JSON.parse(
  await fetchCached(`https://api.github.com/repos/kubernetes/kubernetes/contents/api/openapi-spec/v3?ref=${K8S}`, "v3/_list.json")
)
  .map((f) => f.name)
  .filter((n) => /^(api__v1|apis__.+__v\d+)_openapi\.json$/.test(n));

const specs = [];
for (const f of list) {
  const spec = JSON.parse(await fetchCached(`https://raw.githubusercontent.com/kubernetes/kubernetes/${K8S}/api/openapi-spec/v3/${f}`, `v3/${f}`));
  Object.assign(defs, spec.components.schemas);
  specs.push(spec);
}

for (const spec of specs) {
  const namespacedKinds = new Set();
  const servedKinds = new Set();
  for (const [path, item] of Object.entries(spec.paths || {})) {
    for (const op of Object.values(item)) {
      const g = op && op["x-kubernetes-group-version-kind"];
      if (!g) continue;
      servedKinds.add(`${g.group}/${g.version}/${g.kind}`);
      if (path.includes("/namespaces/{namespace}/")) namespacedKinds.add(`${g.group}/${g.version}/${g.kind}`);
    }
  }
  for (const [name, s] of Object.entries(spec.components.schemas)) {
    const gvks = s["x-kubernetes-group-version-kind"];
    if (!gvks || name.startsWith("io.k8s.apimachinery.")) continue;
    for (const g of gvks) {
      if (g.kind.endsWith("List") || /alpha|beta/.test(g.version)) continue;
      if (!s.properties || !s.properties.metadata) continue;
      if (!servedKinds.has(`${g.group}/${g.version}/${g.kind}`)) continue;
      const apiVersion = g.group ? `${g.group}/${g.version}` : g.version;
      addKind(apiVersion, g.kind, convDef(name), namespacedKinds.has(`${g.group}/${g.version}/${g.kind}`));
    }
  }
}

const crdSources = [
  [`https://github.com/kubernetes-sigs/gateway-api/releases/download/${GATEWAY}/standard-install.yaml`, "gateway.yaml"],
  [`https://raw.githubusercontent.com/metallb/metallb/${METALLB}/config/manifests/metallb-native.yaml`, "metallb.yaml"],
  [`https://github.com/cert-manager/cert-manager/releases/download/${CERT_MANAGER}/cert-manager.crds.yaml`, "cert-manager.yaml"],
  [`https://github.com/prometheus-operator/prometheus-operator/releases/download/${PROMETHEUS_OPERATOR}/stripped-down-crds.yaml`, "prometheus-operator.yaml"],
  ...["application", "applicationset", "appproject"].map((n) => [`https://raw.githubusercontent.com/argoproj/argo-cd/${ARGOCD}/manifests/crds/${n}-crd.yaml`, `argocd-${n}.yaml`]),
];
for (const [url, file] of crdSources) {
  for (const doc of parseAllDocuments(await fetchCached(url, file))) {
    const o = doc.toJS();
    if (!o || o.kind !== "CustomResourceDefinition") continue;
    const { group, names, scope } = o.spec;
    for (const v of o.spec.versions || []) {
      if (!v.served || !v.schema) continue;
      addKind(`${group}/${v.name}`, names.kind, convCrd(v.schema.openAPIV3Schema), scope === "Namespaced");
    }
  }
}

for (const [k, v] of Object.entries(ENUMS)) if (v && !k.includes("[]") && !defs[k.slice(0, k.lastIndexOf("."))]) console.warn("unknown enum def", k);

const out = { k8s: K8S.replace(/^v/, "").replace(/\.\d+$/, ""), gateway: GATEWAY, metallb: METALLB, certManager: CERT_MANAGER, prometheusOperator: PROMETHEUS_OPERATOR, argocd: ARGOCD, kinds, n: nodes };
writeFileSync("src/schema.json", JSON.stringify(out));
const kindCount = Object.values(kinds).reduce((a, m) => a + Object.keys(m).length, 0);
console.log(`kinds: ${kindCount}, nodes: ${nodes.length}, bytes: ${JSON.stringify(out).length}`);
