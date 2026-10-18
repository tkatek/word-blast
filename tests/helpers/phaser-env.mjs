/**
 * Minimal DOM/browser shims so Phaser 3 (HEADLESS) + Matter.js can run under
 * Node for deterministic integration tests. No rendering happens; the fake
 * canvas 2D context absorbs every draw call.
 *
 * Must be imported (side effects run) BEFORE `import('phaser')` because
 * Phaser captures environment facts at module-init time.
 */

/**
 * Font-size-aware Arial-bold approximation for headless text measurement
 * (answer-panel planning + question-card fitting run REAL Phaser Text
 * metrics; in Node the canvas is fake, so width/height come from this table
 * instead — browser runs use the true canvas metrics).
 */
const NARROW = new Set(['i', 'l', 'I', 'j', 't', 'f', 'r', ' ', '.', ',', "'", ':', ';', '!', '|', '(', ')', '[', ']']);
const WIDE = new Set(['m', 'w', 'M', 'W', '@']);
const CAPS = new Set('ABCDEFGHJKLNOPQRSTUVXYZ');

function approxCharWidth(ch) {
  if (NARROW.has(ch)) return 0.30;
  if (WIDE.has(ch)) return 0.86;
  if (CAPS.has(ch)) return 0.72;
  return 0.575; // average Arial-bold glyph
}

function measureArialBold(text, fontSize) {
  let w = 0;
  for (const ch of String(text)) w += approxCharWidth(ch) * fontSize;
  return w;
}

function make2DContext() {
  // A Proxy-based no-op 2D context: any method call is absorbed, property
  // reads for the handful of value-returning APIs Phaser depends on are
  // provided explicitly. Rendering never happens in the harness.
  const target = {
    canvas: null,
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    font: '10px sans-serif',
    imageSmoothingEnabled: true,
    measureText: (t) => {
      // Phaser sets ctx.font (e.g. "bold 24px Arial") before measuring —
      // approximate the same metrics the real canvas would report.
      const m = /(\d+(?:\.\d+)?)px/.exec(target.font);
      const size = m ? parseFloat(m[1]) : 10;
      return {
        width: measureArialBold(t, size),
        actualBoundingBoxAscent: size * 0.72,
        actualBoundingBoxDescent: size * 0.2,
        fontBoundingBoxAscent: size * 0.9,
        fontBoundingBoxDescent: size * 0.22
      };
    },
    getImageData: (_x, _y, w = 1, h = 1) => ({ width: w, height: h, data: new Uint8ClampedArray(Math.max(4, w * h * 4)) }),
    createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(Math.max(4, w * h * 4)) }),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    createPattern: () => ({}),
    getLineDash: () => [],
    isPointInPath: () => false,
    isPointInStroke: () => false,
  };
  return new Proxy(target, {
    get(obj, prop) {
      if (prop in obj) return obj[prop];
      return () => undefined;   // every other method is a no-op
    },
    set(obj, prop, value) {
      obj[prop] = value;
      return true;
    }
  });
}

function makeCanvas(width = 300, height = 150) {
  const listeners = {};
  const canvas = {
    width, height,
    style: {},
    parentNode: null,
    getBoundingClientRect: () => ({ left: 0, top: 0, right: width, bottom: height, width, height }),
    addEventListener: (t, f) => { (listeners[t] = listeners[t] || []).push(f); },
    removeEventListener: (t, f) => { if (listeners[t]) listeners[t] = listeners[t].filter((x) => x !== f); },
    dispatchEvent: () => true,
    getContext: (type) => {
      if (type === '2d') { const c = make2DContext(); c.canvas = canvas; return c; }
      return null; // no webgl in Node — Phaser.HEADLESS never asks
    },
    toDataURL: () => 'data:image/png;base64,',
  };
  // pass `instanceof HTMLCanvasElement` checks against the shim class
  try { Object.setPrototypeOf(canvas, HTMLCanvasElementShim.prototype); } catch { /* ignore */ }
  return canvas;
}

function makeElement(tag) {
  const el = {
    tagName: String(tag).toUpperCase(),
    style: {},
    children: [],
    dataset: {},
    parentNode: null,
    ownerDocument: null,
    appendChild(c) { c.parentNode = el; el.children.push(c); return c; },
    removeChild(c) { el.children = el.children.filter((x) => x !== c); c.parentNode = null; return c; },
    addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true,
    setAttribute() {}, getAttribute: () => null, removeAttribute() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }),
    querySelector: () => null,
    querySelectorAll: () => [],
    contains: () => false,
    focus() {}, blur() {},
  };
  if (String(tag).toLowerCase() === 'canvas') return makeCanvas();
  return el;
}

const noopStorage = {
  getItem: () => null,
  setItem() {},
  removeItem() {},
};

const documentShim = {
  readyState: 'complete',
  visibilityState: 'visible',
  hidden: false,
  hasFocus: () => true,
  body: makeElement('body'),
  documentElement: makeElement('html'),
  head: makeElement('head'),
  createElement: (tag) => makeElement(tag),
  createElementNS: (_ns, tag) => makeElement(tag),
  createTextNode: () => ({ data: '' }),
  getElementById: () => null,
  getElementsByTagName: () => [],
  getElementsByClassName: () => [],
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true,
  createEvent: () => ({ initEvent() {} }),
  exitPointerLock() {},
  pointerLockElement: null,
  fullscreenElement: null,
  fonts: { ready: Promise.resolve(), check: () => true, load: () => Promise.resolve([]) },
  styleSheets: [],
};

const listeners = new Map();
const windowShim = {
  document: documentShim,
  navigator: {
    userAgent: 'node-phaser-headless',
    language: 'en-US',
    languages: ['en-US'],
    platform: 'node',
    hardwareConcurrency: 4,
    maxTouchPoints: 0,
    vendor: '',
    appVersion: '5.0 (node)',
    clipboard: { writeText: () => Promise.resolve() },
  },
  location: { href: 'http://localhost/', protocol: 'http:', host: 'localhost', hostname: 'localhost', port: '', pathname: '/', search: '', hash: '', origin: 'http://localhost' },
  performance: (await import('node:perf_hooks')).performance,
  requestAnimationFrame: (cb) => setTimeout(() => cb(performance.now()), 16),
  cancelAnimationFrame: (id) => clearTimeout(id),
  setTimeout, clearTimeout, setInterval, clearInterval,
  addEventListener: (t, f) => { if (!listeners.has(t)) listeners.set(t, []); listeners.get(t).push(f); },
  removeEventListener: (t, f) => { const l = listeners.get(t); if (l) listeners.set(t, l.filter((x) => x !== f)); },
  dispatchEvent: () => true,
  innerWidth: 1280,
  innerHeight: 720,
  outerWidth: 1280,
  outerHeight: 720,
  devicePixelRatio: 1,
  screen: { width: 1920, height: 1080, orientation: { type: 'landscape-primary', angle: 0 } },
  localStorage: noopStorage,
  sessionStorage: noopStorage,
  AudioContext: undefined,
  webkitAudioContext: undefined,
  Image: class { constructor() { this.onload = null; this.onerror = null; } set src(_v) { if (this.onload) setImmediate(() => this.onload()); } },
  HTMLElement: class HTMLElement {},
  DOMParser: undefined,
  MutationObserver: undefined,
  ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
  matchMedia: () => ({ matches: false, media: '', addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
  getComputedStyle: () => ({ getPropertyValue: () => '' }),
  URL: Object.assign(globalThis.URL, {
    createObjectURL: () => 'blob:node-shim',
    revokeObjectURL: () => {},
  }),
  scrollX: 0, scrollY: 0, pageXOffset: 0, pageYOffset: 0,
  alert() {}, confirm: () => false, prompt: () => null,
};

/** Minimal XHR: always "fails" async so asset loads error out cleanly. */
class XMLHttpRequestShim {
  constructor() {
    this.readyState = 0;
    this.status = 0;
    this.response = null;
    this.responseText = '';
    this.responseType = '';
    this.onload = null; this.onerror = null; this.onabort = null; this.ontimeout = null;
    this.onreadystatechange = null;
  }
  open(_method, url) { this._url = url; this.readyState = 1; }
  setRequestHeader() {}
  getAllResponseHeaders() { return ''; }
  getResponseHeader() { return null; }
  overrideMimeType() {}
  abort() { if (this.onabort) this.onabort(); }
  send() {
    setImmediate(() => {
      this.readyState = 4;
      this.status = 404;
      if (this.onerror) this.onerror(new Error('asset load disabled in headless tests'));
    });
  }
}
windowShim.XMLHttpRequest = XMLHttpRequestShim;
windowShim.CanvasRenderingContext2D = class CanvasRenderingContext2D {};
windowShim.File = class File {};
windowShim.FileReader = class FileReader {};
windowShim.FileList = class FileList {};
windowShim.Blob = class Blob {};

windowShim.window = windowShim;
windowShim.self = windowShim;
windowShim.top = windowShim;
windowShim.parent = windowShim;
windowShim.globalThis = globalThis;
documentShim.defaultView = windowShim;

// DOM class shims Phaser instanceof-checks at module init / runtime.
class HTMLCanvasElementShim {}
class HTMLVideoElementShim {}
class HTMLElementShim {}
class HTMLImageElementShim {}
class ImageDataShim {
  constructor(width = 1, height = 1) { this.width = width; this.height = height; }
}

export function installPhaserEnv() {
  for (const key of Object.keys(windowShim)) {
    if (globalThis[key] === undefined) {
      try { globalThis[key] = windowShim[key]; } catch { /* read-only builtin */ }
    }
  }
  globalThis.window = windowShim;
  globalThis.document = documentShim;
  globalThis.HTMLCanvasElement = HTMLCanvasElementShim;
  globalThis.HTMLVideoElement = HTMLVideoElementShim;
  globalThis.HTMLElement = HTMLElementShim;
  globalThis.HTMLImageElement = HTMLImageElementShim;
  globalThis.ImageData = ImageDataShim;
  globalThis.XMLHttpRequest = XMLHttpRequestShim;
  return { window: windowShim, document: documentShim };
}
