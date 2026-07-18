// ==UserScript==
// @name         Notion Locked Launcher
// @namespace    https://github.com/hyugin/quiet-layer
// @version      1.0.1
// @description  Lock a Notion tab as a permanent launcher: navigation links open in new tabs; the locked tab stays put.
// @author       Quiet Layer
// @match        https://www.notion.so/*
// @match        https://notion.so/*
// @match        https://*.notion.so/*
// @match        https://*.notion.site/*
// @match        https://notion.site/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

/*
 * Runs inside AdGuard for Mac's built-in userscript manager (not a browser
 * extension). Paste into AdGuard → Extensions → +. Requires AdGuard protection
 * and HTTPS filtering for notion.so / notion.site in the browser you use
 * (including Firefox / Zen).
 *
 * Usage
 * -----
 * 1. Open Notion → go to your launcher page (e.g. Tasks database).
 * 2. Click “🔓 Lock this tab” (bottom-right) or press Cmd+Shift+L.
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
    console.log.apply(console, args);
  }

  // ---------------------------------------------------------------------------
  // Host / URL helpers
  // ---------------------------------------------------------------------------

  function isNotionHost(hostname) {
    if (!hostname) return false;
    var h = String(hostname).toLowerCase();
    return (
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
        'position:fixed;bottom:56px;right:16px;z-index:2147483646;' +
        'max-width:min(320px,calc(100vw - 32px));' +
        'padding:10px 14px;border-radius:8px;' +
        'background:rgba(15,15,15,.92);color:#f7f6f3;' +
        'font:13px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;' +
        'box-shadow:0 4px 18px rgba(0,0,0,.25);' +
        'opacity:0;transform:translateY(6px);' +
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

  function ensureToggleStyles(doc) {
    if (doc.getElementById('nll-toggle-style')) return;
    var style = doc.createElement('style');
    style.id = 'nll-toggle-style';
    style.textContent =
      '#' + UI_ROOT_ATTR + '-toggle{' +
        'position:fixed;bottom:16px;right:16px;z-index:2147483647;' +
        'display:inline-flex;align-items:center;gap:6px;' +
        'padding:8px 12px;border:1px solid rgba(55,53,47,.16);' +
        'border-radius:999px;cursor:pointer;user-select:none;' +
        'background:rgba(255,255,255,.92);color:#37352f;' +
        'font:12px/1.2 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;' +
        'box-shadow:0 2px 10px rgba(15,15,15,.12);' +
        'backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);' +
        'transition:background .15s ease,border-color .15s ease,color .15s ease;' +
      '}' +
      '#' + UI_ROOT_ATTR + '-toggle:hover{' +
        'background:#fff;border-color:rgba(55,53,47,.28);' +
      '}' +
      '#' + UI_ROOT_ATTR + '-toggle.nll-locked{' +
        'background:rgba(35,131,226,.12);border-color:rgba(35,131,226,.35);' +
        'color:#0B6BCB;' +
      '}' +
      '@media (prefers-color-scheme: dark){' +
        '#' + UI_ROOT_ATTR + '-toggle{' +
          'background:rgba(37,37,37,.92);color:#e8e7e4;' +
          'border-color:rgba(255,255,255,.14);' +
        '}' +
        '#' + UI_ROOT_ATTR + '-toggle:hover{background:#2f2f2f;}' +
        '#' + UI_ROOT_ATTR + '-toggle.nll-locked{' +
          'background:rgba(35,131,226,.22);border-color:rgba(35,131,226,.45);' +
          'color:#79b8ff;' +
        '}' +
      '}';
    (doc.head || doc.documentElement).appendChild(style);
  }

  function updateToggleUi() {
    var btn = document.getElementById(UI_ROOT_ATTR + '-toggle');
    if (!btn) return;
    var locked = readIsLocked();
    btn.textContent = locked ? '🔒 Tab locked' : '🔓 Lock this tab';
    btn.setAttribute('aria-pressed', locked ? 'true' : 'false');
    btn.title = locked
      ? 'Unlock this tab (Ctrl/Cmd+Shift+L)'
      : 'Lock this tab as a Notion launcher (Ctrl/Cmd+Shift+L)';
    if (locked) btn.classList.add('nll-locked');
    else btn.classList.remove('nll-locked');
  }

  function mountToggle() {
    var doc = document;
    if (!doc.documentElement) return;
    ensureToggleStyles(doc);

    var existing = doc.getElementById(UI_ROOT_ATTR + '-toggle');
    if (existing) {
      updateToggleUi();
      return;
    }

    var parent = doc.body || doc.documentElement;
    var btn = doc.createElement('button');
    btn.type = 'button';
    btn.id = UI_ROOT_ATTR + '-toggle';
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
    var obs = new MutationObserver(function () {
      if (!document.getElementById(UI_ROOT_ATTR + '-toggle')) {
        mountToggle();
      }
    });

    function start() {
      var root = document.body || document.documentElement;
      if (!root) return;
      mountToggle();
      try {
        obs.observe(root, { childList: true, subtree: true });
      } catch (e) { /* ignore */ }
    }

    if (document.body) start();
    else {
      document.addEventListener('DOMContentLoaded', start, { once: true });
      // document-start: body may appear before DOMContentLoaded.
      var boot = new MutationObserver(function () {
        if (document.body) {
          boot.disconnect();
          start();
        }
      });
      try {
        boot.observe(document.documentElement || document, {
          childList: true,
          subtree: true
        });
      } catch (e) { /* ignore */ }
    }
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
