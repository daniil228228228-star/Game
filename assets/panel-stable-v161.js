/* v161 panel stability (2026-10-12): ONE owner of the DOM writes inside the market / fleet / base / tenders / operations / city sheets.
 * Root cause of "I cannot buy or upgrade anything in the Transport sheet": ~10 wrappers around renderFleetPanel (v36, v55 HUD throttle, v61, v72, v119,
 * v140, v145, v150, v151, v158, v159 tick, v163) and renderBasePanel / renderTendersPanel each rebuild their part of the sheet several times per second
 * with the SAME markup (`grid.innerHTML = ...`, or `getElementById(id)?.remove()` + new `<section id>` + `grid.prepend(section)`), so every button of the
 * sheet (31 in the fleet sheet, ~2750 DOM mutations / 10 s of idle) was replaced under the finger and a press that crossed a rebuild never produced its click.
 * The renderers are not touched; their DOM writes are reconciled here, against the raw markup that was last written (a "raw shadow" next to the live DOM):
 *   1. `el.innerHTML = html` inside a sheet is a diff: identical markup touches nothing; differing text / classes / disabled / style are patched in place
 *      (a button keeps its identity and its listeners); an element whose id / data-* / tag changed (or that decorators restructured) is replaced.
 *   2. `remove()` of an id-ed section inside a sheet is deferred to the end of the task; when the renderer puts a section with the same id back
 *      (prepend / append / appendChild / insertBefore), the OLD node is kept and patched in place from the new markup (the new node is dropped) when the two have
 *      the same shape, otherwise the new node replaces it as before. The section that is pressed / focused is never replaced or rewritten (the click always
 *      reaches it); it catches up on the next pass.
 *   3. addEventListener on a node of a sheet is de-duplicated by (type, capture, function source): retained buttons are never bound twice (no double purchase).
 *   4. re-prepending an id-ed section that already is a child is a no-op (a move is 4 mutations).
 */
(() => {
  'use strict';
  if (window.PanelStableV161) return;
  const SCOPE = '#fleetOverlay,#baseOverlay,#tendersOverlay,#operationsOverlay,#systemsOverlay,#staffOverlay,#bonusOverlay,#projectsOverlay,#metaOverlay';
  const desc = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
  if (!desc || !desc.set) return;
  const stats = { sets: 0, skipped: 0, patched: 0, replaced: 0, fullReplace: 0, protectedKept: 0, listenerDedupes: 0, moveSkips: 0, sectionKept: 0, sectionPatched: 0, sectionReplaced: 0, sectionProtected: 0 };
  const shadow = new WeakMap();   // element -> { raw: [raw top-level nodes last assigned], live: [live nodes standing for them] }
  const sectionRaw = new WeakMap(); // id-ed section -> raw clone taken when it was put into the sheet
  const bound = new WeakMap();    // element -> Set(listener keys)
  const press = { target: null, until: 0 };
  const now = () => performance.now();
  const down = e => { press.target = e.target; press.until = Infinity; };
  const up = () => { press.until = now() + 120; };
  for (const [t, f] of [['pointerdown', down], ['touchstart', down], ['pointerup', up], ['pointercancel', up], ['touchend', up]]) document.addEventListener(t, f, true);
  const scoped = el => el.nodeType === 1 && el.isConnected && !!el.closest(SCOPE);
  const isProtected = el => {
    const t = press.target;
    if (t && now() < press.until && t.nodeType && (el.contains(t) || (t.contains && t.contains(el)))) return true;
    return false; // focus alone does not protect: a tapped button keeps focus for good, which froze the sheet on stale numbers
  };
  const SOFT = /^(class|style|disabled|title|aria-.*|hidden)$/;
  function hardAttrsEqual(a, b) {
    for (const at of a.attributes) { if (SOFT.test(at.name)) continue; if (b.getAttribute(at.name) !== at.value) return false; }
    for (const at of b.attributes) { if (SOFT.test(at.name)) continue; if (a.getAttribute(at.name) !== at.value) return false; }
    return true;
  }
  function syncAttrs(live, prev, next) {
    for (const at of [...prev.attributes]) if (!next.hasAttribute(at.name) && live.hasAttribute(at.name)) live.removeAttribute(at.name);
    for (const at of next.attributes) if (prev.getAttribute(at.name) !== at.value && live.getAttribute(at.name) !== at.value) live.setAttribute(at.name, at.value);
  }
  // Can `next` be applied to `live` (which mirrors `prev`) without replacing any node?
  function canInplace(live, prev, next) {
    if (prev.isEqualNode(next)) return true;
    if (live.nodeType !== prev.nodeType || prev.nodeType !== next.nodeType) return false;
    if (next.nodeType !== 1) return true;
    if (prev.nodeName !== next.nodeName || live.nodeName !== next.nodeName || !hardAttrsEqual(prev, next)) return false;
    if (live.childNodes.length !== prev.childNodes.length || prev.childNodes.length !== next.childNodes.length) return false;
    for (let i = 0; i < live.childNodes.length; i++) if (!canInplace(live.childNodes[i], prev.childNodes[i], next.childNodes[i])) return false;
    return true;
  }
  function replace(live, next) { live.replaceWith(next); stats.replaced++; return next; }
  // live mirrors prev (raw before), next = raw after. Returns the live node that stands for `next`.
  function patch(live, prev, next) {
    if (prev.isEqualNode(next)) { stats.skipped++; return live; }
    if (live.nodeType !== prev.nodeType || prev.nodeType !== next.nodeType) return replace(live, next);
    if (next.nodeType !== 1) { if (live.nodeValue !== next.nodeValue) live.nodeValue = next.nodeValue; stats.patched++; return live; }
    const prot = isProtected(live);
    if (prev.nodeName !== next.nodeName || live.nodeName !== next.nodeName || !hardAttrsEqual(prev, next)) { if (prot) { stats.protectedKept++; return live; } return replace(live, next); }
    const mirrored = live.childNodes.length === prev.childNodes.length && prev.childNodes.length === next.childNodes.length;
    if (!mirrored) { if (prot) { stats.protectedKept++; return live; } return replace(live, next); }
    syncAttrs(live, prev, next);
    const lc = [...live.childNodes], pc = [...prev.childNodes], nc = [...next.childNodes];
    for (let i = 0; i < lc.length; i++) patch(lc[i], pc[i], nc[i]);
    stats.patched++;
    return live;
  }
  // Apply a pre-checked (canInplace) diff without any replacement.
  function inplace(live, prev, next) {
    if (prev.isEqualNode(next)) return;
    if (next.nodeType !== 1) { if (live.nodeValue !== next.nodeValue) live.nodeValue = next.nodeValue; return; }
    syncAttrs(live, prev, next);
    for (let i = 0; i < live.childNodes.length; i++) inplace(live.childNodes[i], prev.childNodes[i], next.childNodes[i]);
  }
  function apply(el, html) {
    const tpl = document.createElement('template');
    desc.set.call(tpl, html);
    const next = [...tpl.content.childNodes], prev = shadow.get(el);
    stats.sets++;
    const keptBefore = stats.protectedKept;
    const raw = next.map(n => n.cloneNode(true));
    let live;
    if (prev && prev.live.length === next.length && prev.live.every(n => n.parentNode === el)) {
      live = prev.live.map((l, i) => patch(l, prev.raw[i], next[i]));
    } else {
      stats.fullReplace++; stats.replaced++;
      desc.set.call(el, html);
      live = [...el.childNodes];
    }
    // a pressed element was left untouched: keep the OLD raw so the next pass diffs against what is really on screen and catches up
    shadow.set(el, { raw: stats.protectedKept > keptBefore ? prev.raw : raw, live });
  }
  Object.defineProperty(Element.prototype, 'innerHTML', {
    configurable: true, enumerable: desc.enumerable, get: desc.get,
    set(v) {
      const html = String(v);
      textPending.delete(this);
      if (!html || !scoped(this)) { shadow.delete(this); return desc.set.call(this, v); }
      try { apply(this, html); } catch (e) { shadow.delete(this); desc.set.call(this, v); window.__TYCOON_CAPTURE_ERROR__?.(e, 'panel-stable'); }
    }
  });

  // ---- id-ed sections: deferred remove + same-id re-insert => keep the old node
  const keyOf = n => n.id || (n.querySelector && n.querySelector('[id]') && n.querySelector('[id]').id) || '';
  const pending = new Map(); // id -> element whose remove() is deferred to the end of the task
  let flushQueued = false;
  function flush() {
    flushQueued = false;
    for (const [id, el] of pending) if (el.isConnected && pending.get(id) === el) { try { el.__psRemoved = false; Node.prototype.removeChild.call(el.parentNode, el); } catch (_) {} }
    pending.clear();
  }
  const origRemove = Element.prototype.remove;
  Element.prototype.remove = function () {
    if (this.parentNode && sectionRaw.has(this) && keyOf(this) && scoped(this)) {
      pending.set(keyOf(this), this);
      if (!flushQueued) { flushQueued = true; queueMicrotask(flush); }
      return;
    }
    return origRemove.call(this);
  };
  // `node` is about to be inserted into a sheet. Returns the node that must be used instead (the retained old one) or null to insert normally.
  function reconcileSection(parent, node) {
    const key = node && node.nodeType === 1 ? keyOf(node) : '';
    if (!key || node.isConnected) return null;
    let old = pending.get(key);
    if (!old) { // the renderer did not remove it (a parent's innerHTML wipe used to do that): same key already in this parent => the same section
      let c = document.getElementById(key);
      while (c && c.parentNode !== parent) c = c.parentNode;
      if (c && c !== node && sectionRaw.has(c)) old = c;
    }
    if (!old || !old.isConnected || old.parentNode !== parent) {
      if (parent.nodeType === 1 && scoped(parent)) sectionRaw.set(node, node.cloneNode(true));
      return null;
    }
    const prev = sectionRaw.get(old);
    pending.delete(key);
    if (!prev) return null;
    if (isProtected(old)) { stats.sectionProtected++; return old; }
    if (prev.isEqualNode(node)) { stats.sectionKept++; return old; }
    if (canInplace(old, prev, node)) { const raw = node.cloneNode(true); inplace(old, prev, node); sectionRaw.set(old, raw); stats.sectionPatched++; return old; }
    stats.sectionReplaced++;
    sectionRaw.set(node, node.cloneNode(true));
    Node.prototype.removeChild.call(old.parentNode, old);
    return null;
  }
  for (const name of ['prepend', 'append']) {
    const orig = Element.prototype[name];
    Element.prototype[name] = function (...nodes) {
      if (nodes.length === 1 && this.nodeType === 1 && nodes[0] && nodes[0].nodeType === 1 && keyOf(nodes[0]) && this.isConnected && scoped(this)) {
        const n = nodes[0];
        if (n.parentNode === this) { stats.moveSkips++; return; }
        const kept = reconcileSection(this, n);
        if (kept) { stats.moveSkips++; return; }
      }
      return orig.apply(this, nodes);
    };
  }
  for (const name of ['appendChild', 'insertBefore']) {
    const orig = Node.prototype[name];
    Node.prototype[name] = function (node, ref) {
      if (this.nodeType === 1 && node && node.nodeType === 1 && keyOf(node) && this.isConnected && scoped(this)) {
        if (node.parentNode === this) { stats.moveSkips++; return node; }
        const kept = reconcileSection(this, node);
        if (kept) { stats.moveSkips++; return node; }
      }
      return orig.call(this, node, ref);
    };
  }

  // insertAdjacentHTML('beforeend'|'afterbegin', '<div id=...>') used to append a fresh copy after the parent's innerHTML wipe: route id-ed sections through the same reconcile.
  const iah = Element.prototype.insertAdjacentHTML;
  Element.prototype.insertAdjacentHTML = function (pos, html) {
    if ((pos === 'beforeend' || pos === 'afterbegin') && this.isConnected && scoped(this)) {
      const tpl = document.createElement('template');
      desc.set.call(tpl, String(html));
      const nodes = [...tpl.content.childNodes];
      if (nodes.length && nodes.every(n => n.nodeType === 1 && keyOf(n))) {
        if (pos === 'beforeend') for (const n of nodes) this.appendChild(n); else for (const n of nodes.reverse()) this.prepend(n);
        return;
      }
    }
    return iah.call(this, pos, html);
  };

  // ---- no-op writes: a DOM write that changes nothing is still a mutation record (and wakes every decorator observer)
  stats.noopWrites = 0;
  // remove-then-add in one task (guide markers: clear every mark, then mark again; ~25 mutations/s on the market sheet) is a no-op in the end: removals of classes and
  // data-/aria- attributes inside a sheet are applied at the end of the task and cancelled by a re-add of the same token / value.
  const pendClass = new Map(), pendAttr = new Map();
  let pendQueued = false;
  const queuePend = () => { if (!pendQueued) { pendQueued = true; queueMicrotask(flushPend); } };
  function flushPend() {
    pendQueued = false;
    for (const [el, set] of pendClass) for (const t of set) origRemoveToken.call(el.classList, t);
    for (const [el, map] of pendAttr) for (const n of map.keys()) remAttr.call(el, n);
    pendClass.clear(); pendAttr.clear();
  }
  const origAddToken = DOMTokenList.prototype.add, origRemoveToken = DOMTokenList.prototype.remove, origToggle = DOMTokenList.prototype.toggle, origContains = DOMTokenList.prototype.contains;
  const getAttr = Element.prototype.getAttribute, hasAttr = Element.prototype.hasAttribute;
  const setAttr = Element.prototype.setAttribute;
  const remAttr = Element.prototype.removeAttribute;
  const deferrable = n => /^(data-|aria-)/.test(n);
  Element.prototype.setAttribute = function (n, v) {
    if (pendAttr.size) { const m = pendAttr.get(this); if (m && m.has(n)) { m.delete(n); if (getAttr.call(this, n) === String(v)) { stats.noopWrites++; return; } } }
    if (getAttr.call(this, n) === String(v) && scoped(this)) { stats.noopWrites++; return; }
    return setAttr.call(this, n, v);
  };
  Element.prototype.removeAttribute = function (n) {
    if (!hasAttr.call(this, n)) return;
    if (deferrable(n) && scoped(this)) { let m = pendAttr.get(this); if (!m) pendAttr.set(this, m = new Map()); m.set(n, true); queuePend(); return; }
    return remAttr.call(this, n);
  };
  Element.prototype.getAttribute = function (n) { if (pendAttr.size) { const m = pendAttr.get(this); if (m && m.has(n)) return null; } return getAttr.call(this, n); };
  Element.prototype.hasAttribute = function (n) { if (pendAttr.size) { const m = pendAttr.get(this); if (m && m.has(n)) return false; } return hasAttr.call(this, n); };
  const owners = new WeakMap();
  const cld = Object.getOwnPropertyDescriptor(Element.prototype, 'classList');
  Object.defineProperty(Element.prototype, 'classList', { configurable: true, enumerable: cld.enumerable, get() { const l = cld.get.call(this); owners.set(l, this); return l; } });
  DOMTokenList.prototype.contains = function (t) { const el = owners.get(this); if (el && pendClass.size) { const set = pendClass.get(el); if (set && set.has(t)) return false; } return origContains.call(this, t); };
  DOMTokenList.prototype.add = function (...tokens) {
    const el = owners.get(this);
    if (!el || !scoped(el)) return origAddToken.apply(this, tokens);
    const set = pendClass.get(el);
    const rest = [];
    for (const t of tokens) { if (set && set.has(t)) { set.delete(t); stats.noopWrites++; } else if (!origContains.call(this, t)) rest.push(t); else stats.noopWrites++; }
    if (rest.length) return origAddToken.apply(this, rest);
  };
  DOMTokenList.prototype.remove = function (...tokens) {
    const el = owners.get(this);
    if (!el || !scoped(el)) return origRemoveToken.apply(this, tokens);
    for (const t of tokens) {
      if (!origContains.call(this, t)) continue;
      let set = pendClass.get(el); if (!set) pendClass.set(el, set = new Set());
      set.add(t); queuePend();
    }
  };
  DOMTokenList.prototype.toggle = function (t, force) {
    const el = owners.get(this);
    if (!el || !scoped(el)) return origToggle.call(this, t, force);
    const has = this.contains(t), want = force === undefined ? !has : !!force;
    if (want && !has) this.add(t); else if (!want && has) this.remove(t); else stats.noopWrites++;
    return want;
  };
  for (const prop of ['title', 'className']) {
    const d = Object.getOwnPropertyDescriptor(Element.prototype, prop) || Object.getOwnPropertyDescriptor(HTMLElement.prototype, prop);
    if (!d || !d.set) continue;
    Object.defineProperty(d === Object.getOwnPropertyDescriptor(Element.prototype, prop) ? Element.prototype : HTMLElement.prototype, prop, { configurable: true, enumerable: d.enumerable, get: d.get, set(v) { if (d.get.call(this) === String(v) && scoped(this)) { stats.noopWrites++; return; } return d.set.call(this, v); } });
  }
  // textContent: several wrappers write the same title in turn ('Fleet', 'Company Fleet', 'Work and fleet'): only the LAST value of a task is applied, and only if it
  // differs from what is shown (a text write that changes nothing still replaces the text node and wakes the decorators).
  const tcd = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent');
  const textPending = new Map();
  let textQueued = false;
  function flushText() {
    textQueued = false;
    for (const [el, v] of textPending) { if (tcd.get.call(el) !== v || (el.childNodes.length === 0 && v !== '')) tcd.set.call(el, v); else stats.noopWrites++; }
    textPending.clear();
  }
  Object.defineProperty(Node.prototype, 'textContent', { configurable: true, enumerable: tcd.enumerable,
    get() { return textPending.has(this) ? textPending.get(this) : tcd.get.call(this); },
    set(v) {
      if (this.nodeType === 1 && this.id && scoped(this)) {
        textPending.set(this, String(v));
        if (!textQueued) { textQueued = true; queueMicrotask(flushText); }
        return;
      }
      return tcd.set.call(this, v);
    } });
  for (const [cls, prop] of [[HTMLButtonElement, 'disabled'], [HTMLInputElement, 'disabled'], [HTMLElement, 'hidden']]) {
    const d = Object.getOwnPropertyDescriptor(cls.prototype, prop);
    if (!d || !d.set) continue;
    Object.defineProperty(cls.prototype, prop, { configurable: true, enumerable: d.enumerable, get: d.get, set(v) { if (!!d.get.call(this) === !!v && scoped(this)) { stats.noopWrites++; return; } return d.set.call(this, v); } });
  }

  const add = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (type, fn, opts) {
    if (this && this.nodeType === 1 && typeof fn === 'function' && this.closest && this.closest(SCOPE)) {
      const key = type + '|' + (typeof opts === 'object' ? !!(opts && opts.capture) : !!opts) + '|' + Function.prototype.toString.call(fn);
      let set = bound.get(this);
      if (!set) bound.set(this, set = new Set());
      if (set.has(key)) { stats.listenerDedupes++; return; }
      set.add(key);
    }
    return add.call(this, type, fn, opts);
  };
  window.PanelStableV161 = { stats, press };
})();
