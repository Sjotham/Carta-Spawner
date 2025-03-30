/**
 * Configures and instantiates REST API clients of various kinds to
 * communicate with a Kubernetes API server.
 * Only one instance per kind is instantiated.
 */

const k8s = require('@kubernetes/client-node');

const clientCache = new Map();
let kubeConfig = null;

/**
 * Load Kubernetes configuration, either in-cluster or from default kubeconfig.
 * Optionally overrides host, CA certificate, or SSL verification.
 */
function loadConfig({ host = null, sslCaCert = null, verifySsl = true } = {}) {
  kubeConfig = new k8s.KubeConfig();
  try {
    kubeConfig.loadFromCluster();
  } catch (err) {
    kubeConfig.loadFromDefault();
  }

  const cluster = kubeConfig.getCurrentCluster();
  if (cluster) {
    if (host) cluster.server = host;
    if (sslCaCert) cluster.caFile = sslCaCert;
    cluster.skipTLSVerify = !verifySsl;
  }
}

/**
 * Return a shared Kubernetes client instance of the specified type.
 * For example, 'CoreV1Api', 'NetworkingV1Api', etc.
 */
function sharedClient(clientType) {
  if (!kubeConfig) {
    throw new Error('Kubernetes config not loaded. Call loadConfig() first.');
  }

  if (!clientCache.has(clientType)) {
    const ClientConstructor = k8s[clientType];
    if (!ClientConstructor) {
      throw new Error(`Invalid Kubernetes client type: ${clientType}`);
    }
    const client = kubeConfig.makeApiClient(ClientConstructor);
    clientCache.set(clientType, client);
  }

  return clientCache.get(clientType);
}

module.exports = {
  loadConfig,
  sharedClient,
};
