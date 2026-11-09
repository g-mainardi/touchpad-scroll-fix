// Real-input check of the iframe -> parent scroll hand-off: `node test-iframe.mjs`
// Uses flatpak Chrome by default; override with CHROME="google-chrome".
import { createServer } from 'node:http';
import { readFileSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';

const PORT = 8765, CDP = 9333, FACTOR = 0.5;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Stubs the extension APIs; runtime messages go to the top frame, which fans them out to every frame like background.js.
const stub = `<script>
  const rt = [];
  addEventListener('message', e => {
    if (e.data?.__rt && top === window) (function deliver(w) {
      w.postMessage({ __rtDeliver: e.data.__rt }, '*');
      for (let i = 0; i < w.frames.length; i++) deliver(w.frames[i]);
    })(window);
    if (e.data?.__rtDeliver) rt.forEach(f => f(e.data.__rtDeliver));
  });
  globalThis.chrome = {
    storage: { local: { get: (d, cb) => cb({ ...d, factor: ${FACTOR} }) }, onChanged: { addListener() {} } },
    runtime: { onMessage: { addListener: f => rt.push(f) }, sendMessage: m => (top.postMessage({ __rt: m }, '*'), Promise.resolve()) },
  };
</script><script src="/content.js"></script>`;
const pages = {
  '/parent.html': `<!doctype html>${stub}<body style="margin:0">
    <div id="outer" style="height:300px;overflow:auto">
      <iframe src="http://127.0.0.1:${PORT}/child.html?flat" style="display:block;width:300px;height:150px;border:0"></iframe>
      <iframe src="http://127.0.0.1:${PORT}/child.html?tall" style="display:block;width:300px;height:150px;border:0"></iframe>
      <div style="height:3000px"></div>
    </div>
    <div id="wide" style="position:fixed;top:0;right:0;width:100px;height:80px;overflow-x:auto"><div style="width:3000px;height:1px"></div></div>
    <div id="cal" style="position:fixed;top:200px;right:0;width:100px;height:80px;overflow-x:auto;scroll-snap-type:none"><div style="display:flex"></div></div>
    <div id="custom" style="position:fixed;top:100px;right:0;width:100px;height:80px;overflow:hidden"></div>
    <script>
      // Like Notion Calendar: a native scroller whose page, on wheel, turns on mandatory snapping to columns and also
      // jumps a whole column per event, without cancelling it.
      cal.firstElementChild.innerHTML = '<div style="flex:none;width:100px;height:1px;scroll-snap-align:start"></div>'.repeat(300);
      cal.addEventListener('wheel', e => {
        cal.style.scrollSnapType = 'x mandatory';
        window.calAcc += e.deltaX;
        if (Math.abs(window.calAcc) >= 1) { cal.scrollLeft += 1000 * Math.sign(window.calAcc); window.calAcc = 0; window.calJumps++; }
      }, { passive: true });
      // A carousel-like page that cancels native scrolling and moves one step per wheel event, whatever the delta.
      custom.addEventListener('wheel', e => { e.preventDefault(); if (Math.abs(e.deltaX) >= 1) window.customX++; }, { passive: false });
      addEventListener('message', e => {
        if (e.data?.childY !== undefined) window.childY = e.data.childY;
        if (e.data?.childWheel) window.childWheel = e.data.childWheel;
      });
      addEventListener('wheel', e => { window.lastWheel = { deltaX: e.deltaX, wheelDeltaX: e.wheelDeltaX, deltaY: e.deltaY, wheelDeltaY: e.wheelDeltaY, cancelable: e.cancelable }; }, true);
      addEventListener('wheel', e => { window.lastWheel.prevented = e.defaultPrevented; });
      const reset = () => {
        cal.style.scrollSnapType = 'none';
        outer.scrollTop = wide.scrollLeft = cal.scrollLeft = 0;
        window.calAcc = window.calJumps = 0;
        window.childY = window.customX = 0;
        window.lastWheel = window.childWheel = null;
        for (let i = 0; i < frames.length; i++) frames[i].postMessage({ reset: 1 }, '*');
      };
    </script>`,
  '/child.html': `<!doctype html>${stub}<body style="margin:0"><div id="c"></div><script>
    if (location.search === '?tall') { c.style.height = '2000px'; onscroll = () => parent.postMessage({ childY: scrollY }, '*'); }
    addEventListener('message', e => { if (e.data?.reset) scrollTo(0, 0); });
    addEventListener('wheel', e => parent.postMessage({ childWheel: { deltaY: e.deltaY, wheelDeltaY: e.wheelDeltaY, cancelable: e.cancelable } }, '*'), true);
  </script>`,
};

const server = createServer((req, res) => {
  const path = req.url.split('?')[0];
  const body = path === '/content.js' ? readFileSync(new URL('content.js', import.meta.url)) : pages[path];
  res.writeHead(body ? 200 : 404, { 'content-type': path.endsWith('.js') ? 'text/javascript' : 'text/html' }).end(body);
}).listen(PORT);

const profile = `${process.env.HOME}/.var/app/com.google.Chrome/cache/tsf-cdp`;
const [cmd, ...args] = (process.env.CHROME ?? 'flatpak run com.google.Chrome').split(' ');
spawn(cmd, [...args, '--headless', '--no-first-run', `--user-data-dir=${profile}`,
  `--remote-debugging-port=${CDP}`, '--window-size=400,400', 'about:blank'], { stdio: 'ignore' });

const connect = async url => {
  const ws = new WebSocket(url), pending = new Map();
  let id = 0;
  await new Promise(r => { ws.onopen = r; });
  ws.onmessage = m => { const d = JSON.parse(m.data); pending.get(d.id)?.(d.result); pending.delete(d.id); };
  return (method, params = {}) => new Promise(r => { pending.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
};

let list;
for (let i = 0; i < 50 && !list; i++) {
  await sleep(200);
  list = await fetch(`http://127.0.0.1:${CDP}/json/list`).then(r => r.json()).catch(() => null);
}
const send = await connect(list.find(t => t.type === 'page').webSocketDebuggerUrl);
const evaluate = async expression => (await send('Runtime.evaluate', { expression, returnByValue: true })).result.value;

await send('Page.navigate', { url: `http://localhost:${PORT}/parent.html` });
await sleep(1500);

const NATIVE = 185, expected = Math.trunc(NATIVE * FACTOR);

// synthesizeScrollGesture emits precise, phased wheel events like a touchpad;
// dispatchMouseEvent mouseWheel always reports whole notches (wheelDeltaY ±120) like a mouse.
const gesture = async (x, y, mouse = false, horizontal = false) => {
  await evaluate('reset()');
  await sleep(300);
  await evaluate('window.childY = 0');
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  const [dx, dy] = horizontal ? [NATIVE, 0] : [0, NATIVE];
  if (mouse) for (let i = 0; i < 5; i++) await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: dx / 5, deltaY: dy / 5 });
  else await send('Input.synthesizeScrollGesture', { x, y, xDistance: -dx, yDistance: -dy, gestureSourceType: 'mouse', speed: 1200 });
  await sleep(700);
  const [outer, child, wide, custom, cal, wheel, childWheel] = await evaluate('[outer.scrollTop, window.childY, wide.scrollLeft, Math.round(window.customX), [cal.scrollLeft, window.calJumps], window.lastWheel, window.childWheel]');
  return { outer, child, wide, custom, cal, wheel, childWheel };
};

const near = (v, want = expected) => Math.abs(v - want) <= 2;
const log = [];
const check = (name, ok, r) => log.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(r)} (scaled ≈ ${expected}, native = ${NATIVE})`);

let r = await gesture(350, 100);
check('parent area: touchpad scaled', near(r.outer), r);
r = await gesture(350, 100, true);
check('parent area: mouse wheel untouched', near(r.outer, NATIVE), r);
r = await gesture(100, 75);
check('non-scrollable iframe hands scaled scroll to parent', near(r.outer) && r.child === 0, r);
r = await gesture(100, 225);
check('scrollable iframe scrolls itself scaled, parent untouched', near(r.child) && r.outer === 0, r);
r = await gesture(450, 40, false, true);
check('horizontal touchpad scaled', near(r.wide) && r.outer === 0, r);
r = await gesture(450, 40, true, true);
check('horizontal mouse wheel untouched', near(r.wide, NATIVE), r);
r = await gesture(450, 140, false, true);
check('site stepping per wheel event: events batched', r.custom >= 1 && r.custom <= 3 && r.outer === 0, r);
r = await gesture(450, 140, true, true);
check('site stepping per wheel event: mouse untouched (5 notches)', r.custom === 5, r);

r = await gesture(450, 240, false, true);
check('Notion-like page (snaps and jumps on wheel): scaled native scroll, no jumps', near(r.cal[0]) && r.cal[1] === 0, r);

console.log(log.join('\n'));
const version = await fetch(`http://127.0.0.1:${CDP}/json/version`).then(r => r.json());
await (await connect(version.webSocketDebuggerUrl))('Browser.close').catch(() => {});
server.close();
await sleep(500);
rmSync(profile, { recursive: true, force: true });
process.exit(log.some(l => l.startsWith('FAIL')) ? 1 : 0);
