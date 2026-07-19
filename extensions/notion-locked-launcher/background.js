/**
 * Background (event page) for Notion Locked Launcher.
 *
 * Background responsibilities:
 * - Tab context menu + toolbar action + Cmd/Ctrl+Shift+L
 * - Per-tab lock state (in-memory; cleared when the tab closes)
 * - Open intercepted URLs in a new foreground tab
 * - Badge "ON" on locked tabs
 */

"use strict";

const MENU_ID = "notion-locked-launcher-toggle";
const NOTION_HOST_RE =
  /^(?:.*\.)?(?:notion\.com|notion\.so|notion\.site)$/i;

/** @type {Map<number, { locked: boolean, url: string }>} */
const lockState = new Map();

const NOTION_MATCH_PATTERNS = [
  "https://www.notion.com/*",
  "https://notion.com/*",
  "https://*.notion.com/*",
  "https://www.notion.so/*",
  "https://notion.so/*",
  "https://*.notion.so/*",
  "https://www.notion.site/*",
  "https://notion.site/*",
  "https://*.notion.site/*",
];

function isNotionHost(hostname) {
  if (!hostname) return false;
  return NOTION_HOST_RE.test(String(hostname).toLowerCase());
}

function isNotionUrl(url) {
  if (!url) return false;
  try {
    return isNotionHost(new URL(url).hostname);
  } catch (e) {
    return false;
  }
}

function getState(tabId) {
  return lockState.get(tabId) || { locked: false, url: "" };
}

async function syncToContent(tabId) {
  const state = getState(tabId);
  try {
    await browser.tabs.sendMessage(tabId, {
      type: "SetLock",
      locked: !!state.locked,
      url: state.url || "",
    });
  } catch (e) {
    /* content script not ready / not a Notion page */
  }
}

async function updateBadge(tabId) {
  const state = getState(tabId);
  try {
    if (state.locked) {
      await browser.action.setBadgeText({ tabId, text: "ON" });
      await browser.action.setBadgeBackgroundColor({
        tabId,
        color: "#0B6BCB",
      });
      await browser.action.setTitle({
        tabId,
        title: "Notion Locked Launcher (locked) — click or Cmd+Shift+L to unlock",
      });
    } else {
      await browser.action.setBadgeText({ tabId, text: "" });
      await browser.action.setTitle({
        tabId,
        title: "Notion Locked Launcher — lock this tab",
      });
    }
  } catch (e) {
    /* tab may be gone */
  }
}

async function setLocked(tabId, locked, url) {
  if (locked) {
    lockState.set(tabId, { locked: true, url: url || "" });
  } else {
    lockState.delete(tabId);
  }
  await syncToContent(tabId);
  await updateBadge(tabId);
}

async function lockTab(tab) {
  if (!tab?.id) return false;
  if (!isNotionUrl(tab.url)) {
    console.info(
      "[Notion Locked Launcher] Lock ignored — not a Notion tab."
    );
    return false;
  }
  await setLocked(tab.id, true, tab.url);
  console.info("[Notion Locked Launcher] Locked →", tab.url);
  return true;
}

async function unlockTab(tab) {
  if (!tab?.id) return false;
  await setLocked(tab.id, false, "");
  console.info("[Notion Locked Launcher] Unlocked");
  return true;
}

async function toggleTab(tab) {
  if (!tab?.id) return false;
  const state = getState(tab.id);
  return state.locked ? unlockTab(tab) : lockTab(tab);
}

async function refreshMenuForTab(tab) {
  if (!tab) return;
  const notion = isNotionUrl(tab.url);
  const locked = !!getState(tab.id).locked;
  try {
    await browser.menus.update(MENU_ID, {
      visible: notion,
      enabled: notion,
      title: locked
        ? "Unlock Notion launcher"
        : "Lock as Notion launcher",
    });
    await browser.menus.refresh();
  } catch (e) {
    /* menu not ready */
  }
}

function ensureMenu() {
  // remove-then-create so event-page wake-ups do not hit duplicate-id errors
  return browser.menus
    .remove(MENU_ID)
    .catch(() => {})
    .then(() =>
      browser.menus.create({
        id: MENU_ID,
        title: "Lock as Notion launcher",
        contexts: ["tab"],
        documentUrlPatterns: NOTION_MATCH_PATTERNS,
      })
    )
    .catch((err) => {
      console.warn("[Notion Locked Launcher] menus.create failed:", err);
    });
}

browser.runtime.onInstalled.addListener(() => {
  ensureMenu();
});

browser.runtime.onStartup.addListener(() => {
  ensureMenu();
});

ensureMenu();

browser.menus.onShown.addListener(async (info, tab) => {
  if (!info.contexts || !info.contexts.includes("tab")) return;
  await refreshMenuForTab(tab);
});

browser.menus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID || !tab) return;
  await toggleTab(tab);
  await refreshMenuForTab(tab);
});

browser.commands.onCommand.addListener(async (command) => {
  if (command !== "toggle-lock") return;
  const [tab] = await browser.tabs.query({
    active: true,
    currentWindow: true,
  });
  if (!tab || !isNotionUrl(tab.url)) return;
  await toggleTab(tab);
});

browser.action.onClicked.addListener(async (tab) => {
  if (!tab || !isNotionUrl(tab.url)) return;
  await toggleTab(tab);
});

browser.runtime.onMessage.addListener((message, sender) => {
  if (!message || typeof message !== "object") return undefined;

  if (message.type === "Ready") {
    const tabId = sender.tab?.id;
    if (tabId == null) {
      return Promise.resolve({ locked: false, url: "" });
    }
    const state = getState(tabId);
    updateBadge(tabId);
    return Promise.resolve({
      locked: !!state.locked,
      url: state.url || "",
    });
  }

  if (message.type === "OpenURL") {
    const url = message.url;
    const tabId = sender.tab?.id;
    if (!url || typeof url !== "string" || tabId == null) {
      return Promise.resolve({ ok: false });
    }
    return browser.tabs
      .create({
        url,
        openerTabId: tabId,
        active: true,
      })
      .then(() => ({ ok: true }))
      .catch((err) => {
        console.error("[Notion Locked Launcher] tabs.create failed:", err);
        return { ok: false };
      });
  }

  return undefined;
});

browser.tabs.onRemoved.addListener((tabId) => {
  lockState.delete(tabId);
});

browser.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (!lockState.has(tabId)) return;
  if (changeInfo.status === "complete" || changeInfo.url) {
    await syncToContent(tabId);
    await updateBadge(tabId);
  }
});

browser.tabs.onActivated.addListener(async ({ tabId }) => {
  await updateBadge(tabId);
});

console.info(
  "[Notion Locked Launcher] background ready — tab menu / toolbar / Cmd+Shift+L"
);
