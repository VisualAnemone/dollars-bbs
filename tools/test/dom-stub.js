// Minimal DOM/browser stub shared by the headless harnesses.
function mkEl(id) {
  const el = { id, _classes: new Set(), textContent: '', innerHTML: '', style: {}, width: 0, height: 0 };
  el.classList = {
    add: c => el._classes.add(c), remove: c => el._classes.delete(c),
    toggle: (c, f) => { f ? el._classes.add(c) : el._classes.delete(c); },
    contains: c => el._classes.has(c),
  };
  return el;
}

function install({ ctx2d, createElement } = {}) {
  const listeners = {};
  const els = {};
  const elById = id => els[id] || (els[id] = mkEl(id));
  const gameEl = mkEl('game');
  gameEl.width = 960; gameEl.height = 540;
  const proxyCtx = new Proxy({}, {
    get: (t, p) => p === 'canvas' ? gameEl : (() => ({ addColorStop() {} })),
    set: () => true,
  });
  gameEl.getContext = () => ctx2d || proxyCtx;

  let rafCb = null, simTime = 0;
  global.requestAnimationFrame = cb => { rafCb = cb; };
  global.addEventListener = (ev, cb) => { (listeners[ev] = listeners[ev] || []).push(cb); };
  global.innerWidth = 960; global.innerHeight = 540;
  global.performance = { now: () => simTime };
  global.localStorage = {
    _s: {},
    getItem(k) { return k in this._s ? this._s[k] : null; },
    setItem(k, v) { this._s[k] = String(v); },
  };
  global.document = {
    getElementById: id => id === 'game' ? gameEl : elById(id),
    addEventListener: () => {},
    hidden: false,
    createElement: createElement || (() => mkEl('x')),
  };
  global.window = global;

  return {
    key: code => (listeners.keydown || []).forEach(cb => cb({ code, repeat: false, preventDefault() {} })),
    tap: x => (listeners.pointerdown || []).forEach(cb => cb({ clientX: x, target: { closest: () => null } })),
    vis: id => !elById(id)._classes.has('hidden'),
    text: id => elById(id).textContent,
    step: n => { for (let i = 0; i < n; i++) { simTime += 16.67; const cb = rafCb; rafCb = null; cb(simTime); } },
    bumpTime: ms => { simTime += ms; },
    store: () => global.localStorage._s,
  };
}

function loadGame(file) {
  const fs = require('fs');
  const html = fs.readFileSync(file, 'utf8');
  return html.match(/<script>([\s\S]*)<\/script>/)[1];
}

module.exports = { install, loadGame };
