// ==UserScript==
// @name         Stay Put
// @namespace    https://github.com/hyugin/quiet-layer
// @version      1.0.0
// @description  On allowlisted apps, same-origin in-app links open in a new tab so the current tab stays put. Lighter than Notion Locked Launcher (no lock state).
// @author       Quiet Layer
// @match        https://github.com/*
// @match        https://*.github.com/*
// @match        https://gist.github.com/*
// @match        https://*.atlassian.net/*
// @match        https://atlassian.net/*
// @match        https://www.notion.com/*
// @match        https://notion.com/*
// @match        https://*.notion.com/*
// @match        https://www.notion.so/*
// @match        https://notion.so/*
// @match        https://*.notion.so/*
// @match        https://*.notion.site/*
// @match        https://notion.site/*
// @include      *://github.com/*
// @include      *://*.github.com/*
// @include      *://gist.github.com/*
// @include      *://*.atlassian.net/*
// @include      *://atlassian.net/*
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
 * Runs inside AdGuard for Mac's built-in userscript manager (or Violentmonkey
 * on Firefox / Zen). Paste into AdGuard → Extensions → +. Requires AdGuard
 * protection + HTTPS filtering for each allowlisted host (and Zen in filtered
 * apps if you use Zen).
 *
 * Always on for matching hosts — no lock toggle. For a pin-one-tab launcher
 * with on/off state, use notion-locked-launcher.user.js instead.
 *
 * Edit ALLOW_HOSTS / ALLOW_PATH_PREFIXES below to add or narrow sites.
 */

(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Configuration — edit these to target certain sites
  // ---------------------------------------------------------------------------

  /**
   * Hostnames (or RegExp) where this script is active.
   * Must also be covered by @match / @include above (or AdGuard will not inject).
   */
  var ALLOW_HOSTS = [
    /(^|\.)github\.com$/i,
    /^gist\.github\.com$/i,
    /(^|\.)atlassian\.net$/i,
    /(^|\.)notion\.com$/i,
    /(^|\.)notion\.so$/i,
    /(^|\.)notion\.site$/i,
  ];

  /**
   * Optional path allowlist per host pattern. Empty array = entire host.
   * Example: only GitHub issues/PRs:
   *   { host: /(^|\.)github\.com$/i, prefixes: ['/'] }  // all paths
   * Leave empty to allow all paths on ALLOW_HOSTS.
   *
   * When non-empty, a click is intercepted only if the *current page* path
   * starts with one of the prefixes for a matching host rule.
   */
  var ALLOW_PATH_PREFIXES = [
    // { host: /(^|\.)github\.com$/i, prefixes: ['/'] },
  ];

  /**
   * When true, also block same-origin history.pushState / replaceState /
   * popstate navigations and open the destination in a new tab instead.
   *
   * Default false: GitHub PR tabs / Jira filter URLs often use history for
   * in-page UI. Turn on globally, or use GUARD_SPA_HOSTS for Notion-like apps.
   */
  var GUARD_SPA_NAVIGATION = false;

  /**
   * Hosts that get SPA history guards even when GUARD_SPA_NAVIGATION is false.
   * Notion sidebar / peek often navigates without a real <a> click.
   */
  var GUARD_SPA_HOSTS = [
    /(^|\.)notion\.com$/i,
    /(^|\.)notion\.so$/i,
    /(^|\.)notion\.site$/i,
  ];

  /** When true, cross-origin links are also forced into a new tab. */
  var INTERCEPT_EXTERNAL_LINKS = false;

  /** When true, log intercept decisions to the console. */
  var DEBUG = false;

  // ---------------------------------------------------------------------------
  // Guard against double-injection
  // ---------------------------------------------------------------------------

  if (window.__quietLayerStayPut) return;
  window.__quietLayerStayPut = true;

  function log() {
    if (!DEBUG) return;
    var args = Array.prototype.slice.call(arguments);
    args.unshift('[Stay Put]');
    try {
      console.log.apply(console, args);
    } catch (e) { /* ignore */ }
  }

  try {
    console.info('[Stay Put] v1.0.0 active — same-origin links → new tab');
  } catch (e) { /* ignore */ }

  // ---------------------------------------------------------------------------
  // Allowlist helpers
  // ---------------------------------------------------------------------------

  function hostAllowed(hostname) {
    if (!hostname) return false;
    var h = String(hostname).toLowerCase();
    for (var i = 0; i < ALLOW_HOSTS.length; i++) {
      var rule = ALLOW_HOSTS[i];
      if (rule instanceof RegExp) {
        if (rule.test(h)) return true;
      } else if (typeof rule === 'string') {
        var r = rule.toLowerCase();
        if (h === r || h.endsWith('.' + r)) return true;
      }
    }
    return false;
  }

  function pathAllowedOnHost(hostname, pathname) {
    if (!ALLOW_PATH_PREFIXES.length) return true;
    var h = String(hostname || '').toLowerCase();
    var path = pathname || '/';
    var matchedHost = false;
    for (var i = 0; i < ALLOW_PATH_PREFIXES.length; i++) {
      var entry = ALLOW_PATH_PREFIXES[i];
      if (!entry || !entry.host) continue;
      var hostOk = entry.host instanceof RegExp
        ? entry.host.test(h)
        : h === String(entry.host).toLowerCase() ||
          h.endsWith('.' + String(entry.host).toLowerCase());
      if (!hostOk) continue;
      matchedHost = true;
      var prefixes = entry.prefixes || [];
      if (!prefixes.length) return true;
      for (var j = 0; j < prefixes.length; j++) {
        if (path.indexOf(prefixes[j]) === 0) return true;
      }
    }
    // Host has path rules but none matched → deny.
    // Hosts with no path entry stay fully allowed.
    return !matchedHost;
  }

  function scriptActiveHere() {
    try {
      return hostAllowed(location.hostname) &&
        pathAllowedOnHost(location.hostname, location.pathname);
    } catch (e) {
      return false;
    }
  }

  function spaGuardActiveHere() {
    if (GUARD_SPA_NAVIGATION) return true;
    var h = '';
    try {
      h = String(location.hostname || '').toLowerCase();
    } catch (e) {
      return false;
    }
    for (var i = 0; i < GUARD_SPA_HOSTS.length; i++) {
      var rule = GUARD_SPA_HOSTS[i];
      if (rule instanceof RegExp) {
        if (rule.test(h)) return true;
      } else if (typeof rule === 'string') {
        var r = rule.toLowerCase();
        if (h === r || h.endsWith('.' + r)) return true;
      }
    }
    return false;
  }

  if (!scriptActiveHere()) {
    log('Inactive on this host/path', location.hostname, location.pathname);
    return;
  }

  // ---------------------------------------------------------------------------
  // URL helpers
  // ---------------------------------------------------------------------------

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

  function isMeaningfullyDifferentUrl(destinationHref, fromHref) {
    if (!destinationHref || !fromHref) return true;
    try {
      var dest = new URL(destinationHref);
      var from = new URL(fromHref);
      return (
        dest.origin !== from.origin ||
        dest.pathname !== from.pathname ||
        dest.search !== from.search
      );
    } catch (e) {
      return destinationHref !== fromHref;
    }
  }

  function isSameOrigin(url) {
    try {
      return new URL(url, location.href).origin === location.origin;
    } catch (e) {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Open URL in a new foreground tab
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

    try {
      var root = document.documentElement || document.body;
      if (!root) return false;
      var a = document.createElement('a');
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.setAttribute('data-ql-stay-put', 'open');
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
  // Click interception
  // ---------------------------------------------------------------------------

  function isModifiedClick(e) {
    return !!(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey);
  }

  function shouldSkipAnchor(anchor) {
    if (!anchor) return true;

    var target = (anchor.getAttribute('target') || '').toLowerCase();
    if (target === '_blank' || target === '_new') return true;
    if (anchor.hasAttribute('download')) return true;

    var hrefAttr = anchor.getAttribute('href');
    if (hrefAttr == null) return true;
    var href = String(hrefAttr).trim();
    if (!href || href === '#' || href.indexOf('javascript:') === 0) return true;

    return false;
  }

  function shouldOpenDestination(dest) {
    if (!dest) return false;
    if (!scriptActiveHere()) return false;

    if (!isSameOrigin(dest) && !INTERCEPT_EXTERNAL_LINKS) {
      log('Skip: external link', dest);
      return false;
    }

    // Destination host should also be allowlisted when same-ish apps share hosts.
    try {
      var destHost = new URL(dest).hostname;
      if (!hostAllowed(destHost) && !INTERCEPT_EXTERNAL_LINKS) {
        log('Skip: destination host not allowlisted', destHost);
        return false;
      }
    } catch (e) {
      return false;
    }

    if (!isMeaningfullyDifferentUrl(dest, location.href)) {
      log('Skip: destination matches current location', dest);
      return false;
    }

    return true;
  }

  function onClickCapture(e) {
    if (e.button !== 0) return;
    if (e.defaultPrevented) return;
    if (isModifiedClick(e)) {
      log('Skip: modified click');
      return;
    }

    var pathTarget = e.target;
    if (!pathTarget || !pathTarget.closest) return;
    if (pathTarget.closest && pathTarget.closest('[data-ql-stay-put]')) return;

    var anchor = pathTarget.closest('a[href]');
    if (!anchor) return;
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
      log('openInNewTab blocked for', dest);
    }
  }

  document.addEventListener('click', onClickCapture, true);

  // ---------------------------------------------------------------------------
  // SPA navigation guard (optional)
  // ---------------------------------------------------------------------------

  var restoringHome = false;
  var homeUrl = location.href;

  function shouldBlockHistoryUrl(url) {
    if (!spaGuardActiveHere()) return false;
    if (restoringHome) return false;
    if (url == null || url === '') return false;
    var abs = resolveAbsoluteUrl(String(url), location.href);
    return shouldOpenDestination(abs) ? abs : null;
  }

  function blockHistoryAndOpen(abs) {
    log('Intercept history → new tab', abs);
    openInNewTab(abs);
  }

  function installHistoryGuards() {
    if (!spaGuardActiveHere()) return;
    if (history.__qlStayPutGuarded) return;
    history.__qlStayPutGuarded = true;

    var origPush = history.pushState;
    var origReplace = history.replaceState;

    history.pushState = function (state, title, url) {
      var blocked = shouldBlockHistoryUrl(url);
      if (blocked) {
        blockHistoryAndOpen(blocked);
        return;
      }
      var ret = origPush.apply(this, arguments);
      homeUrl = location.href;
      return ret;
    };

    history.replaceState = function (state, title, url) {
      var blocked = shouldBlockHistoryUrl(url);
      if (blocked) {
        blockHistoryAndOpen(blocked);
        return;
      }
      var ret = origReplace.apply(this, arguments);
      homeUrl = location.href;
      return ret;
    };

    window.addEventListener('popstate', function () {
      if (!spaGuardActiveHere() || restoringHome) return;
      if (!isMeaningfullyDifferentUrl(location.href, homeUrl)) return;

      var drifted = location.href;
      if (!shouldOpenDestination(drifted)) {
        homeUrl = location.href;
        return;
      }

      log('popstate drift → new tab + restore', drifted);
      openInNewTab(drifted);
      restoringHome = true;
      try {
        location.replace(homeUrl);
      } catch (e) {
        restoringHome = false;
      }
    });
  }

  installHistoryGuards();
  log(
    'Initialized on',
    location.hostname,
    location.pathname,
    'spaGuard=',
    spaGuardActiveHere()
  );
})();
