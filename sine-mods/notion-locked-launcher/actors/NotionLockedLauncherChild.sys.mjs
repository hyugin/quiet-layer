/**
 * Content-process half of Notion Locked Launcher.
 * Captures left-clicks on a[href] while locked and asks chrome to open
 * destinations in a new tab — mirroring the AdGuard userscript rules.
 */

const INTERCEPT_EXTERNAL_LINKS = false;
const DEBUG = false;

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
    const locked = new URL(lockedHref);
    return (
      dest.origin !== locked.origin ||
      dest.pathname !== locked.pathname ||
      dest.search !== locked.search
    );
  } catch (e) {
    return destinationHref !== lockedHref;
  }
}

function isModifiedClick(event) {
  return !!(event.metaKey || event.ctrlKey || event.shiftKey || event.altKey);
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

export class NotionLockedLauncherChild extends JSWindowActorChild {
  constructor() {
    super();
    this._locked = false;
    this._lockedUrl = "";
  }

  actorCreated() {
    this.#requestState();
  }

  receiveMessage(message) {
    switch (message.name) {
      case "NotionLockedLauncher:SetLock": {
        const data = message.data || {};
        this._locked = !!data.locked;
        this._lockedUrl = data.url || "";
        log("SetLock", this._locked, this._lockedUrl);
        break;
      }
      default:
        break;
    }
  }

  handleEvent(event) {
    switch (event.type) {
      case "DOMContentLoaded":
        this.#requestState();
        break;
      case "click":
        this.#onClickCapture(event);
        break;
      default:
        break;
    }
  }

  #requestState() {
    try {
      this.sendAsyncMessage("NotionLockedLauncher:Ready");
    } catch (e) {
      /* ignore */
    }
  }

  #onClickCapture(event) {
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

    if (!this._locked) return;

    let lockedUrl = this._lockedUrl;
    const win = this.contentWindow;
    const locationHref = win?.location?.href || "";
    if (!lockedUrl) {
      lockedUrl = locationHref;
      this._lockedUrl = lockedUrl;
    }

    const dest = resolveAbsoluteUrl(anchor.getAttribute("href"), locationHref);
    if (!dest) {
      log("Skip: could not resolve href", anchor.getAttribute("href"));
      return;
    }

    const destIsNotion = isNotionHost(new URL(dest).hostname);
    if (!destIsNotion && !INTERCEPT_EXTERNAL_LINKS) {
      log("Skip: external link", dest);
      return;
    }

    if (!isMeaningfullyDifferentUrl(dest, lockedUrl)) {
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

    try {
      this.sendAsyncMessage("NotionLockedLauncher:OpenURL", { url: dest });
    } catch (e) {
      log("Failed to message chrome", e);
    }
  }
}
