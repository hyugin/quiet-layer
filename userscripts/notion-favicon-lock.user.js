// ==UserScript==
// @name         Notion Favicon Lock
// @namespace    https://github.com/hyugin/quiet-layer
// @version      1.1.0
// @description  Keep the Notion browser-tab favicon locked to the default Notion logo (blocks page emoji/icon swaps). Hardened for Firefox + AdGuard.
// @author       Quiet Layer
// @match        https://www.notion.so/*
// @match        https://notion.so/*
// @match        https://www.notion.com/*
// @match        https://notion.com/*
// @run-at       document-start
// @grant        none
// @grant        window.onurlchange
// ==/UserScript==

/*
 * Runs inside AdGuard for Mac's built-in userscript manager (not a browser extension).
 * May need updating if Notion changes how it injects or updates favicon <link> elements.
 *
 * Firefox note: the tab icon is cached aggressively. This script force-replaces icon
 * <link> nodes (remove + insert) rather than only mutating href, and also patches
 * DOM APIs in the page context so Notion cannot quietly swap the icon back.
 */

(function () {
  'use strict';

  // Fixed Notion logo — change this constant if you prefer a different favicon URL.
  var FIXED_FAVICON_URL = 'https://www.notion.so/images/favicon.ico';

  // Marker so we can recognize our own <link> and avoid fighting ourselves.
  var MARKER_ATTR = 'data-quiet-layer-favicon';

  // How often to re-assert (Firefox sometimes ignores a single DOM write).
  var POLL_MS = 400;

  /**
   * Core lock logic. Designed to run in the *page* JS world so prototype patches
   * affect Notion's own scripts (AdGuard may otherwise sandbox the userscript).
   */
  function installLock(FIXED_FAVICON_URL, MARKER_ATTR, POLL_MS) {
    if (window.__quietLayerFaviconLockInstalled) return;
    window.__quietLayerFaviconLockInstalled = true;

    var applying = false;
    var debounceTimer = null;
    var DEBOUNCE_MS = 20;

    function isIconRel(rel) {
      if (!rel) return false;
      rel = String(rel).toLowerCase();
      // Match icon / shortcut icon / icon shortcut, but not apple-touch-icon etc.
      // unless Notion uses them as the tab favicon (it usually uses rel=icon).
      if (rel.indexOf('icon') === -1) return false;
      if (rel.indexOf('apple-touch-icon') !== -1) return false;
      if (rel.indexOf('mask-icon') !== -1) return false;
      return true;
    }

    function isIconLink(node) {
      try {
        return !!(node && node.nodeType === 1 && node.tagName === 'LINK' && isIconRel(node.getAttribute('rel')));
      } catch (e) {
        return false;
      }
    }

    function isOurs(link) {
      try {
        return !!(link && link.getAttribute && link.getAttribute(MARKER_ATTR) === '1');
      } catch (e) {
        return false;
      }
    }

    function hrefIsFixed(link) {
      try {
        var href = link.getAttribute('href') || '';
        // Allow optional cache-bust query we may append.
        return href === FIXED_FAVICON_URL || href.indexOf(FIXED_FAVICON_URL + '?') === 0;
      } catch (e) {
        return false;
      }
    }

    function needsFix() {
      try {
        var head = document.head || document.getElementsByTagName('head')[0];
        if (!head) return true;

        var links = head.querySelectorAll('link[rel]');
        var ours = 0;
        for (var i = 0; i < links.length; i++) {
          var link = links[i];
          if (!isIconLink(link)) continue;
          if (isOurs(link) && hrefIsFixed(link)) {
            ours++;
          } else {
            return true; // foreign or wrong icon present
          }
        }
        return ours !== 1;
      } catch (e) {
        return true;
      }
    }

    /**
     * Firefox often ignores in-place href changes on existing <link rel=icon>.
     * Always remove foreign icons and (re)insert a fresh canonical <link>.
     */
    function applyFixedFavicon(forceRecreate) {
      if (applying) return;
      try {
        var head = document.head || document.getElementsByTagName('head')[0];
        if (!head) return;

        if (!forceRecreate && !needsFix()) return;

        applying = true;

        var links = head.querySelectorAll('link[rel]');
        var existingOurs = null;

        for (var i = 0; i < links.length; i++) {
          var link = links[i];
          if (!isIconLink(link)) continue;

          if (!forceRecreate && !existingOurs && isOurs(link) && hrefIsFixed(link)) {
            existingOurs = link;
            continue;
          }

          try {
            if (link.parentNode) link.parentNode.removeChild(link);
          } catch (e) { /* ignore */ }
        }

        if (existingOurs) {
          // Keep a single healthy marker link.
          try {
            if (existingOurs.getAttribute('rel') !== 'icon') {
              existingOurs.setAttribute('rel', 'icon');
            }
            if (!hrefIsFixed(existingOurs)) {
              existingOurs.setAttribute('href', FIXED_FAVICON_URL);
            }
            existingOurs.setAttribute(MARKER_ATTR, '1');
          } catch (e) { /* ignore */ }
        } else {
          var el = document.createElement('link');
          el.setAttribute('rel', 'icon');
          el.setAttribute('type', 'image/x-icon');
          el.setAttribute(MARKER_ATTR, '1');
          // Stable cache-bust helps Firefox pick our icon over a prior emoji data: URI
          // that may already be stored against this tab/history entry.
          el.setAttribute('href', FIXED_FAVICON_URL + '?quiet-layer=1');
          head.appendChild(el);
        }
      } catch (e) {
        // Fail silently — never break Notion.
      } finally {
        applying = false;
      }
    }

    function scheduleApply(forceRecreate) {
      if (applying) return;
      if (debounceTimer !== null) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(function () {
        debounceTimer = null;
        applyFixedFavicon(!!forceRecreate);
      }, DEBOUNCE_MS);
    }

    // --- Patch DOM write paths Notion uses (page context) ---
    function patchSetAttribute() {
      try {
        var proto = Element.prototype;
        var original = proto.setAttribute;
        if (!original || original.__quietLayerFaviconPatched) return;

        function patchedSetAttribute(name, value) {
          if (this && this.tagName === 'LINK') {
            var attr = String(name).toLowerCase();
            if (attr === 'href' && isIconLink(this) && !isOurs(this)) {
              // Redirect Notion's emoji/custom icon write to our logo.
              return original.call(this, name, FIXED_FAVICON_URL + '?quiet-layer=1');
            }
            if (attr === 'rel' && isIconRel(value) && !isOurs(this)) {
              var result = original.call(this, name, value);
              try {
                original.call(this, 'href', FIXED_FAVICON_URL + '?quiet-layer=1');
                original.call(this, MARKER_ATTR, '1');
              } catch (e) { /* ignore */ }
              scheduleApply(true);
              return result;
            }
          }
          return original.apply(this, arguments);
        }

        patchedSetAttribute.__quietLayerFaviconPatched = true;
        proto.setAttribute = patchedSetAttribute;
      } catch (e) { /* ignore */ }
    }

    function patchHrefProperty() {
      try {
        var desc = Object.getOwnPropertyDescriptor(HTMLLinkElement.prototype, 'href');
        if (!desc || !desc.set || desc.set.__quietLayerFaviconPatched) return;

        var originalSet = desc.set;
        var originalGet = desc.get;

        function patchedSet(value) {
          try {
            if (isIconLink(this) && !isOurs(this)) {
              value = FIXED_FAVICON_URL + '?quiet-layer=1';
              try {
                this.setAttribute(MARKER_ATTR, '1');
              } catch (e) { /* ignore */ }
            }
          } catch (e) { /* ignore */ }
          return originalSet.call(this, value);
        }

        patchedSet.__quietLayerFaviconPatched = true;
        Object.defineProperty(HTMLLinkElement.prototype, 'href', {
          configurable: true,
          enumerable: desc.enumerable,
          get: originalGet,
          set: patchedSet
        });
      } catch (e) { /* ignore */ }
    }

    function patchNodeInsertion(methodName) {
      try {
        var proto = Node.prototype;
        var original = proto[methodName];
        if (!original || original.__quietLayerFaviconPatched) return;

        function patched() {
          var node = arguments[0];
          var result = original.apply(this, arguments);
          try {
            if (isIconLink(node) && !isOurs(node)) {
              scheduleApply(true);
            } else if (node && node.querySelectorAll) {
              var nested = node.querySelectorAll('link[rel]');
              for (var i = 0; i < nested.length; i++) {
                if (isIconLink(nested[i]) && !isOurs(nested[i])) {
                  scheduleApply(true);
                  break;
                }
              }
            }
          } catch (e) { /* ignore */ }
          return result;
        }

        patched.__quietLayerFaviconPatched = true;
        proto[methodName] = patched;
      } catch (e) { /* ignore */ }
    }

    function startObserver() {
      try {
        if (typeof MutationObserver === 'undefined') return;

        var observer = new MutationObserver(function (mutations) {
          if (applying) return;
          for (var i = 0; i < mutations.length; i++) {
            var m = mutations[i];

            if (m.type === 'attributes' && isIconLink(m.target)) {
              if (!isOurs(m.target) || !hrefIsFixed(m.target)) {
                scheduleApply(true);
                return;
              }
            }

            if (m.addedNodes && m.addedNodes.length) {
              for (var a = 0; a < m.addedNodes.length; a++) {
                var added = m.addedNodes[a];
                if (isIconLink(added) && !isOurs(added)) {
                  scheduleApply(true);
                  return;
                }
                if (added && added.querySelectorAll) {
                  var nested = added.querySelectorAll('link[rel]');
                  for (var n = 0; n < nested.length; n++) {
                    if (isIconLink(nested[n]) && !isOurs(nested[n])) {
                      scheduleApply(true);
                      return;
                    }
                  }
                }
              }
            }

            if (m.removedNodes && m.removedNodes.length) {
              for (var r = 0; r < m.removedNodes.length; r++) {
                if (isIconLink(m.removedNodes[r])) {
                  scheduleApply(true);
                  return;
                }
              }
            }
          }
        });

        function observe(target) {
          if (!target) return;
          observer.observe(target, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['href', 'rel', MARKER_ATTR]
          });
        }

        observe(document.head || document.documentElement || document);

        if (!document.head) {
          var headWait = new MutationObserver(function () {
            if (document.head) {
              try { headWait.disconnect(); } catch (e) { /* ignore */ }
              observe(document.head);
              applyFixedFavicon(true);
            }
          });
          try {
            headWait.observe(document.documentElement || document, {
              childList: true,
              subtree: true
            });
          } catch (e) { /* ignore */ }
        }
      } catch (e) { /* ignore */ }
    }

    function hookHistory() {
      try {
        function wrap(type) {
          var original = history[type];
          if (typeof original !== 'function' || original.__quietLayerFaviconPatched) return;
          function patched() {
            var result = original.apply(this, arguments);
            scheduleApply(true);
            return result;
          }
          patched.__quietLayerFaviconPatched = true;
          history[type] = patched;
        }
        wrap('pushState');
        wrap('replaceState');
        window.addEventListener('popstate', function () {
          scheduleApply(true);
        }, true);
      } catch (e) { /* ignore */ }
    }

    function hookUrlChange() {
      // AdGuard SPA helper when @grant window.onurlchange is present.
      try {
        window.addEventListener('urlchange', function () {
          scheduleApply(true);
        });
      } catch (e) { /* ignore */ }
      try {
        if (typeof window.onurlchange !== 'undefined') {
          var prev = window.onurlchange;
          window.onurlchange = function (event) {
            try {
              if (typeof prev === 'function') prev.call(this, event);
            } catch (e) { /* ignore */ }
            scheduleApply(true);
          };
        }
      } catch (e) { /* ignore */ }
    }

    function startPolling() {
      try {
        setInterval(function () {
          if (needsFix()) applyFixedFavicon(true);
        }, POLL_MS);
      } catch (e) { /* ignore */ }
    }

    // Install hooks first, then assert favicon.
    patchSetAttribute();
    patchHrefProperty();
    patchNodeInsertion('appendChild');
    patchNodeInsertion('insertBefore');
    patchNodeInsertion('replaceChild');
    startObserver();
    hookHistory();
    hookUrlChange();
    startPolling();

    applyFixedFavicon(true);

    try {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () {
          applyFixedFavicon(true);
        }, { once: true });
      }
      window.addEventListener('load', function () {
        applyFixedFavicon(true);
      }, { once: true });
    } catch (e) { /* ignore */ }
  }

  /**
   * Also try to install in the page JS world via a temporary <script>.
   * AdGuard may sandbox the userscript; page-world patches stop Notion's own
   * writes. Notion's CSP may block this — that is fine; we always install
   * directly below as well (observer/poll still fix the DOM).
   */
  function tryInstallInPageContext(fn, a, b, c) {
    try {
      var parent = document.documentElement || document.head || document;
      if (!parent) return;

      var script = document.createElement('script');
      script.setAttribute('data-quiet-layer', 'favicon-lock');
      script.textContent =
        '(' + fn.toString() + ')(' +
        JSON.stringify(a) + ',' +
        JSON.stringify(b) + ',' +
        JSON.stringify(c) +
        ');';

      parent.appendChild(script);
      if (script.parentNode) script.parentNode.removeChild(script);
    } catch (e) { /* ignore — CSP or missing root */ }
  }

  try {
    // Always install in the userscript realm (DOM observer + poll).
    installLock(FIXED_FAVICON_URL, MARKER_ATTR, POLL_MS);
    // Best-effort page-realm install for prototype patches.
    tryInstallInPageContext(installLock, FIXED_FAVICON_URL, MARKER_ATTR, POLL_MS);
  } catch (e) {
    // Fail silently — never break Notion.
  }
})();
