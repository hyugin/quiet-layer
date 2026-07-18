// ==UserScript==
// @name         Notion Locked Launcher
// @description  Lock a Notion tab as a launcher via tab context menu / Cmd+Shift+L
// @include      main
// ==/UserScript==

/**
 * Chrome script for Zen Browser (Sine).
 *
 * Responsibilities:
 * - Tab context-menu item + Cmd+Shift+L shortcut
 * - Per-tab lock state (tab property + attribute; survives SPA in content via actor sync)
 * - Register JSWindowActor for content click interception
 * - Open destinations with openTrustedLinkIn / gBrowser
 * - Optional: sync Zen pinned URL (never Essentials)
 */

(function () {
  "use strict";

  const ACTOR_NAME = "NotionLockedLauncher";
  const TAB_ATTR = "notion-locked-launcher";
  const MENU_ID = "context_notionLockedLauncher";
  const KEY_ID = "key_notionLockedLauncher";
  const COMMAND_ID = "cmd_notionLockedLauncher";

  const NOTION_HOST_RE =
    /^(?:.*\.)?(?:notion\.com|notion\.so|notion\.site)$/i;

  // ---------------------------------------------------------------------------
  // Actor registration (once per process)
  // ---------------------------------------------------------------------------

  const ACTOR_OPTIONS = {
    parent: {
      esModuleURI:
        "chrome://notion-locked-launcher/content/actors/NotionLockedLauncherParent.sys.mjs",
    },
    child: {
      esModuleURI:
        "chrome://notion-locked-launcher/content/actors/NotionLockedLauncherChild.sys.mjs",
      events: {
        DOMContentLoaded: {},
        click: { capture: true },
      },
    },
    allFrames: false,
    matches: [
      "https://www.notion.com/*",
      "https://notion.com/*",
      "https://*.notion.com/*",
      "https://www.notion.so/*",
      "https://notion.so/*",
      "https://*.notion.so/*",
      "https://notion.site/*",
      "https://*.notion.site/*",
    ],
  };

  const g = typeof globalThis !== "undefined" ? globalThis : window;
  if (!g.__notionLockedLauncherActorsRegistered) {
    let registered = false;
    try {
      ChromeUtils.registerWindowActor(ACTOR_NAME, ACTOR_OPTIONS);
      registered = true;
    } catch (e) {
      if (/already registered/i.test(String(e))) {
        registered = true;
      } else {
        try {
          const { ActorManagerParent } = ChromeUtils.importESModule(
            "resource://gre/modules/ActorManagerParent.sys.mjs"
          );
          ActorManagerParent.addJSWindowActors({
            [ACTOR_NAME]: ACTOR_OPTIONS,
          });
          registered = true;
        } catch (e2) {
          console.warn(
            "[Notion Locked Launcher] Actor registration failed:",
            e,
            e2
          );
        }
      }
    }
    if (registered) {
      g.__notionLockedLauncherActorsRegistered = true;
    }
  }

  // ---------------------------------------------------------------------------
  // Per-window chrome API
  // ---------------------------------------------------------------------------

  if (window.NotionLockedLauncher) return;

  function isNotionHost(hostname) {
    if (!hostname) return false;
    return NOTION_HOST_RE.test(String(hostname).toLowerCase());
  }

  function isNotionUrl(url) {
    try {
      return isNotionHost(Services.io.newURI(url).host);
    } catch (e) {
      try {
        return isNotionHost(new URL(url).hostname);
      } catch (e2) {
        return false;
      }
    }
  }

  function tabUrl(tab) {
    try {
      return tab?.linkedBrowser?.currentURI?.spec || "";
    } catch (e) {
      return "";
    }
  }

  function getState(tab) {
    if (!tab) return { locked: false, url: "" };
    const stored = tab._notionLockedLauncher;
    if (stored && stored.locked) {
      return { locked: true, url: stored.url || "" };
    }
    return { locked: false, url: "" };
  }

  function setTabVisual(tab, locked) {
    if (!tab) return;
    if (locked) {
      tab.setAttribute(TAB_ATTR, "true");
    } else {
      tab.removeAttribute(TAB_ATTR);
    }
  }

  function getActorForBrowser(browser) {
    try {
      const wg = browser?.browsingContext?.currentWindowGlobal;
      return wg?.getActor?.(ACTOR_NAME) || null;
    } catch (e) {
      return null;
    }
  }

  function syncToContent(tab) {
    if (!tab?.linkedBrowser) return;
    const state = getState(tab);
    const actor = getActorForBrowser(tab.linkedBrowser);
    if (!actor) return;
    try {
      actor.sendAsyncMessage("NotionLockedLauncher:SetLock", {
        locked: !!state.locked,
        url: state.url || "",
      });
    } catch (e) {
      /* content may not match yet */
    }
  }

  function maybeUpdateZenPinnedUrl(tab) {
    // Stretch: align Zen "Reset pinned tab" with launcher home.
    // Never touch Essentials.
    if (!tab || !tab.pinned) return;
    if (tab.hasAttribute("zen-essential")) return;

    try {
      if (
        window.gZenPinnedTabManager &&
        typeof window.gZenPinnedTabManager.replacePinnedUrlWithCurrent ===
          "function"
      ) {
        window.gZenPinnedTabManager.replacePinnedUrlWithCurrent(tab);
        return;
      }
    } catch (e) {
      /* fall through */
    }

    // Fallback: update stored pinned entry URL if present.
    try {
      if (tab._zenPinnedInitialState?.entry) {
        tab._zenPinnedInitialState.entry.url = tabUrl(tab);
        if (typeof window.gZenWindowSync?.setPinnedTabState === "function") {
          window.gZenWindowSync.setPinnedTabState(tab);
        }
      }
    } catch (e2) {
      console.warn(
        "[Notion Locked Launcher] Could not update pinned URL:",
        e2
      );
    }
  }

  function lock(tab) {
    tab = tab || gBrowser.selectedTab;
    if (!tab) return false;

    const url = tabUrl(tab);
    if (!isNotionUrl(url)) {
      console.info(
        "[Notion Locked Launcher] Lock ignored — not a Notion tab."
      );
      return false;
    }

    tab._notionLockedLauncher = { locked: true, url };
    setTabVisual(tab, true);
    syncToContent(tab);
    maybeUpdateZenPinnedUrl(tab);
    console.info("[Notion Locked Launcher] Locked →", url);
    return true;
  }

  function unlock(tab) {
    tab = tab || gBrowser.selectedTab;
    if (!tab) return false;

    delete tab._notionLockedLauncher;
    setTabVisual(tab, false);
    syncToContent(tab);
    console.info("[Notion Locked Launcher] Unlocked");
    return true;
  }

  function toggle(tab) {
    tab = tab || gBrowser.selectedTab;
    if (!tab) return false;
    const state = getState(tab);
    return state.locked ? unlock(tab) : lock(tab);
  }

  function openUrl(url, browser) {
    const win = browser?.ownerGlobal || window;
    try {
      win.openTrustedLinkIn(url, "tab", {
        relatedToCurrent: true,
        inBackground: false,
        allowInheritPrincipal: true,
        triggeringPrincipal:
          browser?.contentPrincipal ||
          Services.scriptSecurityManager.getSystemPrincipal(),
      });
      return;
    } catch (e) {
      /* fall through */
    }
    try {
      const newTab = win.gBrowser.addTab(url, {
        relatedToCurrent: true,
        triggeringPrincipal:
          browser?.contentPrincipal ||
          Services.scriptSecurityManager.getSystemPrincipal(),
        allowInheritPrincipal: true,
      });
      win.gBrowser.selectedTab = newTab;
    } catch (e2) {
      console.error("[Notion Locked Launcher] openUrl failed:", e2);
    }
  }

  window.NotionLockedLauncher = {
    isNotionUrl,
    getState,
    lock,
    unlock,
    toggle,
    openUrl,
    syncToContent,
  };

  // ---------------------------------------------------------------------------
  // Context menu
  // ---------------------------------------------------------------------------

  function ensureContextMenu() {
    const menu = document.getElementById("tabContextMenu");
    if (!menu || document.getElementById(MENU_ID)) return;

    const item = document.createXULElement("menuitem");
    item.id = MENU_ID;
    item.setAttribute("label", "Lock as Notion launcher");
    item.addEventListener("command", () => {
      const tab = TabContextMenu?.contextTab || gBrowser.selectedTab;
      toggle(tab);
    });

    // Place near Zen pin / reset items when present; else append.
    const before =
      document.getElementById("context_zen-replace-pinned-url-with-current") ||
      document.getElementById("context_pinTab") ||
      document.getElementById("context_unpinTab") ||
      null;

    if (before?.parentNode === menu) {
      menu.insertBefore(item, before);
    } else {
      menu.appendChild(item);
    }

    menu.addEventListener("popupshowing", () => {
      const tab = TabContextMenu?.contextTab || gBrowser.selectedTab;
      const url = tabUrl(tab);
      const notion = isNotionUrl(url);
      const locked = !!getState(tab).locked;

      item.hidden = !notion;
      item.disabled = !notion;
      item.setAttribute(
        "label",
        locked ? "Unlock Notion launcher" : "Lock as Notion launcher"
      );
    });
  }

  // ---------------------------------------------------------------------------
  // Keyboard shortcut: Cmd+Shift+L (accel = Cmd on macOS, Ctrl elsewhere)
  // ---------------------------------------------------------------------------

  function ensureCommandAndKey() {
    const commandSet =
      document.getElementById("mainCommandSet") || document.documentElement;

    if (!document.getElementById(COMMAND_ID)) {
      const cmd = document.createXULElement("command");
      cmd.id = COMMAND_ID;
      cmd.addEventListener("command", () => {
        const tab = gBrowser.selectedTab;
        if (!isNotionUrl(tabUrl(tab))) return;
        toggle(tab);
      });
      commandSet.appendChild(cmd);
    }

    const keyset =
      document.getElementById("mainKeyset") || document.documentElement;

    if (!document.getElementById(KEY_ID)) {
      const key = document.createXULElement("key");
      key.id = KEY_ID;
      key.setAttribute("modifiers", "accel,shift");
      key.setAttribute("key", "L");
      key.setAttribute("command", COMMAND_ID);
      keyset.appendChild(key);
    }
  }

  // ---------------------------------------------------------------------------
  // Cleanup when tabs close; re-sync on location changes within Notion
  // ---------------------------------------------------------------------------

  function onTabClose(event) {
    const tab = event.target;
    if (tab?._notionLockedLauncher) {
      delete tab._notionLockedLauncher;
    }
  }

  function onLocationChange(browser) {
    const tab = gBrowser.getTabForBrowser(browser);
    if (!tab) return;
    const state = getState(tab);
    if (!state.locked) {
      // Drop stale visual if somehow set without state.
      if (tab.hasAttribute(TAB_ATTR)) setTabVisual(tab, false);
      return;
    }
    setTabVisual(tab, true);
    // Re-push lock to content after full navigations recreate the actor.
    syncToContent(tab);
  }

  function setupListeners() {
    gBrowser.tabContainer.addEventListener("TabClose", onTabClose);

    // Tabs progress listener: first arg is the <browser>.
    const progressListener = {
      onLocationChange(browser, webProgress, _request, _location, flags) {
        if (webProgress && !webProgress.isTopLevel) return;
        try {
          if (
            flags & Ci.nsIWebProgressListener.LOCATION_CHANGE_SAME_DOCUMENT
          ) {
            return;
          }
        } catch (e) {
          /* ignore */
        }
        onLocationChange(browser);
      },
    };

    try {
      gBrowser.addTabsProgressListener(progressListener);
    } catch (e) {
      /* older builds */
    }
  }

  function init() {
    ensureContextMenu();
    ensureCommandAndKey();
    setupListeners();
    console.info(
      "[Notion Locked Launcher] chrome ready — tab menu / Cmd+Shift+L"
    );
  }

  if (document.readyState === "complete") {
    init();
  } else {
    window.addEventListener("load", init, { once: true });
  }
})();
