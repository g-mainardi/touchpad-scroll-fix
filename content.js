const S = { enabled: true, factor: 0.5 };
chrome.storage.local.get(S, v => Object.assign(S, v));
chrome.storage.onChanged.addListener(c => { for (const k in c) S[k] = c[k].newValue; });

const GAP_MS = 150;
// Copies for sites that scroll on wheel themselves are batched, one per STEP scaled px.
// ponytail: fixed step, the leftover under STEP at gesture end is dropped; tie it to the slider if it feels off.
const STEP = 40;
const MSG = 'touchpad-scroll-fix';
const inFrame = window !== top;
let lastT = -Infinity, touchpad = false, target = null, restX = 0, restY = 0;
let handoffId = null, childGestureId = null, siteHandled = false, accX = 0, accY = 0;
const childFrames = new Map();

// Mouse wheels send whole notches (wheelDelta multiple of 120), touchpads arbitrary values.
// ponytail: heuristic, a free-spin hi-res mouse may read as touchpad; the popup test area shows the verdict.
const notch = (d, w) => d === 0 || (w !== 0 && w % 120 === 0);
const looksTouchpad = e => e.deltaMode === 0 && !(notch(e.deltaX, e.wheelDeltaX) && notch(e.deltaY, e.wheelDeltaY));

const canMove = (el, dx, dy, okX, okY) =>
  (okY && (dy > 0 ? el.scrollTop + el.clientHeight < el.scrollHeight - 1 : dy < 0 && el.scrollTop > 0)) ||
  (okX && (dx > 0 ? el.scrollLeft + el.clientWidth < el.scrollWidth - 1 : dx < 0 && el.scrollLeft > 0));

function* ancestors(node) {
  for (; node; node = node.parentNode ?? node.host) yield node;
}

const findTarget = (path, dx, dy) => {
  for (const el of path) {
    if (!(el instanceof Element) || el === document.body || el === document.documentElement) continue;
    const s = getComputedStyle(el), auto = /auto|scroll|overlay/;
    if (canMove(el, dx, dy, auto.test(s.overflowX), auto.test(s.overflowY))) return el;
  }
  const root = document.scrollingElement;
  if (!root) return null;
  // Viewport overflow comes from <html>, or from <body> when <html> is visible; hidden = scroll locked (e.g. modals).
  const h = getComputedStyle(document.documentElement), b = document.body && getComputedStyle(document.body);
  const ok = k => !/hidden|clip/.test(h[k] === 'visible' && b ? b[k] : h[k]);
  return canMove(root, dx, dy, ok('overflowX'), ok('overflowY')) ? root : null;
};

// A frame with nothing left to scroll hands the gesture to its parent, like native scroll chaining.
const start = (isTouchpad, path, dx, dy) => {
  touchpad = isTouchpad;
  target = touchpad ? findTarget(path, dx, dy) : null;
  handoffId = null;
  if (touchpad && !target && inFrame) {
    target = parent;
    handoffId = crypto.getRandomValues(new Uint32Array(2)).join('-');
    parent.postMessage({ [MSG]: handoffId }, '*');
  }
  restX = restY = accX = accY = 0;
  siteHandled = false;
};

const scroll = (dx, dy) => {
  if (handoffId) return chrome.runtime.sendMessage({ [MSG]: handoffId, dx, dy }).catch(() => {});
  restX += dx;
  restY += dy;
  const x = Math.trunc(restX), y = Math.trunc(restY);
  restX -= x;
  restY -= y;
  if (x || y) target.scrollBy(x, y);
};

let replaying = false;
// Dispatches a copy of e with the given deltas; returns false if the page cancelled it.
const replay = (e, dx, dy) => {
  const k = dx / (e.deltaX || 1), l = dy / (e.deltaY || 1);
  const copy = new WheelEvent('wheel', {
    bubbles: true, cancelable: true, composed: true, view: e.view, detail: e.detail,
    screenX: e.screenX, screenY: e.screenY, clientX: e.clientX, clientY: e.clientY, buttons: e.buttons,
    shiftKey: e.shiftKey, altKey: e.altKey, metaKey: e.metaKey, deltaMode: e.deltaMode,
    deltaX: dx, deltaY: dy, deltaZ: e.deltaZ, wheelDeltaX: e.wheelDeltaX * k, wheelDeltaY: e.wheelDeltaY * l,
  });
  replaying = true;
  try { return e.composedPath()[0].dispatchEvent(copy); } finally { replaying = false; }
};
addEventListener('wheel', e => {
  if (replaying || !S.enabled || e.ctrlKey || (!e.deltaX && !e.deltaY)) return;
  const fresh = e.timeStamp - lastT > GAP_MS;
  if (fresh) start(looksTouchpad(e), e.composedPath(), e.deltaX, e.deltaY);
  lastT = e.timeStamp;
  globalThis.onTsfWheel?.(e, touchpad);
  // Chrome only lets a gesture be cancelled if its first event was; the latched target mirrors native latching.
  if (!touchpad || !e.cancelable) return;
  const dx = e.deltaX * S.factor, dy = e.deltaY * S.factor;
  // Page wheel listeners never see the real events.
  // - Over an inner scroller the extension scrolls it and the page sees no wheel event at all. Notion Calendar, on
  //   any wheel event, turns on mandatory scroll snapping and jumps a day per event, so it must not see even one.
  // - Otherwise (page root, nothing to scroll, iframe hand-off) the first event becomes a near-zero probe copy.
  //   If the page cancels it (maps, carousels) the site scrolls itself and gets copies, batched one per STEP scaled
  //   px since some move a fixed step per event; if not, the extension scrolls.
  // ponytail: copies have isTrusted false, and wheel listeners that don't cancel only get the probe; whitelist if either bites.
  e.stopImmediatePropagation();
  if (fresh) {
    accX = accY = 0;
    const inner = target instanceof Element && target !== document.scrollingElement;
    siteHandled = !inner && !replay(e, dx * 1e-3, dy * 1e-3);
  }
  if (siteHandled) {
    e.preventDefault();
    accX += dx;
    accY += dy;
    if (Math.hypot(accX, accY) < STEP) return;
    replay(e, accX, accY);
    accX = accY = 0;
    return;
  }
  if (!target) return;
  e.preventDefault();
  scroll(dx, dy);
}, { capture: true, passive: false });

// Parent side of the hand-off. postMessage only tells which child frame a gesture id belongs to, and pages can forge it;
// the scroll amounts arrive through extension messaging, which page scripts can't send.
addEventListener('message', e => {
  const id = e.data?.[MSG];
  const frame = typeof id === 'string' && [...document.querySelectorAll('iframe, frame')].find(f => f.contentWindow === e.source);
  if (!frame) return;
  childFrames.set(id, frame);
  if (childFrames.size > 16) childFrames.delete(childFrames.keys().next().value);
});

// ponytail: iframes inside shadow roots aren't found, so their hand-off is dropped; walk open shadow roots if that shows up.
chrome.runtime.onMessage.addListener(m => {
  const { [MSG]: id, dx, dy } = m ?? {};
  const frame = childFrames.get(id);
  if (!S.enabled || !frame || !Number.isFinite(dx) || !Number.isFinite(dy)) return;
  if (id !== childGestureId) {
    childGestureId = id;
    start(true, ancestors(frame), dx, dy);
  }
  lastT = performance.now();
  if (target) scroll(dx, dy);
});
