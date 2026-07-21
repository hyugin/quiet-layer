// ==UserScript==
// @name         Notion Tab-Local Sidebar
// @namespace    https://github.com/hyugin/quiet-layer
// @version      1.0.0
// @description  Keep Notion left (and optional right) sidebar open/closed state per browser tab instead of syncing via localStorage across tabs.
// @author       Quiet Layer
// @match        https://www.notion.so/*
// @match        https://notion.so/*
// @match        https://*.notion.so/*
// @match        https://www.notion.com/*
// @match        https://notion.com/*
// @match        https://*.notion.com/*
// @match        https://*.notion.site/*
// @match        https://notion.site/*
// @include      *://www.notion.so/*
// @include      *://notion.so/*
// @include      *://*.notion.so/*
// @include      *://www.notion.com/*
// @include      *://notion.com/*
// @include      *://*.notion.com/*
// @include      *://*.notion.site/*
// @include      *://notion.site/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

/*
 * Runs inside AdGuard for Mac's built-in userscript manager (or Violentmonkey).
 * Paste into AdGuard → Extensions → +. Requires AdGuard protection + HTTPS
 * filtering for notion.com / notion.so.
 *
 * Why this exists
 * ---------------
 * Notion stores sidebar open/closed + width in localStorage under:
 *   LRU:KeyValueStore2:sidebar          (left nav)
 *   LRU:KeyValueStore2:updateSidebar    (comments / updates / analytics)
 * localStorage is shared across all tabs of the same origin, so toggling the
 * sidebar in tab A makes tab B pick up the same state on refresh.
 *
 * This script redirects those keys to sessionStorage (per-tab). Writes never
 * go back to localStorage, so other tabs stay independent.
 *
 * Console line when active: [Notion Tab-Local Sidebar] v1.0.0 active
 */

(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Configuration
  // ---------------------------------------------------------------------------

  /** Also isolate the right-hand comments/updates sidebar state. */
  var INCLUDE_RIGHT_SIDEBAR = true;

  /** Log get/set redirects to the console. */
  var DEBUG = false;

  /**
   * Exact Notion KeyValueStore keys (confirmed from Notion's own page skeleton
   * and third-party sidebar controllers).
   */
  var SIDEBAR_KEYS = {
    'LRU:KeyValueStore2:sidebar': true,
  };

  if (INCLUDE_RIGHT_SIDEBAR) {
    SIDEBAR_KEYS['LRU:KeyValueStore2:updateSidebar'] = true;
  }

  // ---------------------------------------------------------------------------

  if (window.__quietLayerTabLocalSidebar) return;
  window.__quietLayerTabLocalSidebar = true;

  var VERSION = '1.0.0';
  var TAG = '[Notion Tab-Local Sidebar]';

  function log() {
    if (!DEBUG) return;
    try {
      console.log.apply(console, [TAG].concat([].slice.call(arguments)));
    } catch (e) { /* ignore */ }
  }

  function isSidebarKey(key) {
    if (key == null) return false;
    key = String(key);
    if (SIDEBAR_KEYS[key]) return true;
    // Future-proof: Notion has used KeyValueStore / KeyValueStore2 prefixes.
    if (key.indexOf('LRU:KeyValueStore') === 0 && /sidebar/i.test(key)) {
      if (!INCLUDE_RIGHT_SIDEBAR && /updateSidebar/i.test(key)) return false;
      return true;
    }
    return false;
  }

  function seedFromLocal(key) {
    try {
      var existing = sessionStorage.getItem(key);
      if (existing != null) return existing;
      var shared = localStorageGetRaw(key);
      if (shared != null) {
        sessionStorage.setItem(key, shared);
        log('seeded', key);
        return shared;
      }
    } catch (e) {
      log('seed failed', key, e);
    }
    return null;
  }

  // Raw localStorage get bound before we patch (avoid recursion in seed).
  var localStorageGetRaw = Storage.prototype.getItem.bind(localStorage);

  var origGetItem = Storage.prototype.getItem;
  var origSetItem = Storage.prototype.setItem;
  var origRemoveItem = Storage.prototype.removeItem;

  Storage.prototype.getItem = function (key) {
    if (this === localStorage && isSidebarKey(key)) {
      var v = seedFromLocal(key);
      log('getItem', key, v != null ? '(session)' : '(null)');
      return v;
    }
    return origGetItem.call(this, key);
  };

  Storage.prototype.setItem = function (key, value) {
    if (this === localStorage && isSidebarKey(key)) {
      // Tab-local only — do not write shared localStorage.
      try {
        sessionStorage.setItem(key, value);
        log('setItem → sessionStorage', key);
      } catch (e) {
        log('setItem failed', key, e);
      }
      return;
    }
    return origSetItem.call(this, key, value);
  };

  Storage.prototype.removeItem = function (key) {
    if (this === localStorage && isSidebarKey(key)) {
      try {
        sessionStorage.removeItem(key);
        log('removeItem → sessionStorage', key);
      } catch (e) {
        log('removeItem failed', key, e);
      }
      return;
    }
    return origRemoveItem.call(this, key);
  };

  // Also bind on the localStorage instance — some code paths call the own
  // method if it was copied earlier; keep both in sync.
  try {
    localStorage.getItem = Storage.prototype.getItem;
    localStorage.setItem = Storage.prototype.setItem;
    localStorage.removeItem = Storage.prototype.removeItem;
  } catch (e) { /* ignore */ }

  // Ignore cross-tab storage events for sidebar keys (belt and suspenders;
  // we no longer write those keys to localStorage ourselves).
  window.addEventListener(
    'storage',
    function (e) {
      if (isSidebarKey(e.key)) {
        log('blocked storage event', e.key);
        e.stopImmediatePropagation();
      }
    },
    true
  );

  // Eager seed so Notion's early skeleton script (reads expanded/width) sees
  // session values if this userscript won the race.
  try {
    Object.keys(SIDEBAR_KEYS).forEach(function (k) {
      seedFromLocal(k);
    });
  } catch (e) { /* ignore */ }

  try {
    console.log(TAG + ' v' + VERSION + ' active — sidebar state is per-tab');
  } catch (e) { /* ignore */ }
})();
