// Tools for generating slugs like K8s object names and labels
// Requirements:
// - always valid for arbitrary strings
// - no collisions

const crypto = require('crypto');

const _hashLength = 8;
const _objectPattern = /^[a-z0-9\-]+$/;
const _labelPattern = /^[a-z0-9.\-_]+$/i;
const _nonAlphanumPattern = /[^a-z0-9]+/g;

const _alphaLower = 'abcdefghijklmnopqrstuvwxyz';
const _alphanumLower = _alphaLower + '0123456789';
const _alphanum = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

function isValidGeneral(s, {
  startsWith = null,
  endsWith = null,
  pattern = null,
  minLength = null,
  maxLength = null
} = {}) {
  if (minLength !== null && s.length < minLength) return false;
  if (maxLength !== null && s.length > maxLength) return false;
  if (startsWith && !startsWith.includes(s[0])) return false;
  if (endsWith && !endsWith.includes(s[s.length - 1])) return false;
  if (pattern && !pattern.test(s)) return false;
  return true;
}

function isValidObjectName(s) {
  return isValidGeneral(s, {
    startsWith: _alphaLower,
    endsWith: _alphanumLower,
    pattern: _objectPattern,
    minLength: 1,
    maxLength: 63
  });
}

function isValidLabel(s) {
  if (!s) return true;
  return isValidGeneral(s, {
    startsWith: _alphanum,
    endsWith: _alphanum,
    pattern: _labelPattern,
    maxLength: 63
  });
}

function isValidDefault(s) {
  return isValidObjectName(s);
}

function _extractSafeName(name, maxLength) {
  let safeName = name.toLowerCase().replace(_nonAlphanumPattern, '-');
  safeName = safeName.replace(/^-+/, '').slice(0, maxLength).replace(/-+$/, '');

  if (safeName && !_alphaLower.includes(safeName[0])) {
    safeName = `x-${safeName.slice(0, maxLength - 2)}`;
  }

  if (!safeName) {
    safeName = 'x';
  }

  return safeName;
}

function stripAndHash(name, maxLength = 32) {
  const nameLength = maxLength - (_hashLength + 3);
  if (nameLength < 1) {
    throw new Error(`Cannot make safe names shorter than ${_hashLength + 4}`);
  }

  const hash = crypto.createHash('sha256').update(name, 'utf8').digest('hex').slice(0, _hashLength);
  const safeName = _extractSafeName(name, nameLength);
  return `${safeName}---${hash}`;
}

function safeSlug(name, isValid = isValidDefault, maxLength = null) {
  if (name.includes('--')) {
    return stripAndHash(name, maxLength || 32);
  }
  if (isValid(name) && (maxLength === null || name.length <= maxLength)) {
    return name;
  } else {
    return stripAndHash(name, maxLength || 32);
  }
}

function multiSlug(names, maxLength = 48) {
  const hasher = crypto.createHash('sha256');
  hasher.update(names[0], 'utf8');
  for (let i = 1; i < names.length; i++) {
    hasher.update(Buffer.from([0xFF]));
    hasher.update(names[i], 'utf8');
  }
  const hash = hasher.digest('hex').slice(0, _hashLength);

  const availableChars = maxLength - (_hashLength + 3);
  const perName = Math.floor(availableChars / names.length);
  const nameMaxLength = perName - 2;

  if (nameMaxLength < 2) {
    throw new Error(`Not enough characters for ${names.length} names: ${maxLength}`);
  }

  const nameSlugs = names.map(name => _extractSafeName(name, nameMaxLength));
  return `${nameSlugs.join('--')}---${hash}`;
}

// Exporting functions
module.exports = {
  isValidObjectName,
  isValidLabel,
  isValidDefault,
  safeSlug,
  multiSlug,
  stripAndHash,
};
