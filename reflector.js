// JavaScript conversion of Python ResourceReflector using threadsafe concurrency and Kubernetes client
// Note: This requires a Node.js environment with k8s client setup and support for async/await

const { KubeConfig, Watch } = require('@kubernetes/client-node');
const EventEmitter = require('events');
const crypto = require('crypto');

class ResourceReflector extends EventEmitter {
  constructor({
    kind,
    namespace = null,
    labels = {},
    fields = {},
    omitNamespace = false,
    listMethodName = '',
    apiGroupName = 'CoreV1Api',
    requestTimeout = 60000,
    timeoutSeconds = 10,
    restartSeconds = 30,
    onFailure = null,
    logger = console
  }) {
    super();
    this.kind = kind;
    this.namespace = namespace;
    this.labels = labels;
    this.fields = fields;
    this.omitNamespace = omitNamespace;
    this.listMethodName = listMethodName;
    this.apiGroupName = apiGroupName;
    this.requestTimeout = requestTimeout;
    this.timeoutSeconds = timeoutSeconds;
    this.restartSeconds = restartSeconds;
    this.onFailure = onFailure;
    this.logger = logger;
    this.resources = new Map();
    this._stopping = false;
    this.watch = new Watch(new KubeConfig());
    this.firstLoadComplete = false;
    this.watchTask = null;
  }

  _labelSelector() {
    return Object.entries(this.labels).map(([k, v]) => `${k}=${v}`).join(',');
  }

  _fieldSelector() {
    return Object.entries(this.fields).map(([k, v]) => `${k}=${v}`).join(',');
  }

  async listAndUpdate(resourceVersion = null) {
    const listFn = this.api[this.listMethodName].bind(this.api);
    const opts = {
      labelSelector: this._labelSelector(),
      fieldSelector: this._fieldSelector(),
      timeout: this.requestTimeout
    };
    if (resourceVersion) {
      opts.resourceVersion = resourceVersion;
      opts.resourceVersionMatch = 'NotOlderThan';
    }
    if (!this.omitNamespace && this.namespace) {
      opts.namespace = this.namespace;
    }

    try {
      const res = await listFn(opts);
      const items = res.body.items;
      this.resources.clear();
      for (const item of items) {
        const key = `${item.metadata.namespace}/${item.metadata.name}`;
        this.resources.set(key, item);
      }
      this.firstLoadComplete = true;
      return res.body.metadata.resourceVersion;
    } catch (err) {
      this.logger.error(`Error listing ${this.kind}:`, err);
      if (!this.firstLoadComplete && this.onFailure) this.onFailure(err);
      throw err;
    }
  }

  async watchAndUpdate() {
    let resourceVersion = '0';
    let delay = 100;

    const opts = {
      labelSelector: this._labelSelector(),
      fieldSelector: this._fieldSelector(),
      timeoutSeconds: this.timeoutSeconds
    };
    if (!this.omitNamespace && this.namespace) {
      opts.namespace = this.namespace;
    }

    while (!this._stopping) {
      try {
        resourceVersion = await this.listAndUpdate(resourceVersion);
        opts.resourceVersion = resourceVersion;

        await this.watch.watch(
          `/api/v1/${this.omitNamespace ? '' : `namespaces/${this.namespace}/`}${this.kind.toLowerCase()}`,
          opts,
          (type, obj) => {
            const key = `${obj.metadata.namespace}/${obj.metadata.name}`;
            if (type === 'DELETED') {
              this.resources.delete(key);
            } else {
              this.resources.set(key, obj);
            }
            resourceVersion = obj.metadata.resourceVersion;
          },
          err => {
            if (err) throw err;
          }
        );

        delay = 100;
        if (this._stopping) break;
      } catch (err) {
        this.logger.warn(`Watch error for ${this.kind}, retrying in ${delay}ms`, err);
        if ((delay *= 2) > 30000) {
          this.logger.error(`${this.kind} watch failed permanently`);
          if (this.onFailure) this.onFailure(err);
          break;
        }
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }

  async start() {
    if (this.watchTask) throw new Error(`Watcher for ${this.kind} already running`);
    await this.listAndUpdate();
    this.watchTask = this.watchAndUpdate();
  }

  async stop() {
    this._stopping = true;
    if (this.watchTask) {
      try {
        await this.watch.abort();
      } catch (err) {
        this.logger.warn(`Error stopping watch for ${this.kind}:`, err);
      }
    }
  }
}

class NamespacedResourceReflector extends ResourceReflector {
  constructor(options) {
    super({ ...options, omitNamespace: false });
  }
}

class MultiNamespaceResourceReflector extends ResourceReflector {
  constructor(options) {
    super({ ...options, omitNamespace: true });
  }
}

module.exports = {
  ResourceReflector,
  NamespacedResourceReflector,
  MultiNamespaceResourceReflector
};
