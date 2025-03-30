// Version should be updated using a release script or automation tool,
// according to instructions in RELEASE.md.
const __version__ = "7.0.0";

// version_info looks like [1, 2, 3, "dev"] if __version__ is "1.2.3.dev"
const version_info = __version__
  .split(".")
  .map((part) => /^\d+$/.test(part) ? parseInt(part, 10) : part);

module.exports = {
  __version__,
  version_info,
};
