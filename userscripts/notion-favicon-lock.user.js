// ==UserScript==
// @name         Notion Favicon Lock
// @namespace    https://github.com/hyugin/quiet-layer
// @version      1.2.0
// @description  Keep the Notion browser-tab favicon locked to the default Notion logo (blocks page emoji/icon swaps).
// @author       Quiet Layer
// @match        https://www.notion.so/*
// @match        https://notion.so/*
// @match        https://*.notion.so/*
// @match        https://www.notion.com/*
// @match        https://notion.com/*
// @match        https://*.notion.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

/*
 * Runs inside AdGuard for Mac's built-in userscript manager (not a browser extension).
 * May need updating if Notion changes how it sets favicons.
 *
 * Firefox: mutate the EXISTING <link rel=icon> href in place. Do not remove/recreate
 * the node — Firefox tracks the original link and often ignores newly inserted ones.
 * Prefer applying a data: URI (same mechanism Notion uses for emoji icons) so the
 * tab icon actually refreshes.
 */

(function () {
  'use strict';

  // Official Notion favicon (kept for reference / easy swap).
  var FIXED_FAVICON_URL = 'https://www.notion.so/images/favicon.ico';

  // What we write into link.href. SVG data URI mirrors how Notion sets emoji
  // favicons, which Firefox reliably paints; plain https:// swaps often stick.
  // Change this to FIXED_FAVICON_URL if you prefer the network .ico instead.
  var FIXED_FAVICON_HREF =
    'data:image/svg+xml,' +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
        '<rect width="100" height="100" rx="18" fill="#000"/>' +
        '<path fill="#fff" d="M28 22h14l20 36V22h12v56H60L40 42v36H28V22z"/>' +
      '</svg>'
    );

  if (window.__quietLayerFaviconLock) return;
  window.__quietLayerFaviconLock = true;

  var applying = false;

  function isIconLink(node) {
    if (!node || node.nodeType !== 1 || node.tagName !== 'LINK') return false;
    var rel = (node.getAttribute('rel') || '').toLowerCase();
    return rel.indexOf('icon') !== -1 &&
      rel.indexOf('apple-touch-icon') === -1 &&
      rel.indexOf('mask-icon') === -1;
  }

  function hrefLooksFixed(href) {
    if (!href) return false;
    if (href === FIXED_FAVICON_HREF) return true;
    if (href === FIXED_FAVICON_URL) return true;
    // Absolute form of the official URL
    try {
      if (href.indexOf('/images/favicon.ico') !== -1) return true;
    } catch (e) { /* ignore */ }
    return false;
  }

  /**
   * Firefox-friendly apply: keep the first icon <link> node, only change href.
   * Create one only if none exists yet.
   */
  function applyFixedFavicon() {
    if (applying) return;
    applying = true;
    try {
      var head = document.head || document.getElementsByTagName('head')[0];
      if (!head) return;

      var links = head.querySelectorAll('link[rel]');
      var primary = null;

      for (var i = 0; i < links.length; i++) {
        if (!isIconLink(links[i])) continue;
        if (!primary) {
          primary = links[i];
        } else {
          // Extra icon links confuse some browsers; drop the extras only.
          try {
            if (links[i].parentNode) links[i].parentNode.removeChild(links[i]);
          } catch (e) { /* ignore */ }
        }
      }

      if (!primary) {
        primary = document.createElement('link');
        primary.setAttribute('rel', 'icon');
        head.appendChild(primary);
      }

      // Prefer property write (fires the same path Notion uses).
      if (!hrefLooksFixed(primary.href) || primary.getAttribute('href') !== FIXED_FAVICON_HREF) {
        primary.rel = 'icon';
        primary.type = 'image/svg+xml';
        primary.href = FIXED_FAVICON_HREF;
      }
    } catch (e) {
      // Fail silently — never break Notion.
    } finally {
      applying = false;
    }
  }

  function scheduleApply() {
    if (applying) return;
    try {
      applyFixedFavicon();
    } catch (e) { /* ignore */ }
  }

  // Intercept createElement('link') so Notion's new icon nodes get our href.
  try {
    var originalCreateElement = Document.prototype.createElement;
    Document.prototype.createElement = function (tagName, options) {
      var el = originalCreateElement.call(this, tagName, options);
      try {
        if (typeof tagName === 'string' && tagName.toLowerCase() === 'link') {
          var hrefDesc = Object.getOwnPropertyDescriptor(HTMLLinkElement.prototype, 'href');
          if (hrefDesc && hrefDesc.set) {
            Object.defineProperty(el, 'href', {
              configurable: true,
              enumerable: hrefDesc.enumerable,
              get: function () { return hrefDesc.get.call(this); },
              set: function (value) {
                if (isIconLink(this) || (this.rel && String(this.rel).toLowerCase().indexOf('icon') !== -1)) {
                  return hrefDesc.set.call(this, FIXED_FAVICON_HREF);
                }
                return hrefDesc.set.call(this, value);
              }
            });
          }

          var originalSetAttribute = el.setAttribute;
          el.setAttribute = function (name, value) {
            var result = originalSetAttribute.call(this, name, value);
            try {
              var n = String(name).toLowerCase();
              if (n === 'href' && isIconLink(this)) {
                originalSetAttribute.call(this, 'href', FIXED_FAVICON_HREF);
              } else if (n === 'rel' && value && String(value).toLowerCase().indexOf('icon') !== -1) {
                originalSetAttribute.call(this, 'href', FIXED_FAVICON_HREF);
              }
            } catch (e) { /* ignore */ }
            return result;
          };
        }
      } catch (e) { /* ignore */ }
      return el;
    };
  } catch (e) { /* ignore */ }

  // Patch prototype href setter as a belt-and-suspenders guard.
  try {
    var desc = Object.getOwnPropertyDescriptor(HTMLLinkElement.prototype, 'href');
    if (desc && desc.set && !desc.set.__quietLayerFavicon) {
      var originalSet = desc.set;
      var originalGet = desc.get;
      function patchedSet(value) {
        try {
          if (isIconLink(this)) value = FIXED_FAVICON_HREF;
        } catch (e) { /* ignore */ }
        return originalSet.call(this, value);
      }
      patchedSet.__quietLayerFavicon = true;
      Object.defineProperty(HTMLLinkElement.prototype, 'href', {
        configurable: true,
        enumerable: desc.enumerable,
        get: originalGet,
        set: patchedSet
      });
    }
  } catch (e) { /* ignore */ }

  // MutationObserver — same strategy as the working Firefox "Static Notion Favicon" addon.
  try {
    var observer = new MutationObserver(function () {
      scheduleApply();
    });
    var root = document.documentElement || document;
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['href', 'rel']
    });
  } catch (e) { /* ignore */ }

  // History / SPA navigations
  try {
    var wrap = function (type) {
      var original = history[type];
      if (typeof original !== 'function') return;
      history[type] = function () {
        var ret = original.apply(this, arguments);
        scheduleApply();
        return ret;
      };
    };
    wrap('pushState');
    wrap('replaceState');
    window.addEventListener('popstate', scheduleApply, true);
  } catch (e) { /* ignore */ }

  // Poll — Notion sometimes writes favicons without a mutation we catch.
  try {
    setInterval(scheduleApply, 500);
  } catch (e) { /* ignore */ }

  scheduleApply();
  try {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', scheduleApply, { once: true });
    }
    window.addEventListener('load', scheduleApply, { once: true });
  } catch (e) { /* ignore */ }
})();
