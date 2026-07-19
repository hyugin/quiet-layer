// ==UserScript==
// @name         Notion Locked Launcher
// @namespace    https://github.com/hyugin/quiet-layer
// @version      1.3.3
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
 * 2. Lock with Cmd+Shift+L (primary). A thin blue right-edge rail appears
 *    while locked; click it to unlock. (See UI_VARIANT for other designs.)
 * 3. Sidebar / page / relation links open in a NEW tab; this tab stays put.
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

  /**
   * Show launcher UI. Set false to rely on the keyboard shortcut only.
   */
  var SHOW_PEEK_TOGGLE = true;

  /**
   * Which lock UI to show:
   *   'indicator' — (default) nothing when unlocked; blue hairline rail when locked
   *   'all' — mount variants 1–6 stacked (A/B test)
   *   1 — Hairline rail (always visible)
   *   2 — Corner pin
   *   3 — Status dot + keyboard hint
   *   4 — Notion-native top bar (centered)
   *   5 — Locked-only “Launcher” chip
   *   6 — Segmented Free | Launcher
   * Alt+click a control to cycle (sessionStorage override for this tab).
   */
  var UI_VARIANT = 'indicator';

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
  /** Bumped key so older A/B session overrides don’t stick after the default change. */
  var STORAGE_KEY_VARIANT = 'notionLockedLauncher.uiVariant.v2';

  /** Marker attribute so we never intercept our own UI. */
  var UI_ROOT_ATTR = 'data-notion-locked-launcher';

  /** Toast display duration (ms). */
  var TOAST_MS = 2200;

  var VARIANT_META = {
    indicator: { id: 'indicator', name: 'Locked rail' },
    1: { id: 'rail', name: 'Hairline rail' },
    2: { id: 'pin', name: 'Corner pin' },
    3: { id: 'dot', name: 'Status dot' },
    4: { id: 'topbar', name: 'Top bar' },
    5: { id: 'lockedonly', name: 'Locked-only' },
    6: { id: 'segment', name: 'Segmented' }
  };

  var VARIANT_CYCLE = ['indicator', 1, 2, 3, 4, 5, 6, 'all'];

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
    console.info('[Notion Locked Launcher] v1.3.3 active — Cmd+Shift+L; blue rail when locked');
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
    if (SHOW_PEEK_TOGGLE) updateLauncherUi();
    else removeLauncherUi();
  }

  /** One-time cleanup if an older build left a 🔒 title prefix. */
  function clearLegacyTitleLockPrefix() {
    try {
      var t = String(document.title || '');
      var next = t.replace(/^🔒\s+/, '');
      if (next !== t) document.title = next;
    } catch (e) { /* ignore */ }
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
  // Launcher UI variants (1–6, or 'all' for side-by-side test)
  // ---------------------------------------------------------------------------

  var UI_ROOT_ID = 'nll-ui-root';
  var STYLE_ID = 'nll-ui-style';

  function svgPin(filled) {
    // Simple thumbtack / map-pin silhouette
    if (filled) {
      return '<svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">' +
        '<path fill="currentColor" d="M8 1.5a3.2 3.2 0 0 0-1.1 6.2V13a1.1 1.1 0 0 0 2.2 0V7.7A3.2 3.2 0 0 0 8 1.5z"/>' +
        '</svg>';
    }
    return '<svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">' +
      '<path fill="none" stroke="currentColor" stroke-width="1.4" ' +
      'd="M8 2.2a2.6 2.6 0 0 0-.9 5V13a.9.9 0 0 0 1.8 0V7.2a2.6 2.6 0 0 0-.9-5z"/>' +
      '</svg>';
  }

  function parseVariantToken(raw) {
    if (raw === 'all' || raw === 'indicator') return raw;
    var n = parseInt(raw, 10);
    if (n >= 1 && n <= 6) return n;
    return null;
  }

  function readUiVariantPref() {
    try {
      return parseVariantToken(sessionStorage.getItem(STORAGE_KEY_VARIANT));
    } catch (e) {
      return null;
    }
  }

  function writeUiVariantPref(value) {
    try {
      sessionStorage.setItem(STORAGE_KEY_VARIANT, String(value));
    } catch (e) { /* ignore */ }
  }

  /** Effective variant: session override → config. */
  function getUiVariant() {
    var pref = readUiVariantPref();
    if (pref != null) return pref;
    var fromConfig = parseVariantToken(UI_VARIANT);
    if (fromConfig != null) return fromConfig;
    return 'indicator';
  }

  function variantsToMount() {
    var v = getUiVariant();
    if (v === 'all') return [1, 2, 3, 4, 5, 6];
    return [v];
  }

  function isAllMode() {
    return getUiVariant() === 'all';
  }

  function variantLabel(v) {
    if (v === 'all') return 'all six (test)';
    if (VARIANT_META[v]) return String(v) + ' · ' + VARIANT_META[v].name;
    return String(v);
  }

  function cycleUiVariant() {
    var current = getUiVariant();
    var idx = -1;
    for (var i = 0; i < VARIANT_CYCLE.length; i++) {
      if (VARIANT_CYCLE[i] === current) { idx = i; break; }
    }
    var next = VARIANT_CYCLE[(idx + 1) % VARIANT_CYCLE.length];
    writeUiVariantPref(next);
    showToast('UI variant: ' + variantLabel(next));
    remountLauncherUi();
  }

  function ensureLauncherStyles(doc) {
    var existing = doc.getElementById(STYLE_ID);
    if (existing) {
      try { existing.parentNode.removeChild(existing); } catch (e) { /* ignore */ }
    }
    var style = doc.createElement('style');
    style.id = STYLE_ID;
    style.textContent =
      /* Shared */
      '#' + UI_ROOT_ID + '{' +
        'position:fixed!important;inset:0!important;pointer-events:none!important;' +
        'z-index:2147483647!important;' +
      '}' +
      '#' + UI_ROOT_ID + ' [data-nll-variant]{' +
        'pointer-events:auto!important;box-sizing:border-box!important;' +
        'font:11px/1.2 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif!important;' +
        'letter-spacing:.01em!important;cursor:pointer!important;user-select:none!important;' +
        'margin:0!important;-webkit-appearance:none!important;appearance:none!important;' +
      '}' +
      '#' + UI_ROOT_ID + ' .nll-tag{' +
        'position:absolute!important;left:-18px!important;top:50%!important;' +
        'transform:translateY(-50%)!important;' +
        'width:14px!important;height:14px!important;border-radius:3px!important;' +
        'background:rgba(15,15,15,.72)!important;color:#fff!important;' +
        'font:10px/14px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif!important;' +
        'text-align:center!important;pointer-events:none!important;' +
      '}' +
      '#' + UI_ROOT_ID + ' .nll-tag.nll-tag-top{' +
        'left:auto!important;right:0!important;top:-16px!important;transform:none!important;' +
      '}' +

      /* indicator — locked-only blue hairline (keyboard-first default) */
      '#' + UI_ROOT_ID + ' .nll-v-indicator{' +
        'position:absolute!important;top:10%!important;right:0!important;' +
        'display:none!important;align-items:center!important;gap:8px!important;' +
        'height:70px!important;padding:0 10px 0 0!important;' +
        'border:none!important;background:transparent!important;color:#0B6BCB!important;' +
        'transform:translateX(calc(100% - 4px))!important;' +
        'transition:transform .18s ease,opacity .15s ease!important;' +
        'opacity:0!important;pointer-events:none!important;' +
      '}' +
      '#' + UI_ROOT_ID + ' .nll-v-indicator::before{' +
        'content:""!important;display:block!important;width:4px!important;height:100%!important;' +
        'border-radius:2px 0 0 2px!important;background:#2383e2!important;' +
        'flex:0 0 auto!important;box-shadow:-1px 0 6px rgba(35,131,226,.35)!important;' +
        'transition:width .15s ease!important;' +
      '}' +
      '#' + UI_ROOT_ID + ' .nll-v-indicator .nll-label{' +
        'opacity:0!important;white-space:nowrap!important;' +
        'transition:opacity .15s ease!important;' +
        'color:#0B6BCB!important;font-weight:500!important;' +
      '}' +
      '#' + UI_ROOT_ID + ' .nll-v-indicator[aria-pressed="true"]{' +
        'display:inline-flex!important;opacity:.95!important;pointer-events:auto!important;' +
      '}' +
      '#' + UI_ROOT_ID + ' .nll-v-indicator[aria-pressed="true"]:hover,#' + UI_ROOT_ID + ' .nll-v-indicator[aria-pressed="true"]:focus-visible,#' + UI_ROOT_ID + ' .nll-v-indicator[aria-pressed="true"].nll-expanded{' +
        'transform:translateX(0)!important;opacity:1!important;outline:none!important;' +
      '}' +
      '#' + UI_ROOT_ID + ' .nll-v-indicator[aria-pressed="true"]:hover::before,#' + UI_ROOT_ID + ' .nll-v-indicator[aria-pressed="true"]:focus-visible::before,#' + UI_ROOT_ID + ' .nll-v-indicator[aria-pressed="true"].nll-expanded::before{' +
        'width:5px!important;' +
      '}' +
      '#' + UI_ROOT_ID + ' .nll-v-indicator[aria-pressed="true"]:hover .nll-label,#' + UI_ROOT_ID + ' .nll-v-indicator[aria-pressed="true"]:focus-visible .nll-label,#' + UI_ROOT_ID + ' .nll-v-indicator[aria-pressed="true"].nll-expanded .nll-label{' +
        'opacity:1!important;' +
      '}' +

      /* 1 — Hairline rail */
      '#' + UI_ROOT_ID + ' .nll-v-rail{' +
        'position:absolute!important;top:72px!important;right:0!important;' +
        'display:inline-flex!important;align-items:center!important;gap:8px!important;' +
        'height:36px!important;padding:0 10px 0 0!important;' +
        'border:none!important;background:transparent!important;color:#37352f!important;' +
        'transform:translateX(calc(100% - 3px))!important;' +
        'transition:transform .18s ease,opacity .15s ease!important;opacity:.55!important;' +
      '}' +
      '#' + UI_ROOT_ID + ' .nll-v-rail::before{' +
        'content:""!important;display:block!important;width:3px!important;height:100%!important;' +
        'border-radius:2px 0 0 2px!important;background:rgba(55,53,47,.28)!important;' +
        'flex:0 0 auto!important;transition:background .15s ease,width .15s ease!important;' +
      '}' +
      '#' + UI_ROOT_ID + ' .nll-v-rail .nll-label{' +
        'opacity:0!important;transform:translateX(6px)!important;' +
        'transition:opacity .15s ease,transform .15s ease!important;white-space:nowrap!important;' +
        'color:#37352f!important;' +
      '}' +
      '#' + UI_ROOT_ID + ' .nll-v-rail:hover,#' + UI_ROOT_ID + ' .nll-v-rail:focus-visible,#' + UI_ROOT_ID + ' .nll-v-rail.nll-expanded{' +
        'transform:translateX(0)!important;opacity:1!important;outline:none!important;' +
      '}' +
      '#' + UI_ROOT_ID + ' .nll-v-rail:hover .nll-label,#' + UI_ROOT_ID + ' .nll-v-rail:focus-visible .nll-label,#' + UI_ROOT_ID + ' .nll-v-rail.nll-expanded .nll-label{' +
        'opacity:1!important;transform:translateX(0)!important;' +
      '}' +
      '#' + UI_ROOT_ID + ' .nll-v-rail[aria-pressed="true"]{' +
        'opacity:.9!important;transform:translateX(calc(100% - 4px))!important;' +
      '}' +
      '#' + UI_ROOT_ID + ' .nll-v-rail[aria-pressed="true"]::before{' +
        'width:4px!important;background:#2383e2!important;' +
      '}' +
      '#' + UI_ROOT_ID + ' .nll-v-rail[aria-pressed="true"] .nll-label{color:#0B6BCB!important;}' +
      '#' + UI_ROOT_ID + ' .nll-v-rail[aria-pressed="true"]:hover,#' + UI_ROOT_ID + ' .nll-v-rail[aria-pressed="true"]:focus-visible,#' + UI_ROOT_ID + ' .nll-v-rail[aria-pressed="true"].nll-expanded{' +
        'transform:translateX(0)!important;' +
      '}' +

      /* 2 — Corner pin */
      '#' + UI_ROOT_ID + ' .nll-v-pin{' +
        'position:absolute!important;top:120px!important;right:0!important;' +
        'display:inline-flex!important;align-items:center!important;gap:6px!important;' +
        'height:26px!important;padding:0 10px 0 8px!important;' +
        'border:1px solid rgba(55,53,47,.16)!important;border-right:none!important;' +
        'border-radius:6px 0 0 6px!important;' +
        'background:rgba(255,255,255,.9)!important;color:#37352f!important;' +
        'box-shadow:-1px 1px 6px rgba(15,15,15,.06)!important;' +
        'transform:translateX(calc(100% - 22px))!important;' +
        'transition:transform .18s ease,background .15s ease,color .15s ease,border-color .15s ease!important;' +
        'opacity:.75!important;' +
      '}' +
      '#' + UI_ROOT_ID + ' .nll-v-pin .nll-icon{' +
        'display:inline-flex!important;width:12px!important;height:12px!important;' +
        'align-items:center!important;justify-content:center!important;flex:0 0 auto!important;' +
      '}' +
      '#' + UI_ROOT_ID + ' .nll-v-pin .nll-label{white-space:nowrap!important;}' +
      '#' + UI_ROOT_ID + ' .nll-v-pin:hover,#' + UI_ROOT_ID + ' .nll-v-pin:focus-visible,#' + UI_ROOT_ID + ' .nll-v-pin.nll-expanded{' +
        'transform:translateX(0)!important;opacity:1!important;outline:none!important;' +
      '}' +
      '#' + UI_ROOT_ID + ' .nll-v-pin[aria-pressed="true"]{' +
        'background:rgba(35,131,226,.12)!important;color:#0B6BCB!important;' +
        'border-color:rgba(35,131,226,.32)!important;opacity:.95!important;' +
        'transform:translateX(calc(100% - 24px))!important;' +
      '}' +
      '#' + UI_ROOT_ID + ' .nll-v-pin[aria-pressed="true"]:hover,#' + UI_ROOT_ID + ' .nll-v-pin[aria-pressed="true"]:focus-visible,#' + UI_ROOT_ID + ' .nll-v-pin[aria-pressed="true"].nll-expanded{' +
        'transform:translateX(0)!important;' +
      '}' +

      /* 3 — Status dot */
      '#' + UI_ROOT_ID + ' .nll-v-dot{' +
        'position:absolute!important;top:168px!important;right:0!important;' +
        'display:inline-flex!important;align-items:center!important;gap:8px!important;' +
        'height:22px!important;padding:0 10px 0 6px!important;' +
        'border:none!important;background:transparent!important;color:#37352f!important;' +
        'transform:translateX(calc(100% - 14px))!important;' +
        'transition:transform .18s ease,opacity .15s ease!important;opacity:.65!important;' +
      '}' +
      '#' + UI_ROOT_ID + ' .nll-v-dot .nll-dot{' +
        'width:8px!important;height:8px!important;border-radius:50%!important;' +
        'background:rgba(55,53,47,.35)!important;flex:0 0 auto!important;' +
        'box-shadow:0 0 0 2px rgba(255,255,255,.65)!important;' +
        'transition:background .15s ease!important;' +
      '}' +
      '#' + UI_ROOT_ID + ' .nll-v-dot .nll-label{' +
        'opacity:0!important;white-space:nowrap!important;' +
        'transition:opacity .15s ease!important;color:rgba(55,53,47,.85)!important;' +
      '}' +
      '#' + UI_ROOT_ID + ' .nll-v-dot:hover,#' + UI_ROOT_ID + ' .nll-v-dot:focus-visible,#' + UI_ROOT_ID + ' .nll-v-dot.nll-expanded{' +
        'transform:translateX(0)!important;opacity:1!important;outline:none!important;' +
      '}' +
      '#' + UI_ROOT_ID + ' .nll-v-dot:hover .nll-label,#' + UI_ROOT_ID + ' .nll-v-dot:focus-visible .nll-label,#' + UI_ROOT_ID + ' .nll-v-dot.nll-expanded .nll-label{' +
        'opacity:1!important;' +
      '}' +
      '#' + UI_ROOT_ID + ' .nll-v-dot[aria-pressed="true"] .nll-dot{background:#2383e2!important;}' +
      '#' + UI_ROOT_ID + ' .nll-v-dot[aria-pressed="true"]{' +
        'opacity:.9!important;transform:translateX(calc(100% - 14px))!important;' +
      '}' +
      '#' + UI_ROOT_ID + ' .nll-v-dot[aria-pressed="true"]:hover,#' + UI_ROOT_ID + ' .nll-v-dot[aria-pressed="true"]:focus-visible,#' + UI_ROOT_ID + ' .nll-v-dot[aria-pressed="true"].nll-expanded{' +
        'transform:translateX(0)!important;' +
      '}' +

      /* 4 — Notion-native top bar (centered — clears Zen’s right sidebar / Share cluster) */
      '#' + UI_ROOT_ID + ' .nll-v-topbar{' +
        'position:absolute!important;top:10px!important;left:50%!important;right:auto!important;' +
        'transform:translateX(-50%)!important;' +
        'display:inline-flex!important;align-items:center!important;gap:0!important;' +
        'height:28px!important;padding:0 10px!important;' +
        'border:none!important;border-radius:6px!important;' +
        'background:transparent!important;color:rgba(55,53,47,.65)!important;' +
        'font:13px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif!important;' +
        'transition:background .12s ease,color .12s ease!important;' +
      '}' +
      '#' + UI_ROOT_ID + ' .nll-v-topbar:hover,#' + UI_ROOT_ID + ' .nll-v-topbar:focus-visible{' +
        'background:rgba(55,53,47,.08)!important;color:#37352f!important;outline:none!important;' +
      '}' +
      '#' + UI_ROOT_ID + ' .nll-v-topbar[aria-pressed="true"]{' +
        'color:#0B6BCB!important;background:rgba(35,131,226,.1)!important;' +
      '}' +
      '#' + UI_ROOT_ID + ' .nll-v-topbar[aria-pressed="true"]:hover{' +
        'background:rgba(35,131,226,.16)!important;' +
      '}' +
      /* In all-mode, keep #4’s index tag above the centered control */
      '#' + UI_ROOT_ID + ' .nll-v-topbar .nll-tag.nll-tag-top{' +
        'left:50%!important;right:auto!important;transform:translateX(-50%)!important;' +
      '}' +

      /* 5 — Locked-only (placeholder when unlocked in test mode) */
      '#' + UI_ROOT_ID + ' .nll-v-lockedonly{' +
        'position:absolute!important;top:0!important;left:0!important;right:0!important;' +
        'height:2px!important;padding:0!important;border:none!important;border-radius:0!important;' +
        'background:transparent!important;color:transparent!important;' +
        'transition:background .15s ease,height .15s ease!important;' +
      '}' +
      '#' + UI_ROOT_ID + ' .nll-v-lockedonly .nll-lockedonly-chip{' +
        'display:none!important;' +
      '}' +
      /* Single-variant locked: top-edge “Launcher” chip */
      '#' + UI_ROOT_ID + '[data-nll-mode="single"] .nll-v-lockedonly[aria-pressed="true"]{' +
        'height:auto!important;top:0!important;left:auto!important;right:12px!important;' +
        'width:auto!important;padding:4px 10px!important;' +
        'border-radius:0 0 6px 6px!important;' +
        'background:rgba(35,131,226,.92)!important;color:#fff!important;' +
        'box-shadow:0 2px 8px rgba(15,15,15,.12)!important;' +
      '}' +
      '#' + UI_ROOT_ID + '[data-nll-mode="single"] .nll-v-lockedonly[aria-pressed="true"] .nll-lockedonly-chip{' +
        'display:inline!important;font:11px/1.2 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif!important;' +
        'letter-spacing:.02em!important;white-space:nowrap!important;' +
      '}' +
      /* All-mode: keep #5 in the stack (right edge) so it doesn’t cover other variants */
      '#' + UI_ROOT_ID + '[data-nll-mode="all"] .nll-v-lockedonly{' +
        'top:216px!important;left:auto!important;right:0!important;height:26px!important;' +
        'padding:0 10px!important;width:auto!important;' +
        'border:1px dashed rgba(55,53,47,.28)!important;border-right:none!important;' +
        'border-radius:6px 0 0 6px!important;background:rgba(255,255,255,.5)!important;' +
        'color:rgba(55,53,47,.45)!important;transform:translateX(calc(100% - 18px))!important;' +
      '}' +
      '#' + UI_ROOT_ID + '[data-nll-mode="all"] .nll-v-lockedonly .nll-lockedonly-chip{' +
        'display:inline!important;white-space:nowrap!important;' +
      '}' +
      '#' + UI_ROOT_ID + '[data-nll-mode="all"] .nll-v-lockedonly:hover{' +
        'transform:translateX(0)!important;color:rgba(55,53,47,.7)!important;' +
      '}' +
      '#' + UI_ROOT_ID + '[data-nll-mode="all"] .nll-v-lockedonly[aria-pressed="true"]{' +
        'border-style:solid!important;border-color:rgba(35,131,226,.35)!important;' +
        'background:rgba(35,131,226,.92)!important;color:#fff!important;' +
        'opacity:.95!important;transform:translateX(calc(100% - 22px))!important;' +
      '}' +
      '#' + UI_ROOT_ID + '[data-nll-mode="all"] .nll-v-lockedonly[aria-pressed="true"]:hover{' +
        'transform:translateX(0)!important;' +
      '}' +
      '#' + UI_ROOT_ID + ' .nll-v-lockedonly.nll-hidden-unlocked{' +
        'display:none!important;' +
      '}' +

      /* 6 — Segmented Free | Launcher */
      '#' + UI_ROOT_ID + ' .nll-v-segment{' +
        'position:absolute!important;top:260px!important;right:8px!important;' +
        'display:inline-flex!important;align-items:stretch!important;padding:2px!important;' +
        'gap:0!important;height:26px!important;' +
        'border:1px solid rgba(55,53,47,.16)!important;border-radius:8px!important;' +
        'background:rgba(255,255,255,.92)!important;' +
        'box-shadow:0 1px 4px rgba(15,15,15,.06)!important;' +
        'opacity:.85!important;transition:opacity .15s ease!important;' +
      '}' +
      '#' + UI_ROOT_ID + ' .nll-v-segment:hover{opacity:1!important;}' +
      '#' + UI_ROOT_ID + ' .nll-v-segment .nll-seg{' +
        'display:inline-flex!important;align-items:center!important;justify-content:center!important;' +
        'padding:0 8px!important;border:none!important;border-radius:6px!important;' +
        'background:transparent!important;color:rgba(55,53,47,.55)!important;' +
        'font:11px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif!important;' +
        'cursor:pointer!important;white-space:nowrap!important;' +
        'transition:background .12s ease,color .12s ease!important;' +
      '}' +
      '#' + UI_ROOT_ID + ' .nll-v-segment .nll-seg[aria-pressed="true"]{' +
        'background:rgba(35,131,226,.14)!important;color:#0B6BCB!important;' +
      '}' +
      '#' + UI_ROOT_ID + ' .nll-v-segment .nll-seg:focus-visible{outline:2px solid rgba(35,131,226,.45)!important;outline-offset:1px!important;}' +

      /* Stack offsets when showing a single non-all variant — reset awkward tops */
      '#' + UI_ROOT_ID + '[data-nll-mode="single"] .nll-v-rail,' +
      '#' + UI_ROOT_ID + '[data-nll-mode="single"] .nll-v-pin,' +
      '#' + UI_ROOT_ID + '[data-nll-mode="single"] .nll-v-dot{' +
        'top:72px!important;' +
      '}' +
      '#' + UI_ROOT_ID + '[data-nll-mode="single"] .nll-v-segment{' +
        'top:72px!important;' +
      '}' +
      '#' + UI_ROOT_ID + '[data-nll-mode="single"] .nll-tag{display:none!important;}';

    (doc.head || doc.documentElement).appendChild(style);
  }

  function stopNotion(e) {
    e.stopPropagation();
  }

  function bindExpandOnHover(el) {
    el.addEventListener('mouseenter', function () { el.classList.add('nll-expanded'); });
    el.addEventListener('mouseleave', function () { el.classList.remove('nll-expanded'); });
    el.addEventListener('focus', function () { el.classList.add('nll-expanded'); });
    el.addEventListener('blur', function () { el.classList.remove('nll-expanded'); });
  }

  function bindToggleClick(el) {
    el.addEventListener('mousedown', stopNotion, true);
    el.addEventListener('mouseup', stopNotion, true);
    el.addEventListener('pointerdown', stopNotion, true);
    el.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
      if (e.altKey) {
        cycleUiVariant();
        return;
      }
      toggleLock();
    }, true);
  }

  function makeTag(doc, num, top) {
    var tag = doc.createElement('span');
    tag.className = 'nll-tag' + (top ? ' nll-tag-top' : '');
    tag.setAttribute('aria-hidden', 'true');
    tag.textContent = String(num);
    return tag;
  }

  function createVariantControl(doc, num) {
    var meta = VARIANT_META[num];
    if (!meta) return null;
    var el;
    var showTags = isAllMode();

    if (num === 'indicator') {
      el = doc.createElement('button');
      el.type = 'button';
      el.className = 'nll-v-indicator';
      var labelInd = doc.createElement('span');
      labelInd.className = 'nll-label';
      labelInd.textContent = 'Unlock · ⌘⇧L';
      el.appendChild(labelInd);
      bindExpandOnHover(el);
      bindToggleClick(el);
    } else if (num === 1) {
      el = doc.createElement('button');
      el.type = 'button';
      el.className = 'nll-v-rail';
      var label1 = doc.createElement('span');
      label1.className = 'nll-label';
      el.appendChild(label1);
      bindExpandOnHover(el);
      bindToggleClick(el);
    } else if (num === 2) {
      el = doc.createElement('button');
      el.type = 'button';
      el.className = 'nll-v-pin';
      var icon2 = doc.createElement('span');
      icon2.className = 'nll-icon';
      icon2.setAttribute('aria-hidden', 'true');
      var label2 = doc.createElement('span');
      label2.className = 'nll-label';
      el.appendChild(icon2);
      el.appendChild(label2);
      bindExpandOnHover(el);
      bindToggleClick(el);
    } else if (num === 3) {
      el = doc.createElement('button');
      el.type = 'button';
      el.className = 'nll-v-dot';
      var dot = doc.createElement('span');
      dot.className = 'nll-dot';
      dot.setAttribute('aria-hidden', 'true');
      var label3 = doc.createElement('span');
      label3.className = 'nll-label';
      el.appendChild(dot);
      el.appendChild(label3);
      bindExpandOnHover(el);
      bindToggleClick(el);
    } else if (num === 4) {
      el = doc.createElement('button');
      el.type = 'button';
      el.className = 'nll-v-topbar';
      var label4 = doc.createElement('span');
      label4.className = 'nll-label';
      el.appendChild(label4);
      bindToggleClick(el);
    } else if (num === 5) {
      el = doc.createElement('button');
      el.type = 'button';
      el.className = 'nll-v-lockedonly';
      var chip = doc.createElement('span');
      chip.className = 'nll-lockedonly-chip';
      el.appendChild(chip);
      bindToggleClick(el);
    } else if (num === 6) {
      el = doc.createElement('div');
      el.className = 'nll-v-segment';
      el.setAttribute('role', 'group');
      var freeBtn = doc.createElement('button');
      freeBtn.type = 'button';
      freeBtn.className = 'nll-seg nll-seg-free';
      freeBtn.textContent = 'Free';
      var launchBtn = doc.createElement('button');
      launchBtn.type = 'button';
      launchBtn.className = 'nll-seg nll-seg-launch';
      launchBtn.textContent = 'Launcher';
      function onSeg(e, wantLocked) {
        e.preventDefault();
        e.stopPropagation();
        if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
        if (e.altKey) {
          cycleUiVariant();
          return;
        }
        var locked = readIsLocked();
        if (wantLocked && !locked) enableLock();
        else if (!wantLocked && locked) disableLock();
      }
      freeBtn.addEventListener('mousedown', stopNotion, true);
      launchBtn.addEventListener('mousedown', stopNotion, true);
      freeBtn.addEventListener('click', function (e) { onSeg(e, false); }, true);
      launchBtn.addEventListener('click', function (e) { onSeg(e, true); }, true);
      el.addEventListener('mousedown', stopNotion, true);
      el.appendChild(freeBtn);
      el.appendChild(launchBtn);
    } else {
      return null;
    }

    el.setAttribute(UI_ROOT_ATTR, 'variant-' + meta.id);
    el.setAttribute('data-nll-variant', String(num));
    el.setAttribute('aria-label', meta.name + ' — toggle locked launcher (Alt+click to cycle variants)');
    el.title = num === 'indicator'
      ? 'Launcher locked — click to unlock · Cmd+Shift+L'
      : meta.name + ' — click to toggle · Alt+click to cycle variants · Cmd+Shift+L';

    if (showTags) {
      // Top-bar sits in the header; tag above it. Others get a side index.
      el.appendChild(makeTag(doc, num, num === 4));
    }

    return el;
  }

  function variantKeyFromEl(el) {
    var raw = el.getAttribute('data-nll-variant');
    return parseVariantToken(raw);
  }

  function updateVariantControl(el, locked) {
    if (!el) return;
    var num = variantKeyFromEl(el);
    var titleBase = (VARIANT_META[num] ? VARIANT_META[num].name : 'Launcher') +
      ' — click to toggle · Alt+click to cycle · Cmd+Shift+L';

    if (num === 'indicator') {
      el.setAttribute('aria-pressed', locked ? 'true' : 'false');
      el.title = locked
        ? 'Launcher locked — click to unlock · Cmd+Shift+L'
        : 'Lock with Cmd+Shift+L';
      var li = el.querySelector('.nll-label');
      if (li) li.textContent = 'Unlock · ⌘⇧L';
    } else if (num === 1) {
      el.setAttribute('aria-pressed', locked ? 'true' : 'false');
      var l1 = el.querySelector('.nll-label');
      if (l1) l1.textContent = locked ? 'Unlock' : 'Lock';
      el.title = titleBase;
    } else if (num === 2) {
      el.setAttribute('aria-pressed', locked ? 'true' : 'false');
      var icon = el.querySelector('.nll-icon');
      var l2 = el.querySelector('.nll-label');
      if (icon) icon.innerHTML = svgPin(locked);
      if (l2) l2.textContent = locked ? 'Pinned' : 'Pin';
      el.title = titleBase;
    } else if (num === 3) {
      el.setAttribute('aria-pressed', locked ? 'true' : 'false');
      var l3 = el.querySelector('.nll-label');
      if (l3) l3.textContent = locked ? 'Launcher · ⌘⇧L' : 'Launcher · ⌘⇧L';
      el.title = titleBase;
    } else if (num === 4) {
      el.setAttribute('aria-pressed', locked ? 'true' : 'false');
      var l4 = el.querySelector('.nll-label');
      if (l4) l4.textContent = locked ? 'Locked' : 'Lock tab';
      el.title = titleBase;
    } else if (num === 5) {
      el.setAttribute('aria-pressed', locked ? 'true' : 'false');
      var chip = el.querySelector('.nll-lockedonly-chip');
      el.classList.remove('nll-hidden-unlocked');
      if (locked) {
        if (chip) chip.textContent = 'Launcher';
      } else if (isAllMode()) {
        if (chip) chip.textContent = 'hidden until locked';
      } else {
        el.classList.add('nll-hidden-unlocked');
        if (chip) chip.textContent = '';
      }
      el.title = titleBase;
    } else if (num === 6) {
      var freeBtn = el.querySelector('.nll-seg-free');
      var launchBtn = el.querySelector('.nll-seg-launch');
      if (freeBtn) freeBtn.setAttribute('aria-pressed', locked ? 'false' : 'true');
      if (launchBtn) launchBtn.setAttribute('aria-pressed', locked ? 'true' : 'false');
      el.title = titleBase;
    }
  }

  function removeLauncherUi() {
    var root = document.getElementById(UI_ROOT_ID);
    if (root && root.parentNode) {
      try { root.parentNode.removeChild(root); } catch (e) { /* ignore */ }
    }
    // Legacy single peek cleanup
    var legacy = document.getElementById('nll-peek-toggle');
    if (legacy && legacy.parentNode) {
      try { legacy.parentNode.removeChild(legacy); } catch (e2) { /* ignore */ }
    }
  }

  function remountLauncherUi() {
    removeLauncherUi();
    mountLauncherUi();
  }

  function updateLauncherUi() {
    if (!SHOW_PEEK_TOGGLE) {
      removeLauncherUi();
      return;
    }
    var root = document.getElementById(UI_ROOT_ID);
    if (!root) {
      mountLauncherUi();
      return;
    }
    var locked = readIsLocked();
    var nodes = root.querySelectorAll('[data-nll-variant]');
    for (var i = 0; i < nodes.length; i++) updateVariantControl(nodes[i], locked);
  }

  function mountLauncherUi() {
    if (!SHOW_PEEK_TOGGLE) {
      removeLauncherUi();
      return;
    }
    var doc = document;
    if (!doc.documentElement) return;
    ensureLauncherStyles(doc);

    var parent = doc.documentElement || doc.body;
    if (!parent) return;

    var root = doc.getElementById(UI_ROOT_ID);
    if (!root) {
      root = doc.createElement('div');
      root.id = UI_ROOT_ID;
      root.setAttribute(UI_ROOT_ATTR, 'root');
      parent.appendChild(root);
    } else if (root.parentNode !== parent) {
      parent.appendChild(root);
    }

    var want = variantsToMount();
    root.setAttribute('data-nll-mode', want.length > 1 ? 'all' : 'single');

    // Remove controls that shouldn't be mounted
    var existing = root.querySelectorAll('[data-nll-variant]');
    var wantSet = {};
    for (var w = 0; w < want.length; w++) wantSet[String(want[w])] = true;
    for (var i = 0; i < existing.length; i++) {
      var key = existing[i].getAttribute('data-nll-variant');
      if (!wantSet[key]) {
        try { existing[i].parentNode.removeChild(existing[i]); } catch (e) { /* ignore */ }
      }
    }

    var locked = readIsLocked();
    for (var j = 0; j < want.length; j++) {
      var num = want[j];
      var el = root.querySelector('[data-nll-variant="' + num + '"]');
      if (!el) {
        el = createVariantControl(doc, num);
        if (el) root.appendChild(el);
      }
      updateVariantControl(el, locked);
    }
    log('Launcher UI mounted; variants=', want.join(','));
  }

  function watchLauncherUiSurvival() {
    if (!SHOW_PEEK_TOGGLE) return;

    var started = false;
    var obs = new MutationObserver(function () {
      if (!document.getElementById(UI_ROOT_ID)) mountLauncherUi();
    });

    function start() {
      if (started) {
        mountLauncherUi();
        return;
      }
      var root = document.documentElement || document.body;
      if (!root) return;
      started = true;
      mountLauncherUi();
      try {
        obs.observe(root, { childList: true, subtree: true });
      } catch (e) { /* ignore */ }
      try {
        setInterval(function () {
          if (!document.getElementById(UI_ROOT_ID)) mountLauncherUi();
        }, 2000);
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
    try {
      setTimeout(start, 0);
      setTimeout(start, 500);
      setTimeout(start, 2000);
    } catch (e3) { /* ignore */ }
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

  clearLegacyTitleLockPrefix();
  watchLauncherUiSurvival();
  syncChromeUi();
  log('Initialized; locked=', readIsLocked(), 'url=', readLockedUrl(), 'ui=', getUiVariant());
})();
