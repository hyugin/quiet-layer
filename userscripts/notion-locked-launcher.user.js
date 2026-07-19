// ==UserScript==
// @name         Notion Locked Launcher
// @namespace    https://github.com/hyugin/quiet-layer
// @version      1.2.0
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
 * 2. Press Cmd+Shift+L to lock (same chord unlocks).
 * 3. While locked, the tab title is prefixed with 🔒 (visible in Zen’s sidebar).
 * 4. Sidebar / page / relation links open in a NEW tab; this tab stays put.
 *
 * - State is per-tab via sessionStorage (not shared across tabs).
 * - Click capture handles <a href> navigations.
 * - history.pushState / replaceState guards catch Notion SPA navigations that
 *   skip real anchors (common for sidebar / peek / some buttons).
 *
 * Known limitations
 * -----------------
 * - Pure JS controls with no URL change still won’t be intercepted.
 * - If the browser blocks window.open(), allow pop-ups for Notion.
 */

(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Configuration
  // ---------------------------------------------------------------------------

  /** When true, external (non-Notion) links also open in a new tab from a locked launcher. */
  var INTERCEPT_EXTERNAL_LINKS = false;

  /** Prefix the document/tab title while locked (shows in Zen’s tab sidebar). */
  var SHOW_TITLE_LOCK_INDICATOR = true;

  /** Title prefix used when SHOW_TITLE_LOCK_INDICATOR is on. */
  var TITLE_LOCK_PREFIX = '🔒 ';

  /**
   * Block Notion SPA navigations (pushState/replaceState/popstate) away from
   * the locked URL and open the destination in a new tab instead.
   */
  var GUARD_SPA_NAVIGATION = true;

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
   * Resolve an href (relative or absolute) against a base.
   * Returns null if unresolvable / empty / non-http(s).
   */
  function resolveAbsoluteUrl(href, baseHref) {
    if (!href || typeof href !== 'string') return null;
    var trimmed = href.trim();
    if (!trimmed || trimmed.charAt(0) === '#') return null;
    if (/^(javascript|data|mailto|tel|blob):/i.test(trimmed)) return null;
    try {
      var u = new URL(trimmed, baseHref || location.href);
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
    syncChromeUi();
    showToast('Tab locked — links open in new tabs. (Cmd+Shift+L to unlock)');
  }

  function disableLock() {
    try {
      sessionStorage.removeItem(STORAGE_KEY_LOCKED);
      sessionStorage.removeItem(STORAGE_KEY_URL);
    } catch (e) { /* ignore */ }
    log('Unlocked');
    syncChromeUi();
    showToast('Tab unlocked.');
  }

  function toggleLock() {
    if (readIsLocked()) disableLock();
    else enableLock();
  }

  function syncChromeUi() {
    syncTitleLockIndicator();
  }

  // ---------------------------------------------------------------------------
  // Open URL in a new foreground tab (popup-blocker resilient)
  // ---------------------------------------------------------------------------

  function openInNewTab(url) {
    if (!url) return false;

    var win = null;
    try {
      win = window.open(url, '_blank', 'noopener');
    } catch (e) {
      win = null;
    }
    if (win) return true;

    // Fallback: synthetic <a target=_blank> click — sometimes allowed when
    // window.open is blocked, especially when still inside a user gesture.
    try {
      var root = document.documentElement || document.body;
      if (!root) return false;
      var a = document.createElement('a');
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.setAttribute(UI_ROOT_ATTR, 'open');
      a.style.cssText = 'display:none!important';
      root.appendChild(a);
      a.click();
      if (a.parentNode) a.parentNode.removeChild(a);
      return true;
    } catch (e2) {
      log('openInNewTab failed', e2);
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Tab title indicator (visible in Zen sidebar — no on-page chrome)
  // ---------------------------------------------------------------------------

  var titleSyncing = false;

  function stripTitleLockPrefix(title) {
    var t = String(title || '');
    while (t.indexOf(TITLE_LOCK_PREFIX) === 0) {
      t = t.slice(TITLE_LOCK_PREFIX.length);
    }
    return t;
  }

  function syncTitleLockIndicator() {
    if (!SHOW_TITLE_LOCK_INDICATOR) return;
    titleSyncing = true;
    try {
      var raw = stripTitleLockPrefix(document.title);
      var next = readIsLocked() ? TITLE_LOCK_PREFIX + raw : raw;
      if (document.title !== next) document.title = next;
    } catch (e) { /* ignore */ }
    titleSyncing = false;
  }

  function watchTitleLockIndicator() {
    if (!SHOW_TITLE_LOCK_INDICATOR) return;

    function bindTitleNode(node) {
      if (!node || node.__nllTitleBound) return;
      node.__nllTitleBound = true;
      try {
        new MutationObserver(function () {
          if (titleSyncing) return;
          syncTitleLockIndicator();
        }).observe(node, {
          childList: true,
          characterData: true,
          subtree: true
        });
      } catch (e) { /* ignore */ }
    }

    function ensure() {
      syncTitleLockIndicator();
      var titleEl = document.querySelector('title');
      if (titleEl) bindTitleNode(titleEl);
    }

    ensure();
    try {
      new MutationObserver(ensure).observe(document.documentElement || document, {
        childList: true,
        subtree: true
      });
    } catch (e) { /* ignore */ }
    try {
      setInterval(syncTitleLockIndicator, 2000);
    } catch (e2) { /* ignore */ }
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
  // Click interception (<a href>)
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

  function shouldOpenDestination(dest) {
    if (!dest) return false;
    if (!readIsLocked()) return false;

    var lockedUrl = readLockedUrl();
    if (!lockedUrl) {
      lockedUrl = location.href;
      try {
        sessionStorage.setItem(STORAGE_KEY_URL, lockedUrl);
      } catch (err) { /* ignore */ }
    }

    var destIsNotion = isNotionUrl(dest);
    if (!destIsNotion && !INTERCEPT_EXTERNAL_LINKS) {
      log('Skip: external link (INTERCEPT_EXTERNAL_LINKS=false)', dest);
      return false;
    }

    if (!isMeaningfullyDifferentUrl(dest, lockedUrl)) {
      log('Skip: destination matches locked URL', dest);
      return false;
    }

    if (!isMeaningfullyDifferentUrl(dest, location.href)) {
      log('Skip: destination matches current location', dest);
      return false;
    }

    return true;
  }

  /**
   * Capturing-phase handler. Runs before Notion’s React listeners so we can
   * stop SPA routing for locked-tab navigations.
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

    var dest = resolveAbsoluteUrl(anchor.getAttribute('href'));
    if (!shouldOpenDestination(dest)) return;

    log('Intercept click → new tab', dest);

    e.preventDefault();
    e.stopPropagation();
    if (typeof e.stopImmediatePropagation === 'function') {
      e.stopImmediatePropagation();
    }

    if (!openInNewTab(dest)) {
      showToast('Pop-up blocked — allow pop-ups for Notion, then try again.');
      log('openInNewTab blocked for', dest);
    }
  }

  // Install as early as possible (@run-at document-start).
  document.addEventListener('click', onClickCapture, true);

  // ---------------------------------------------------------------------------
  // SPA navigation guard (pushState / replaceState / popstate)
  // ---------------------------------------------------------------------------

  var restoringHome = false;

  function shouldBlockHistoryUrl(url) {
    if (!GUARD_SPA_NAVIGATION) return false;
    if (!readIsLocked() || restoringHome) return false;
    if (url == null || url === '') return false;
    var abs = resolveAbsoluteUrl(String(url), location.href);
    return shouldOpenDestination(abs) ? abs : null;
  }

  function blockHistoryAndOpen(abs) {
    log('Intercept history → new tab', abs);
    if (!openInNewTab(abs)) {
      showToast('Pop-up blocked — allow pop-ups for Notion, then try again.');
    }
    // Do not apply the history mutation — launcher tab stays on locked URL.
  }

  function installHistoryGuards() {
    if (!GUARD_SPA_NAVIGATION) return;
    if (history.__nllGuarded) return;
    history.__nllGuarded = true;

    var origPush = history.pushState;
    var origReplace = history.replaceState;

    history.pushState = function (state, title, url) {
      var blocked = shouldBlockHistoryUrl(url);
      if (blocked) {
        blockHistoryAndOpen(blocked);
        return;
      }
      return origPush.apply(this, arguments);
    };

    history.replaceState = function (state, title, url) {
      var blocked = shouldBlockHistoryUrl(url);
      if (blocked) {
        blockHistoryAndOpen(blocked);
        return;
      }
      return origReplace.apply(this, arguments);
    };

    window.addEventListener('popstate', function () {
      if (!GUARD_SPA_NAVIGATION || !readIsLocked() || restoringHome) return;
      var locked = readLockedUrl();
      if (!locked) return;
      if (!isMeaningfullyDifferentUrl(location.href, locked)) return;

      var drifted = location.href;
      log('popstate drift → new tab + restore', drifted);
      openInNewTab(drifted);
      restoringHome = true;
      try {
        location.replace(locked);
      } catch (e) {
        restoringHome = false;
      }
    });
  }

  installHistoryGuards();

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

    // Global toggle (launcher use-case); skip only during IME composition.
    if (e.isComposing) return;

    e.preventDefault();
    e.stopPropagation();
    toggleLock();
  }

  window.addEventListener('keydown', onKeyDown, true);

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------

  watchTitleLockIndicator();
  syncChromeUi();
  log('Initialized; locked=', readIsLocked(), 'url=', readLockedUrl());
})();
