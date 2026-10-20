/**
 * Build identity (stale-deployment detection).
 *
 * `__WB_BUILD_ID__` is replaced at build time by vite.config.js with
 * "<version>+<git-short-hash>@<timestamp>" (both `npm run build` and the
 * dev server inject it). Outside a bundler (Node unit tests importing this
 * module) the identifier falls back to a visible "dev-unbuilt" marker, so
 * a stale or uncompiled deployment can always be recognized on-device:
 *   window.__WB__.diag().build        (diagnostics panel, ?diag=1)
 *   document.documentElement.dataset.wbBuild
 */
const injected = typeof __WB_BUILD_ID__ !== 'undefined' ? __WB_BUILD_ID__ : null;

export const BUILD_ID = injected || 'dev-unbuilt';

/** True when this module was compiled by vite (dev or build). */
export const IS_BUNDLED = !!injected;
