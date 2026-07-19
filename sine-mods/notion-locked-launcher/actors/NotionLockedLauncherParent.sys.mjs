/**
 * Chrome-process half of Notion Locked Launcher.
 * Relays lock state to content and opens intercepted URLs via browser APIs.
 */

export class NotionLockedLauncherParent extends JSWindowActorParent {
  receiveMessage(message) {
    const browser = this.browsingContext?.top?.embedderElement;
    if (!browser) return undefined;

    const win = browser.ownerGlobal;
    if (!win || win.closed) return undefined;

    const api = win.NotionLockedLauncher;
    const tab = win.gBrowser?.getTabForBrowser?.(browser);

    switch (message.name) {
      case "NotionLockedLauncher:Ready": {
        if (!api || !tab) {
          this.sendAsyncMessage("NotionLockedLauncher:SetLock", {
            locked: false,
            url: "",
          });
          return undefined;
        }
        const state = api.getState(tab);
        this.sendAsyncMessage("NotionLockedLauncher:SetLock", {
          locked: !!state?.locked,
          url: state?.url || "",
        });
        return undefined;
      }

      case "NotionLockedLauncher:OpenURL": {
        const url = message.data?.url;
        if (!url || typeof url !== "string") return undefined;
        if (api?.openUrl) {
          api.openUrl(url, browser);
        } else {
          try {
            win.openTrustedLinkIn(url, "tab", {
              relatedToCurrent: true,
              inBackground: false,
              allowInheritPrincipal: true,
              triggeringPrincipal: browser.contentPrincipal,
            });
          } catch (e) {
            try {
              const newTab = win.gBrowser.addTab(url, {
                relatedToCurrent: true,
                triggeringPrincipal: browser.contentPrincipal,
                allowInheritPrincipal: true,
              });
              win.gBrowser.selectedTab = newTab;
            } catch (e2) {
              console.error("[Notion Locked Launcher] Failed to open URL", e2);
            }
          }
        }
        return undefined;
      }

      default:
        return undefined;
    }
  }
}
