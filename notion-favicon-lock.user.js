// ==UserScript==
// @name         Notion Favicon Lock
// @version      1.0.0
// @description  Keep the Notion browser-tab favicon locked to the default Notion logo (blocks page emoji/icon swaps).
// @author       Quiet Layer
// @match        https://www.notion.so/*
// @match        https://notion.so/*
// @match        https://www.notion.com/*
// @match        https://notion.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

/*
 * Runs inside AdGuard for Mac's built-in userscript manager (not a browser extension).
 * May need updating if Notion changes how it injects or updates favicon <link> elements.
 */

(function () {
  'use strict';

  // Fixed Notion logo — change this constant if you prefer a different favicon URL.
  var FIXED_FAVICON_URL = 'https://www.notion.so/images/favicon.ico';

  // Guard flag: true while we are writing our own icon link, so the observer
  // does not re-enter and fight itself.
  var applying = false;

  // Small debounce timer for batched mutations / history events.
  var debounceTimer = null;
  var DEBOUNCE_MS = 30;

  /** Return true if a <link> is a favicon / icon link. */
  function isIconLink(node) {
    if (!node || node.nodeType !== 1 || node.tagName !== 'LINK') return false;
    var rel = (node.getAttribute('rel') || '').toLowerCase();
    return rel === 'icon' ||
      rel === 'shortcut icon' ||
      rel.indexOf('icon') !== -1;
  }

  /** True when the link already points at our fixed logo (avoids infinite loops). */
  function isAlreadyFixed(link) {
    try {
      return link.getAttribute('href') === FIXED_FAVICON_URL;
    } catch (e) {
      return false;
    }
  }

  /**
   * Remove/overwrite Notion's icon links and insert a single canonical
   * <link rel="icon"> pointing at FIXED_FAVICON_URL.
   */
  function applyFixedFavicon() {
    if (applying) return;

    try {
      var head = document.head || document.getElementsByTagName('head')[0];
      if (!head) return;

      applying = true;

      var links = head.querySelectorAll('link[rel]');
      var keep = null;

      for (var i = 0; i < links.length; i++) {
        var link = links[i];
        if (!isIconLink(link)) continue;

        if (!keep && isAlreadyFixed(link) && (link.getAttribute('rel') || '').toLowerCase() === 'icon') {
          keep = link;
        } else {
          // Drop every other icon/shortcut-icon link Notion may have injected.
          try {
            link.parentNode && link.parentNode.removeChild(link);
          } catch (e) { /* ignore */ }
        }
      }

      if (keep) {
        // Ensure attributes stay correct even if Notion mutated them in place.
        if (keep.getAttribute('href') !== FIXED_FAVICON_URL) {
          keep.setAttribute('href', FIXED_FAVICON_URL);
        }
        if ((keep.getAttribute('rel') || '').toLowerCase() !== 'icon') {
          keep.setAttribute('rel', 'icon');
        }
      } else {
        var el = document.createElement('link');
        el.setAttribute('rel', 'icon');
        el.setAttribute('href', FIXED_FAVICON_URL);
        head.appendChild(el);
      }
    } catch (e) {
      // Fail silently — never break the Notion app.
    } finally {
      applying = false;
    }
  }

  /** Schedule a single re-apply after a short debounce. */
  function scheduleApply() {
    if (applying) return;
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(function () {
      debounceTimer = null;
      applyFixedFavicon();
    }, DEBOUNCE_MS);
  }

  /**
   * MutationObserver on <head> (and document as fallback) to catch Notion
   * adding, removing, or changing favicon <link> elements.
   */
  function startObserver() {
    try {
      var target = document.head || document.documentElement || document;
      if (!target || typeof MutationObserver === 'undefined') {
        // No observer available — still apply once when we can.
        applyFixedFavicon();
        return;
      }

      var observer = new MutationObserver(function (mutations) {
        if (applying) return;

        for (var i = 0; i < mutations.length; i++) {
          var m = mutations[i];

          // Attribute change on an icon link (e.g. href swap to a data: URI).
          if (m.type === 'attributes' && isIconLink(m.target)) {
            if (!isAlreadyFixed(m.target)) {
              scheduleApply();
              return;
            }
          }

          // Added nodes that are (or contain) icon links.
          if (m.addedNodes && m.addedNodes.length) {
            for (var a = 0; a < m.addedNodes.length; a++) {
              var added = m.addedNodes[a];
              if (isIconLink(added)) {
                if (!isAlreadyFixed(added)) {
                  scheduleApply();
                  return;
                }
              } else if (added && added.querySelectorAll) {
                var nested = added.querySelectorAll('link[rel]');
                for (var n = 0; n < nested.length; n++) {
                  if (isIconLink(nested[n]) && !isAlreadyFixed(nested[n])) {
                    scheduleApply();
                    return;
                  }
                }
              }
            }
          }

          // Removed icon links — re-assert ours.
          if (m.removedNodes && m.removedNodes.length) {
            for (var r = 0; r < m.removedNodes.length; r++) {
              if (isIconLink(m.removedNodes[r])) {
                scheduleApply();
                return;
              }
            }
          }
        }
      });

      observer.observe(target, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['href', 'rel']
      });

      // If we started on documentElement before <head> existed, re-target once
      // <head> shows up so we observe the real favicon insertion point.
      if (!document.head) {
        var headWait = new MutationObserver(function () {
          if (document.head) {
            try {
              headWait.disconnect();
              observer.observe(document.head, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['href', 'rel']
              });
            } catch (e) { /* ignore */ }
            applyFixedFavicon();
          }
        });
        try {
          headWait.observe(document.documentElement || document, {
            childList: true,
            subtree: true
          });
        } catch (e) { /* ignore */ }
      }
    } catch (e) {
      // Fail silently.
    }
  }

  /**
   * Hook SPA navigation (pushState / replaceState / popstate) so client-side
   * Notion page changes re-assert the fixed favicon.
   */
  function hookHistory() {
    try {
      var wrap = function (type) {
        var original = history[type];
        if (typeof original !== 'function') return;
        history[type] = function () {
          var result = original.apply(this, arguments);
          try {
            scheduleApply();
          } catch (e) { /* ignore */ }
          return result;
        };
      };

      wrap('pushState');
      wrap('replaceState');

      window.addEventListener('popstate', function () {
        scheduleApply();
      }, true);
    } catch (e) {
      // Fail silently.
    }
  }

  // --- Bootstrap at document-start (head may not exist yet) ---
  try {
    applyFixedFavicon();
    startObserver();
    hookHistory();

    // Extra passes after DOM is ready / fully loaded, in case Notion races us.
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () {
        applyFixedFavicon();
      }, { once: true });
    }
    window.addEventListener('load', function () {
      applyFixedFavicon();
    }, { once: true });
  } catch (e) {
    // Fail silently — never break Notion.
  }
})();
