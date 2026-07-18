// ==UserScript==
// @name         Notion Locked Launcher
// @namespace    https://github.com/hyugin/quiet-layer
// @version      1.0.3
// @description  Lock a Notion tab as a permanent launcher: navigation links open in new tabs; the locked tab stays put.
// @author       Quiet Layer
// @match        https://www.notion.com/*
// @match        https://notion.com/*
// @match        https://*.notion.com/*
// @match        https://www.notion.so/*
// @match        https://notion.so/*
// @match        https://*.notion.so/*
// @match        https://*.notion.site/*
// @match        https://notion.site/*
// @include      *://www.notion.com/*
// @include      *://notion.com/*
// @include      *://*.notion.com/*
// @include      *://www.notion.so/*
// @include      *://notion.so/*
// @include      *://*.notion.so/*
// @include      *://*.notion.site/*
// @include      *://notion.site/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

/*
 * Runs inside AdGuard for Mac's built-in userscript manager (not a browser
 * extension). Paste into AdGuard → Extensions → +. Requires AdGuard protection
 * and HTTPS filtering for notion.com (primary), plus notion.so / notion.site.
 *
 * Zen Browser: AdGuard does not always filter Zen by default. Add Zen in
 * AdGuard → Settings → Network → filtered applications (+ → Zen.app), then
 * fully close Notion tabs and reopen. Confirm in DevTools console:
 *   [Notion Locked Launcher] active
 *
 * Usage
 * -----
 * 1. Open Notion → go to your launcher page (e.g. Tasks database).
 * 2. Click “🔓 Lock this tab” (top-right) or press Cmd+Shift+L.
 * 3. Sidebar / page / relation links open in a NEW tab; this tab stays put.
 * 4. Unlock with the same control or shortcut.
 *
 * - State is per-tab via sessionStorage (not shared across tabs).
 * - Unlock clears saved state for this tab.
 *
 * Design (v1)
 * -----------
 * - Capturing-phase click delegation on document finds closest <a href>.
 * - When locked and the destination differs from lockedUrl, prevent SPA
 *   navigation and window.open() the destination in a new foreground tab.
 * - Floating toggle is re-injected via MutationObserver if React removes it.
 * - No history.pushState / location patching in v1.
 *
 * Known limitations
 * -----------------
 * - Direct programmatic Notion navigation that does NOT go through an
 *   <a href> click is intentionally out of scope for v1 (no history hooks).
 * - Some Notion controls use buttons/divs with JS handlers, not anchors —
 *   those are left alone so editing / filters / menus keep working.
 * - If the browser blocks window.open(), allow pop-ups for Notion.
 */

(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Configuration
  // ---------------------------------------------------------------------------

  /** When true, external (non-Notion) links also open in a new tab from a locked launcher. */
  var INTERCEPT_EXTERNAL_LINKS = false;

  /** When true, log lock / intercept decisions to the console. */
  var DEBUG = false;

  /** sessionStorage keys — per-tab only (not localStorage). */
  var STORAGE_KEY_LOCKED = 'notionLockedLauncher.isLocked';
  var STORAGE_KEY_URL = 'notionLockedLauncher.lockedUrl';

  /** Marker attribute so we never intercept our own UI. */
  var UI_ROOT_ATTR = 'data-notion-locked-launcher';

  /** Toast display duration (ms). */
  var TOAST_MS = 2200;

  // ---------------------------------------------------------------------------
  // Guard against double-injection
  // ---------------------------------------------------------------------------

  if (window.__notionLockedLauncher) return;
  window.__notionLockedLauncher = true;

  // ---------------------------------------------------------------------------
  // Debug helper
  // ---------------------------------------------------------------------------

  function log() {
    if (!DEBUG) return;
    var args = Array.prototype.slice.call(arguments);
    args.unshift('[Notion Locked Launcher]');
    try {
      console.log.apply(console, args);
    } catch (e) { /* ignore */ }
  }

  // Always announce once so Zen/AdGuard injection can be verified in DevTools.
  try {
    console.info('[Notion Locked Launcher] active — Cmd+Shift+L to lock/unlock');
  } catch (e) { /* ignore */ }

  // ---------------------------------------------------------------------------
  // Host / URL helpers
  // ---------------------------------------------------------------------------

  function isNotionHost(hostname) {
    if (!hostname) return false;
    var h = String(hostname).toLowerCase();
    // notion.com is the current app host; .so / .site still appear for
    // redirects, public pages, and older workspace URLs.
    return (
      h === 'notion.com' ||
      h.endsWith('.notion.com') ||
      h === 'notion.so' ||
      h.endsWith('.notion.so') ||
      h === 'notion.site' ||
      h.endsWith('.notion.site')
    );
  }

  function isNotionUrl(url) {
    try {
      return isNotionHost(new URL(url, location.href).hostname);
    } catch (e) {
      return false;
    }
  }

  /**
   * Resolve an href (relative or absolute) against the current location.
   * Returns null if unresolvable / empty / non-http(s).
   */
  function resolveAbsoluteUrl(href) {
    if (!href || typeof href !== 'string') return null;
    var trimmed = href.trim();
    if (!trimmed || trimmed.charAt(0) === '#') return null;
    if (/^(javascript|data|mailto|tel|blob):/i.test(trimmed)) return null;
    try {
      var u = new URL(trimmed, location.href);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
      return u.href;
    } catch (e) {
      return null;
    }
  }

  /**
   * Whether destination meaningfully navigates away from lockedUrl.
   * Compares origin + pathname + search; ignores hash-only differences
   * (Notion often uses fragments without leaving the page).
   */
  function isMeaningfullyDifferentUrl(destinationHref, lockedHref) {
    if (!destinationHref || !lockedHref) return true;
    try {
      var dest = new URL(destinationHref);
      var locked = new URL(lockedHref);
      return (
        dest.origin !== locked.origin ||
        dest.pathname !== locked.pathname ||
        dest.search !== locked.search
      );
    } catch (e) {
      return destinationHref !== lockedHref;
    }
  }

  // ---------------------------------------------------------------------------
  // Lock state (sessionStorage — tab-scoped)
  // ---------------------------------------------------------------------------

  function readIsLocked() {
    try {
      return sessionStorage.getItem(STORAGE_KEY_LOCKED) === '1';
    } catch (e) {
      return false;
    }
  }

  function readLockedUrl() {
    try {
      return sessionStorage.getItem(STORAGE_KEY_URL) || '';
    } catch (e) {
      return '';
    }
  }

  function enableLock() {
    var url = location.href;
    try {
      sessionStorage.setItem(STORAGE_KEY_LOCKED, '1');
      sessionStorage.setItem(STORAGE_KEY_URL, url);
    } catch (e) {
      showToast('Could not save lock state (sessionStorage blocked).');
      return;
    }
    log('Locked to', url);
    updateToggleUi();
    showToast('Tab locked — links open in new tabs.');
  }

  function disableLock() {
    try {
      sessionStorage.removeItem(STORAGE_KEY_LOCKED);
      sessionStorage.removeItem(STORAGE_KEY_URL);
    } catch (e) { /* ignore */ }
    log('Unlocked');
    updateToggleUi();
    showToast('Tab unlocked.');
  }

  function toggleLock() {
    if (readIsLocked()) disableLock();
    else enableLock();
  }

  // ---------------------------------------------------------------------------
  // Toast
  // ---------------------------------------------------------------------------

  var toastTimer = null;

  function ensureToastStyles(doc) {
    if (doc.getElementById('nll-toast-style')) return;
    var style = doc.createElement('style');
    style.id = 'nll-toast-style';
    style.textContent =
      '#' + UI_ROOT_ATTR + '-toast{' +
        'position:fixed;top:52px;right:12px;z-index:2147483646;' +
        'max-width:min(320px,calc(100vw - 32px));' +
        'padding:10px 14px;border-radius:8px;' +
        'background:rgba(15,15,15,.92);color:#f7f6f3;' +
        'font:13px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;' +
        'box-shadow:0 4px 18px rgba(0,0,0,.25);' +
        'opacity:0;transform:translateY(-6px);' +
        'transition:opacity .18s ease,transform .18s ease;' +
        'pointer-events:none;' +
      '}' +
      '#' + UI_ROOT_ATTR + '-toast.nll-show{' +
        'opacity:1;transform:translateY(0);' +
      '}';
    (doc.head || doc.documentElement).appendChild(style);
  }

  function showToast(message) {
    var doc = document;
    if (!doc.documentElement) return;
    ensureToastStyles(doc);

    var el = doc.getElementById(UI_ROOT_ATTR + '-toast');
    if (!el) {
      el = doc.createElement('div');
      el.id = UI_ROOT_ATTR + '-toast';
      el.setAttribute(UI_ROOT_ATTR, 'toast');
      (doc.body || doc.documentElement).appendChild(el);
    }
    el.textContent = message;
    // Force reflow so re-showing the same message still animates.
    void el.offsetWidth;
    el.classList.add('nll-show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.classList.remove('nll-show');
    }, TOAST_MS);
  }

  // ---------------------------------------------------------------------------
  // Floating toggle UI
  // ---------------------------------------------------------------------------

  var TOGGLE_ID = 'nll-lock-toggle';

  /** Inline styles survive Notion style resets better than a stylesheet alone. */
  function applyToggleInlineStyles(btn, locked) {
    btn.style.cssText = [
      'position:fixed',
      'top:12px',
      'right:12px',
      'z-index:2147483647',
      'display:inline-flex',
      'align-items:center',
      'gap:6px',
      'padding:8px 12px',
      'margin:0',
      'border:1px solid ' + (locked ? 'rgba(35,131,226,.45)' : 'rgba(55,53,47,.22)'),
      'border-radius:999px',
      'cursor:pointer',
      'user-select:none',
      '-webkit-user-select:none',
      'background:' + (locked ? 'rgba(35,131,226,.18)' : 'rgba(255,255,255,.96)'),
      'color:' + (locked ? '#0B6BCB' : '#37352f'),
      'font:12px/1.2 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
      'box-shadow:0 2px 12px rgba(15,15,15,.18)',
      'backdrop-filter:blur(8px)',
      '-webkit-backdrop-filter:blur(8px)',
      'pointer-events:auto',
      'opacity:1',
      'visibility:visible',
      'transform:none'
    ].join(';');
  }

  function ensureToggleStyles(doc) {
    if (doc.getElementById('nll-toggle-style')) return;
    var style = doc.createElement('style');
    style.id = 'nll-toggle-style';
    style.textContent =
      '#' + TOGGLE_ID + '{' +
        'position:fixed!important;top:12px!important;right:12px!important;' +
        'z-index:2147483647!important;pointer-events:auto!important;' +
      '}' +
      '#' + UI_ROOT_ATTR + '-toast{pointer-events:none!important;}';
    (doc.head || doc.documentElement).appendChild(style);
  }

  function updateToggleUi() {
    var btn = document.getElementById(TOGGLE_ID);
    if (!btn) return;
    var locked = readIsLocked();
    btn.textContent = locked ? '🔒 Tab locked' : '🔓 Lock this tab';
    btn.setAttribute('aria-pressed', locked ? 'true' : 'false');
    btn.title = locked
      ? 'Unlock this tab (Cmd+Shift+L)'
      : 'Lock this tab as a Notion launcher (Cmd+Shift+L)';
    applyToggleInlineStyles(btn, locked);
  }

  function mountToggle() {
    var doc = document;
    if (!doc.documentElement) return;
    ensureToggleStyles(doc);

    var existing = doc.getElementById(TOGGLE_ID);
    if (existing) {
      // Notion sometimes moves nodes; keep ours on documentElement.
      if (existing.parentNode !== doc.documentElement &&
          existing.parentNode !== doc.body) {
        (doc.documentElement || doc.body).appendChild(existing);
      }
      updateToggleUi();
      return;
    }

    var parent = doc.documentElement || doc.body;
    if (!parent) return;

    var btn = doc.createElement('button');
    btn.type = 'button';
    btn.id = TOGGLE_ID;
    btn.setAttribute(UI_ROOT_ATTR, 'toggle');
    btn.setAttribute('aria-label', 'Toggle Notion locked launcher for this tab');

    // Keep Notion from treating this as a page interaction / selection start.
    function stopNotion(e) {
      e.stopPropagation();
    }
    btn.addEventListener('mousedown', stopNotion, true);
    btn.addEventListener('mouseup', stopNotion, true);
    btn.addEventListener('pointerdown', stopNotion, true);
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
      toggleLock();
    }, true);

    parent.appendChild(btn);
    updateToggleUi();
    log('Toggle mounted');
  }

  /**
   * Notion React trees re-render often. Re-attach the floating control if it
   * disappears, without depending on Notion-specific sidebar selectors.
   */
  function watchToggleSurvival() {
    var started = false;
    var obs = new MutationObserver(function () {
      if (!document.getElementById(TOGGLE_ID)) {
        mountToggle();
      }
    });

    function start() {
      if (started) {
        mountToggle();
        return;
      }
      var root = document.documentElement || document.body;
      if (!root) return;
      started = true;
      mountToggle();
      try {
        obs.observe(root, { childList: true, subtree: true });
      } catch (e) { /* ignore */ }
      // Belt-and-suspenders for aggressive SPA remounts (Zen/Firefox + Notion).
      try {
        setInterval(function () {
          if (!document.getElementById(TOGGLE_ID)) mountToggle();
        }, 1500);
      } catch (e2) { /* ignore */ }
    }

    if (document.documentElement || document.body) start();
    document.addEventListener('DOMContentLoaded', start, { once: true });
    try {
      var boot = new MutationObserver(function () {
        if (document.documentElement || document.body) {
          boot.disconnect();
          start();
        }
      });
      boot.observe(document, { childList: true, subtree: true });
    } catch (e) { /* ignore */ }
    // Late safety net if document-start observers miss the first paint.
    try {
      setTimeout(start, 0);
      setTimeout(start, 500);
      setTimeout(start, 2000);
    } catch (e3) { /* ignore */ }
  }

  // ---------------------------------------------------------------------------
  // Click interception
  // ---------------------------------------------------------------------------

  function isModifiedClick(e) {
    return !!(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey);
  }

  function isOurUi(node) {
    if (!node || node.nodeType !== 1) return false;
    return !!(node.closest && node.closest('[' + UI_ROOT_ATTR + ']'));
  }

  function shouldSkipAnchor(anchor) {
    if (!anchor) return true;

    // Already opens in a new tab / window — leave browser defaults alone.
    var target = (anchor.getAttribute('target') || '').toLowerCase();
    if (target === '_blank' || target === '_new') return true;

    // Download attribute — not a navigation we should redirect.
    if (anchor.hasAttribute('download')) return true;

    // Empty / placeholder hrefs.
    var hrefAttr = anchor.getAttribute('href');
    if (hrefAttr == null) return true;
    var href = String(hrefAttr).trim();
    if (!href || href === '#' || href.indexOf('javascript:') === 0) return true;

    return false;
  }

  /**
   * Capturing-phase handler. Runs before Notion’s React listeners so we can
   * stop SPA routing for locked-tab navigations.
   *
   * NOTE (v1 scope): Direct programmatic Notion navigation that does not go
   * through an anchor click (e.g. internal router calls without an <a href>)
   * is intentionally out of scope — we do not patch history.pushState or
   * window.location.
   */
  function onClickCapture(e) {
    // Only primary (left) button, unmodified.
    if (e.button !== 0) return;
    if (e.defaultPrevented) return;
    if (isModifiedClick(e)) {
      log('Skip: modified click');
      return;
    }

    var pathTarget = e.target;
    if (!pathTarget || !pathTarget.closest) return;
    if (isOurUi(pathTarget)) return;

    var anchor = pathTarget.closest('a[href]');
    if (!anchor) return;
    if (isOurUi(anchor)) return;
    if (shouldSkipAnchor(anchor)) {
      log('Skip: non-navigational or _blank/download anchor');
      return;
    }

    if (!readIsLocked()) return;

    var lockedUrl = readLockedUrl();
    if (!lockedUrl) {
      // Recover: treat current URL as locked if flag is set without URL.
      lockedUrl = location.href;
      try {
        sessionStorage.setItem(STORAGE_KEY_URL, lockedUrl);
      } catch (err) { /* ignore */ }
    }

    var dest = resolveAbsoluteUrl(anchor.getAttribute('href'));
    if (!dest) {
      log('Skip: could not resolve href', anchor.getAttribute('href'));
      return;
    }

    var destIsNotion = isNotionUrl(dest);
    if (!destIsNotion && !INTERCEPT_EXTERNAL_LINKS) {
      log('Skip: external link (INTERCEPT_EXTERNAL_LINKS=false)', dest);
      return;
    }

    // Same page (ignoring hash) — do not open a duplicate tab.
    if (!isMeaningfullyDifferentUrl(dest, lockedUrl)) {
      log('Skip: destination matches locked URL', dest);
      return;
    }

    // Also skip if destination equals the current location (same rules) —
    // keeps us from fighting in-page hash or no-op links while locked.
    if (!isMeaningfullyDifferentUrl(dest, location.href)) {
      log('Skip: destination matches current location', dest);
      return;
    }

    log('Intercept → new tab', dest);

    e.preventDefault();
    e.stopPropagation();
    if (typeof e.stopImmediatePropagation === 'function') {
      e.stopImmediatePropagation();
    }

    // window.open from a trusted click gesture → foreground tab in Firefox.
    var win = null;
    try {
      win = window.open(dest, '_blank', 'noopener');
    } catch (err) {
      win = null;
    }

    if (!win) {
      showToast('Pop-up blocked — allow pop-ups for Notion, then try again.');
      log('window.open blocked for', dest);
    }
  }

  // Install as early as possible (@run-at document-start).
  document.addEventListener('click', onClickCapture, true);

  // ---------------------------------------------------------------------------
  // Keyboard shortcut: Cmd+Shift+L (macOS) / Ctrl+Shift+L (elsewhere)
  // ---------------------------------------------------------------------------

  function onKeyDown(e) {
    if (e.defaultPrevented) return;
    var key = e.key || e.code;
    var isL = key === 'L' || key === 'l' || key === 'KeyL';
    if (!isL || !e.shiftKey) return;

    // macOS: metaKey; elsewhere: ctrlKey. Avoid requiring both.
    var isMac = false;
    try {
      isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform || '') ||
        (navigator.userAgentData && navigator.userAgentData.platform === 'macOS');
    } catch (err) { /* ignore */ }

    var chord = isMac ? e.metaKey && !e.ctrlKey && !e.altKey
                      : e.ctrlKey && !e.metaKey && !e.altKey;
    if (!chord) return;

    // Don’t steal the shortcut from editable fields unless we still want
    // global toggle — launcher use-case prefers global, so allow it, but
    // skip when an IME composition is active.
    if (e.isComposing) return;

    e.preventDefault();
    e.stopPropagation();
    toggleLock();
  }

  window.addEventListener('keydown', onKeyDown, true);

  // ---------------------------------------------------------------------------
  // Boot UI
  // ---------------------------------------------------------------------------

  watchToggleSurvival();
  log('Initialized; locked=', readIsLocked(), 'url=', readLockedUrl());
})();
