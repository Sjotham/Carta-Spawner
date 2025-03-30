// General utility functions for Kubernetes JavaScript client

const crypto = require('crypto');

function generateHashedSlug(slug, limit = 63, hashLength = 6) {
  if (slug.length < (limit - hashLength)) return slug;

  const hash = crypto.createHash('sha256').update(slug).digest('hex');
  return `${slug.slice(0, limit - hashLength - 1)}-${hash.slice(0, hashLength)}`.toLowerCase();
}

function updateK8sModel(target, changes, logger = null, targetName = null, changesName = null) {
  const modelType = target.constructor;
  if (!target.attributeMap) {
    throw new Error(`Target (${modelType.name}) must have an 'attributeMap'.`);
  }

  const changesDict = getK8sModelDict(modelType, changes);

  for (const [key, value] of Object.entries(changesDict)) {
    if (!(key in target.attributeMap)) {
      throw new Error(`Changes object contains '${key}' not modeled by '${modelType.name}'.`);
    }

    if (typeof changes === 'object' && value) {
      if (target[key]) {
        if (logger && changesName) {
          logger.info(`${targetName}.${key} current value: '${target[key]}' is overridden with '${value}', which is the value of ${changesName}.${key}`);
        }
      }
      target[key] = value;
    }
  }
  return target;
}

function getK8sModel(modelType, modelDict) {
  const copy = JSON.parse(JSON.stringify(modelDict));
  if (modelDict instanceof modelType) {
    return modelDict;
  } else if (typeof modelDict === 'object') {
    const mapped = mapDictKeysToModelAttributes(modelType, copy);
    return new modelType(mapped);
  } else {
    throw new Error(`Expected object of type 'object' or '${modelType.name}' but got '${typeof modelDict}'`);
  }
}

function getK8sModelDict(modelType, model) {
  if (model instanceof modelType) {
    return model.toJSON(); // Assuming a `toJSON` method exists
  } else if (typeof model === 'object') {
    return mapDictKeysToModelAttributes(modelType, model);
  } else {
    throw new Error(`Expected object of type '${modelType.name}' or 'object' but got '${typeof model}'`);
  }
}

function mapDictKeysToModelAttributes(modelType, modelDict) {
  const newDict = {};
  for (const key in modelDict) {
    newDict[getK8sModelAttribute(modelType, key)] = modelDict[key];
  }
  return newDict;
}

function getK8sModelAttribute(modelType, fieldName) {
  if (modelType.attributeMap && fieldName in modelType.attributeMap) {
    return fieldName;
  }
  for (const [key, value] of Object.entries(modelType.attributeMap)) {
    if (value === fieldName) return key;
  }
  throw new Error(`'${modelType.name}' did not have an attribute matching '${fieldName}'`);
}

function hostMatching(host, wildcard) {
  if (!wildcard.startsWith('*.')) return host === wildcard;

  const hostParts = host.split('.');
  const wildcardParts = wildcard.split('.');

  return hostParts.slice(1).join('.') === wildcardParts.slice(1).join('.');
}

function recursiveUpdate(target, update) {
  for (const [k, v] of Object.entries(update)) {
    if (v === null) {
      delete target[k];
    } else if (typeof v === 'object' && !Array.isArray(v)) {
      if (!target[k]) target[k] = {};
      recursiveUpdate(target[k], v);
    } else {
      target[k] = v;
    }
  }
}

class IgnoreMissing extends Object {
  constructor(init) {
    super();
    Object.assign(this, init);
  }
  get [Symbol.toStringTag]() {
    return 'IgnoreMissing';
  }
  get(key) {
    return this.hasOwnProperty(key) ? this[key] : `{${key}}`;
  }
}

function recursiveFormat(formatObj, values) {
  if (typeof formatObj === 'string') {
    return formatObj.replace(/{(.*?)}/g, (_, k) => (k in values ? values[k] : `{${k}}`));
  } else if (Array.isArray(formatObj)) {
    return formatObj.map(v => recursiveFormat(v, values));
  } else if (formatObj instanceof Set) {
    return new Set([...formatObj].map(v => recursiveFormat(v, values)));
  } else if (typeof formatObj === 'object') {
    const result = {};
    for (const [k, v] of Object.entries(formatObj)) {
      result[recursiveFormat(k, values)] = recursiveFormat(v, values);
    }
    return result;
  } else {
    return formatObj;
  }
}

module.exports = {
  generateHashedSlug,
  updateK8sModel,
  getK8sModel,
  getK8sModelDict,
  mapDictKeysToModelAttributes,
  getK8sModelAttribute,
  hostMatching,
  recursiveUpdate,
  recursiveFormat
};
