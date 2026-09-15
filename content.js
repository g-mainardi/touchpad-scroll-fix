const S = { enabled: true, factor: 0.5 };
chrome.storage.local.get(S, v => Object.assign(S, v));
chrome.storage.onChanged.addListener(c => { for (const k in c) S[k] = c[k].newValue; });

const GAP_MS = 150;
const MSG = 'touchpad-scroll-fix';
const inFrame = window !== top;
let lastT = -Infinity, touchpad = false, target = null, restX = 0, restY = 0;
let handoffId = null, childGestureId = null;
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
  restX = restY = 0;
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

addEventListener('wheel', e => {
  if (!S.enabled || e.ctrlKey || e.defaultPrevented || (!e.deltaX && !e.deltaY)) return;
  if (e.timeStamp - lastT > GAP_MS) start(looksTouchpad(e), e.composedPath(), e.deltaX, e.deltaY);
  lastT = e.timeStamp;
  globalThis.onTsfWheel?.(e, touchpad);
  // Chrome only lets a gesture be cancelled if its first event was; the latched target mirrors native latching.
  if (!target || !e.cancelable) return;
  e.preventDefault();
  scroll(e.deltaX * S.factor, e.deltaY * S.factor);
}, { passive: false });

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
