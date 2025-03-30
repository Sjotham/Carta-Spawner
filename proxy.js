
// KubeIngressProxy implementation, a full-feature parity rewrite in JavaScript
// (especially async + Kubernetes client behavior) would be long and platform-specific.
// Here's a simplified and idiomatic JavaScript version of a similar module using
// kubernetes-client (JavaScript client) and expressing structure in JS classes.

const k8s = require('@kubernetes/client-node');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

class KubeIngressProxy {
  constructor(config = {}) {
    const kc = new k8s.KubeConfig();

    if (config.k8sApiHost) {
      kc.loadFromOptions({
        clusters: [{ name: 'cluster', server: config.k8sApiHost }],
        users: [{ name: 'user' }],
        contexts: [{ name: 'context', user: 'user', cluster: 'cluster' }],
        currentContext: 'context'
      });
    } else {
      kc.loadFromDefault();
    }

    this.k8sApi = kc.makeApiClient(k8s.CoreV1Api);
    this.networkingApi = kc.makeApiClient(k8s.NetworkingV1Api);

    this.namespace = config.namespace || this._defaultNamespace();
  }

  _defaultNamespace() {
    const nsPath = '/var/run/secrets/kubernetes.io/serviceaccount/namespace';
    if (fs.existsSync(nsPath)) {
      return fs.readFileSync(nsPath, 'utf8').trim();
    }
    return 'default';
  }

  _safeNameForRoutespec(routespec) {
    const hash = crypto.createHash('sha256').update(routespec).digest('hex').substr(0, 8);
    return `jupyter-${routespec.replace(/[^a-z0-9]/gi, '-').toLowerCase()}-${hash}`;
  }

  async addRoute(routespec, target, data = {}) {
    const name = this._safeNameForRoutespec(routespec);

    const metadata = {
      name,
      namespace: this.namespace,
      annotations: {
        'hub.jupyter.org/proxy-routespec': routespec,
        'hub.jupyter.org/proxy-target': target,
        'hub.jupyter.org/proxy-data': JSON.stringify(data)
      },
      labels: {
        'app': 'jupyterhub',
        'component': 'singleuser-server'
      }
    };

    const ingressSpec = {
      metadata,
      spec: {
        rules: [
          {
            http: {
              paths: [
                {
                  path: `/${name}`,
                  pathType: 'Prefix',
                  backend: {
                    service: {
                      name,
                      port: { number: 80 }
                    }
                  }
                }
              ]
            }
          }
        ]
      }
    };

    try {
      await this.networkingApi.createNamespacedIngress(this.namespace, ingressSpec);
      console.log(`Created ingress for ${routespec}`);
    } catch (e) {
      if (e.response && e.response.statusCode === 409) {
        await this.networkingApi.replaceNamespacedIngress(name, this.namespace, ingressSpec);
        console.log(`Updated existing ingress for ${routespec}`);
      } else {
        throw e;
      }
    }
  }

  async deleteRoute(routespec) {
    const name = this._safeNameForRoutespec(routespec);
    try {
      await this.networkingApi.deleteNamespacedIngress(name, this.namespace);
      console.log(`Deleted ingress for ${routespec}`);
    } catch (e) {
      if (e.response && e.response.statusCode === 404) {
        console.warn(`Ingress ${name} not found`);
      } else {
        throw e;
      }
    }
  }

  async getAllRoutes() {
    const res = await this.networkingApi.listNamespacedIngress(this.namespace);
    const routes = {};
    for (const ingress of res.body.items) {
      const meta = ingress.metadata;
      if (meta.annotations && meta.annotations['hub.jupyter.org/proxy-routespec']) {
        const routespec = meta.annotations['hub.jupyter.org/proxy-routespec'];
        routes[routespec] = {
          routespec,
          target: meta.annotations['hub.jupyter.org/proxy-target'],
          data: JSON.parse(meta.annotations['hub.jupyter.org/proxy-data'] || '{}')
        };
      }
    }
    return routes;
  }
}

module.exports = KubeIngressProxy;
