/**
 * Content script for Notion Locked Launcher.
 *
 * Capturing-phase click interception on a[href] while locked.
 * No on-page floating button — toggle via tab context menu, toolbar
 * action, or Cmd/Ctrl+Shift+L.
 */

(function () {
  "use strict";

  const INTERCEPT_EXTERNAL_LINKS = false;
  const DEBUG = false;

  let locked = false;
  let lockedUrl = "";

  function log(...args) {
    if (!DEBUG) return;
    try {
      console.log("[Notion Locked Launcher]", ...args);
    } catch (e) {
      /* ignore */
    }
  }

  function isNotionHost(hostname) {
    if (!hostname) return false;
    const h = String(hostname).toLowerCase();
    return (
      h === "notion.com" ||
      h.endsWith(".notion.com") ||
      h === "notion.so" ||
      h.endsWith(".notion.so") ||
      h === "notion.site" ||
      h.endsWith(".notion.site")
    );
  }

  function resolveAbsoluteUrl(href, baseHref) {
    if (!href || typeof href !== "string") return null;
    const trimmed = href.trim();
    if (!trimmed || trimmed.charAt(0) === "#") return null;
    if (/^(javascript|data|mailto|tel|blob):/i.test(trimmed)) return null;
    try {
      const u = new URL(trimmed, baseHref);
      if (u.protocol !== "http:" && u.protocol !== "https:") return null;
      return u.href;
    } catch (e) {
      return null;
    }
  }

  function isMeaningfullyDifferentUrl(destinationHref, lockedHref) {
    if (!destinationHref || !lockedHref) return true;
    try {
      const dest = new URL(destinationHref);
      const lockedHrefUrl = new URL(lockedHref);
      return (
        dest.origin !== lockedHrefUrl.origin ||
        dest.pathname !== lockedHrefUrl.pathname ||
        dest.search !== lockedHrefUrl.search
      );
    } catch (e) {
      return destinationHref !== lockedHref;
    }
  }

  function isModifiedClick(event) {
    return !!(
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    );
  }

  function shouldSkipAnchor(anchor) {
    if (!anchor) return true;

    const target = (anchor.getAttribute("target") || "").toLowerCase();
    if (target === "_blank" || target === "_new") return true;

    if (anchor.hasAttribute("download")) return true;

    const hrefAttr = anchor.getAttribute("href");
    if (hrefAttr == null) return true;
    const href = String(hrefAttr).trim();
    if (!href || href === "#" || href.indexOf("javascript:") === 0) return true;

    return false;
  }

  function applyLockState(state) {
    locked = !!state?.locked;
    lockedUrl = state?.url || "";
    log("SetLock", locked, lockedUrl);
  }

  function requestState() {
    browser.runtime
      .sendMessage({ type: "Ready" })
      .then((state) => {
        if (state) applyLockState(state);
      })
      .catch(() => {
        /* background not ready */
      });
  }

  function onClickCapture(event) {
    if (event.button !== 0) return;
    if (event.defaultPrevented) return;
    if (isModifiedClick(event)) {
      log("Skip: modified click");
      return;
    }

    const pathTarget = event.target;
    if (!pathTarget || !pathTarget.closest) return;

    const anchor = pathTarget.closest("a[href]");
    if (!anchor) return;
    if (shouldSkipAnchor(anchor)) {
      log("Skip: non-navigational or _blank/download anchor");
      return;
    }

    if (!locked) return;

    let homeUrl = lockedUrl;
    const locationHref = location.href || "";
    if (!homeUrl) {
      homeUrl = locationHref;
      lockedUrl = homeUrl;
    }

    const dest = resolveAbsoluteUrl(anchor.getAttribute("href"), locationHref);
    if (!dest) {
      log("Skip: could not resolve href", anchor.getAttribute("href"));
      return;
    }

    let destIsNotion = false;
    try {
      destIsNotion = isNotionHost(new URL(dest).hostname);
    } catch (e) {
      return;
    }
    if (!destIsNotion && !INTERCEPT_EXTERNAL_LINKS) {
      log("Skip: external link", dest);
      return;
    }

    if (!isMeaningfullyDifferentUrl(dest, homeUrl)) {
      log("Skip: destination matches locked URL", dest);
      return;
    }

    if (!isMeaningfullyDifferentUrl(dest, locationHref)) {
      log("Skip: destination matches current location", dest);
      return;
    }

    log("Intercept → new tab", dest);

    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === "function") {
      event.stopImmediatePropagation();
    }

    browser.runtime.sendMessage({ type: "OpenURL", url: dest }).catch((e) => {
      log("Failed to message background", e);
    });
  }

  browser.runtime.onMessage.addListener((message) => {
    if (!message || typeof message !== "object") return;
    if (message.type === "SetLock") {
      applyLockState(message);
    }
  });

  document.addEventListener("click", onClickCapture, true);

  requestState();

  try {
    console.info(
      "[Notion Locked Launcher] content active — tab menu / toolbar / Cmd+Shift+L"
    );
  } catch (e) {
    /* ignore */
  }
})();
