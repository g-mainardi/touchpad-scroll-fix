# Touchpad Scroll Fix

A Chrome extension that tames touchpad scroll sensitivity on Linux (GNOME/Wayland) without touching the mouse wheel.

Chromium applies GNOME's high-resolution touchpad deltas without the damping Firefox and GTK apps use, so touchpad scrolling in Chrome feels several times too fast.

## Install

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and pick this folder.

With Flatpak Chrome the folder must live somewhere the sandbox can read, such as `~/Documents`.

## How it works

- The device is decided on the first event of each gesture: mouse wheels send whole notches (`wheelDelta` multiple of 120), touchpads arbitrary values.
- For touchpad gestures, vertical and horizontal, it cancels native scrolling and scrolls the same element by `delta × sensitivity`, carrying fractional pixels over.
- Sites that scroll on wheel themselves (Notion Calendar, maps, carousels) receive a copy of the event with scaled deltas instead of the real one. Since some of them move a fixed step per event (Notion Calendar: one day), after the first event of a gesture the copies are batched, one every 40 scaled pixels.
- When a gesture starts in an iframe with nothing left to scroll, the scaled scroll is handed to the parent page, like native scroll chaining. The frame is identified via `postMessage`, while the amounts travel through extension messaging, so page scripts can't forge scrolling.
- Mouse wheel, pinch zoom (Ctrl) and scroll-locked pages are left alone.
- The popup sets the sensitivity, has a test area that scrolls both ways, can open in its own window and switches the UI between English and Italian.

Settings live in `chrome.storage.local`: every tab, window and frame picks up changes immediately, and they survive restarts. Moving the folder gives the unpacked extension a new ID, which resets them.

## Development

- `test.html` checks the core logic with synthetic events: open it in Chrome and read PASS/FAIL, or run it headless:
  `google-chrome --headless --allow-file-access-from-files --virtual-time-budget=3000 --dump-dom file://$PWD/test.html`
- `test-iframe.mjs` drives headless Chrome with real input over the DevTools Protocol to cover touchpad and mouse wheel on both axes, sites that handle wheel themselves and the iframe hand-off: `node test-iframe.mjs` (uses Flatpak Chrome by default, or `CHROME=google-chrome`).
- `icons/*.svg` are the sources of the PNG icons.
- After a change, reload the extension from `chrome://extensions`; if `content.js` changed, reload open tabs too.
