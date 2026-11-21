export default [
  ["clean deployment + service", `apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
spec:
  replicas: 2
  selector:
    matchLabels: {app: web}
  template:
    metadata:
      labels: {app: web}
    spec:
      containers:
        - name: web
          image: nginx:1.27
          ports: [{containerPort: 80, name: http}]
          resources:
            requests: {cpu: 100m, memory: 128Mi}
            limits: {cpu: 500m, memory: 256Mi}
---
apiVersion: v1
kind: Service
metadata:
  name: web
spec:
  selector: {app: web}
  ports:
    - port: 80
      targetPort: http`, []],
  ["typos and types", `apiVersion: apps/v1
kind: Deployment
metadata:
  name: Web_App
  labels:
    version: 1.0
spec:
  replica: 3
  selector:
    matchLabels: {app: web}
  template:
    metadata:
      labels: {app: webapp}
    spec:
      containers:
        - name: web
          image: nginx
          imagePullPolicy: always
          env:
            - name: DEBUG
              value: yes
            - name: PORT
              value: 8080
          resources:
            requests: {memory: 512mb, cpu: "2"}
            limits: {cpu: 1}`, ["meta.badName.subdomain@4", "type.quote@6", "field.typo@8", "workload.selector@10", "image.untagged@17", "enum.typo@18", "type.quote@21", "type.quote@23", "qty.fix@25", "resources.reqOverLimit@25"]],
  ["removed api", `apiVersion: extensions/v1beta1
kind: Ingress
metadata: {name: x}`, ["api.removed@1"]],
  ["wrong version", `apiVersion: v1
kind: Deployment
metadata: {name: x}`, ["api.wrongVersion@1"]],
  ["kind typo", `apiVersion: apps/v1
kind: Deploymnet
metadata: {name: x}`, ["kind.typo@2"]],
  ["job restart + cron", `apiVersion: batch/v1
kind: CronJob
metadata: {name: backup}
spec:
  schedule: "0 0 3 * * *"
  jobTemplate:
    spec:
      template:
        spec:
          containers:
            - name: b
              image: busybox:1.36
              resources: {}`, ["cron.seconds@5", "job.restartPolicy@10"]],
  ["service checks", `apiVersion: v1
kind: Service
metadata: {name: api}
spec:
  type: ClusterIP
  selector: {app: api}
  ports:
    - port: 80
      nodePort: 30080
    - port: 443
---
apiVersion: apps/v1
kind: Deployment
metadata: {name: other}
spec:
  selector: {matchLabels: {app: other}}
  template:
    metadata: {labels: {app: other}}
    spec:
      containers: [{name: o, image: "o:1", resources: {}}]`, ["service.portName@8", "service.nodePortType@9", "service.portName@10", "service.noMatch@6"]],
  ["mounts, secret, yaml dup", `apiVersion: v1
kind: Pod
metadata: {name: p}
spec:
  volumes:
    - name: data
      emptyDir: {}
  containers:
    - name: c
      image: busybox:1.36
      resources: {}
      volumeMounts:
        - name: config
          mountPath: /etc/x
---
apiVersion: v1
kind: Secret
metadata: {name: s}
data:
  password: hunter2!`, ["mount.noVolume@13", "volume.unused@6", "secret.base64@20"]],
  ["duplicate key + tab", "a: 1\na: 2", ["yaml.DUPLICATE_KEY@2"]],
  ["heredoc", `cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: ConfigMap
metadata: {name: c}
data:
  port: 8080
EOF`, ["type.quote@6"]],
  ["placeholders", `apiVersion: <versiyon>
kind: <tür>
metadata: {name: <isim>}`, []],
  ["helm skipped", `replicas: {{ .Values.replicas }}`, []],
  ["fragment", `spec:\n  replicas: 3`, []],
  ["memory milli", `apiVersion: v1
kind: Pod
metadata: {name: p}
spec:
  containers:
    - name: c
      image: a:1
      resources: {limits: {memory: 512m}}`, ["qty.memoryMilli@8"]],
  ["metallb crd", `apiVersion: metallb.io/v1beta1
kind: IPAddressPool
metadata: {name: pool, namespace: metallb-system}
spec:
  adresses: [10.0.0.1-10.0.0.9]`, ["field.typo@5"]],
  ["ingress to service", `apiVersion: networking.k8s.io/v1
kind: Ingress
metadata: {name: i}
spec:
  rules:
    - host: a.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend: {service: {name: web, port: {number: 8080}}}
---
apiVersion: v1
kind: Service
metadata: {name: web}
spec:
  ports: [{port: 80}]`, ["ingress.badPort@11"]],
];
