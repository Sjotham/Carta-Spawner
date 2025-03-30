// Full JavaScript conversion of Kubernetes object creators using @kubernetes/client-node

const fs = require('fs');
const k8s = require('@kubernetes/client-node');
const path = require('path');
const { Buffer } = require('buffer');
const { URL } = require('url');

const SERVICE_DNS_PATTERN = /(?<service>[^.]+)\.?(?<namespace>[^.]+)?(?<rest>\.svc(\.cluster(\.local)?)?)?/;

function makeNamespace(name, labels = {}, annotations = {}) {
  return {
    apiVersion: 'v1',
    kind: 'Namespace',
    metadata: {
      name,
      labels: { ...labels },
      annotations: { ...annotations },
    },
  };
}

function makeService(name, port, selector, ownerReferences = [], labels = {}, annotations = {}) {
  return {
    apiVersion: 'v1',
    kind: 'Service',
    metadata: {
      name,
      annotations: { ...annotations },
      labels: { ...labels },
      ownerReferences,
    },
    spec: {
      type: 'ClusterIP',
      ports: [
        {
          name: 'http',
          port,
          targetPort: port,
        },
      ],
      selector,
    },
  };
}

function makeOwnerReference(name, uid) {
  return {
    apiVersion: 'v1',
    kind: 'Pod',
    name,
    uid,
    blockOwnerDeletion: true,
    controller: false,
  };
}

function makeSecret(name, username, certPaths, hubCaPath, ownerReferences, labels = {}, annotations = {}) {
  const readAndEncode = (filepath) => {
    return fs.readFileSync(filepath, 'utf8');
  };

  const sslKey = readAndEncode(certPaths.keyfile);
  const sslCrt = readAndEncode(certPaths.certfile);
  const caBundle = readAndEncode(certPaths.cafile) + '\n' + readAndEncode(hubCaPath);

  return {
    apiVersion: 'v1',
    kind: 'Secret',
    metadata: {
      name,
      labels: { ...labels },
      annotations: { ...annotations },
      ownerReferences,
    },
    data: {
      'ssl.key': Buffer.from(sslKey).toString('base64'),
      'ssl.crt': Buffer.from(sslCrt).toString('base64'),
      'notebooks-ca_trust.crt': Buffer.from(caBundle).toString('base64'),
    },
  };
}

function makePVC(name, storageClass, accessModes, selector, storage, labels = {}, annotations = {}) {
  return {
    apiVersion: 'v1',
    kind: 'PersistentVolumeClaim',
    metadata: {
      name,
      labels: { ...labels },
      annotations: {
        ...annotations,
        ...(storageClass ? { 'volume.beta.kubernetes.io/storage-class': storageClass } : {}),
      },
    },
    spec: {
      accessModes,
      resources: {
        requests: {
          storage,
        },
      },
      ...(storageClass ? { storageClassName: storageClass } : {}),
      ...(selector ? { selector } : {}),
    },
  };
}

function makePod(name, image, cmd, port, env = {}, labels = {}, annotations = {}, volumeMounts = [], volumes = [], serviceAccount = null) {
  return {
    apiVersion: 'v1',
    kind: 'Pod',
    metadata: {
      name,
      labels: { ...labels },
      annotations: { ...annotations },
    },
    spec: {
      containers: [
        {
          name: 'notebook',
          image,
          args: cmd,
          ports: [
            {
              name: 'notebook-port',
              containerPort: port,
            },
          ],
          env: Object.entries(env).map(([name, value]) => ({ name, value })),
          volumeMounts,
        },
      ],
      volumes,
      restartPolicy: 'OnFailure',
      ...(serviceAccount && { serviceAccountName: serviceAccount }),
    },
  };
}

function _getEnvVarDeps(envVar) {
  if (!envVar.value) return new Set();
  const pattern = /\$\(([^)]+)\)/g;
  const matches = [...envVar.value.matchAll(pattern)].map((m) => m[1]);
  return new Set(matches.filter((dep) => dep !== envVar.name));
}

function makeIngress(name, routespec, target, data, namespace, labels = {}, annotations = {}, ingressClassName = '', ingressSpecifications = [], reuseExistingServices = false) {
  const url = new URL(routespec);
  const host = url.hostname;
  const path = url.pathname;
  const targetUrl = new URL(target);
  const port = targetUrl.port ? parseInt(targetUrl.port) : 80;

  const defaultAnnotations = {
    'hub.jupyter.org/proxy-data': JSON.stringify(data),
    'hub.jupyter.org/proxy-routespec': routespec,
    'hub.jupyter.org/proxy-target': target,
  };

  const serviceMatch = SERVICE_DNS_PATTERN.exec(targetUrl.hostname);
  let serviceName = name;

  if (reuseExistingServices && serviceMatch && (!serviceMatch.groups.namespace || serviceMatch.groups.namespace === namespace)) {
    serviceName = serviceMatch.groups.service;
  }

  const ingressRules = [
    {
      host,
      http: {
        paths: [
          {
            path,
            pathType: 'Prefix',
            backend: {
              service: {
                name: serviceName,
                port: { number: port },
              },
            },
          },
        ],
      },
    },
  ];

  const tls = ingressSpecifications
    .filter((spec) => spec.tlsSecret && spec.host)
    .map((spec) => ({ hosts: [spec.host], secretName: spec.tlsSecret }));

  return {
    apiVersion: 'networking.k8s.io/v1',
    kind: 'Ingress',
    metadata: {
      name,
      labels: { ...labels },
      annotations: { ...defaultAnnotations, ...annotations },
    },
    spec: {
      ingressClassName: ingressClassName || undefined,
      rules: ingressRules,
      ...(tls.length > 0 ? { tls } : {}),
    },
  };
}

module.exports = {
  makeNamespace,
  makeService,
  makeOwnerReference,
  makeSecret,
  makePVC,
  makePod,
  makeIngress,
  _getEnvVarDeps,
};
