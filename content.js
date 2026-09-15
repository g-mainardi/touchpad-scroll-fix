const S = { enabled: true, factor: 0.5 };
chrome.storage.local.get(S, v => Object.assign(S, v));
chrome.storage.onChanged.addListener(c => { for (const k in c) S[k] = c[k].newValue; });

const GAP_MS = 150;
let lastT = -Infinity, touchpad = false, target = null, restX = 0, restY = 0;

// Mouse wheels send whole notches (wheelDelta multiple of 120), touchpads arbitrary values.
// ponytail: heuristic, a free-spin hi-res mouse may read as touchpad; the popup test area shows the verdict.
const notch = (d, w) => d === 0 || (w !== 0 && w % 120 === 0);
const looksTouchpad = e => e.deltaMode === 0 && !(notch(e.deltaX, e.wheelDeltaX) && notch(e.deltaY, e.wheelDeltaY));

const canMove = (el, dx, dy, okX, okY) =>
  (okY && (dy > 0 ? el.scrollTop + el.clientHeight < el.scrollHeight - 1 : dy < 0 && el.scrollTop > 0)) ||
  (okX && (dx > 0 ? el.scrollLeft + el.clientWidth < el.scrollWidth - 1 : dx < 0 && el.scrollLeft > 0));

const findTarget = e => {
  const { deltaX: dx, deltaY: dy } = e;
  for (const el of e.composedPath()) {
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

addEventListener('wheel', e => {
  if (!S.enabled || e.ctrlKey || e.defaultPrevented || (!e.deltaX && !e.deltaY)) return;
  if (e.timeStamp - lastT > GAP_MS) {
    touchpad = looksTouchpad(e);
    target = touchpad ? findTarget(e) : null;
    restX = restY = 0;
  }
  lastT = e.timeStamp;
  globalThis.onTsfWheel?.(e, touchpad);
  // Chrome only lets a gesture be cancelled if its first event was; the latched target mirrors native latching.
  if (!target || !e.cancelable) return;
  e.preventDefault();
  restX += e.deltaX * S.factor;
  restY += e.deltaY * S.factor;
  const x = Math.trunc(restX), y = Math.trunc(restY);
  restX -= x;
  restY -= y;
  if (x || y) target.scrollBy(x, y);
}, { passive: false });
