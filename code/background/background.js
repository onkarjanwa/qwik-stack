// background/background.js
// MV3 service worker. No default_popup is set in manifest.json (removed in
// v0.5.0) specifically so clicking the extension's toolbar icon fires
// chrome.action.onClicked below instead of opening a popup -- we relay that
// click to the active tab's content script, which opens the same docked
// sidebar as the in-page tab. If the active tab isn't a linkedin.com page
// (or the content script hasn't loaded there yet), sendMessage has no
// receiver -- that's expected and not an error worth surfacing.

chrome.runtime.onInstalled.addListener(() => {
  // No-op for v1. Reserved for future setup (e.g. default templates).
});

chrome.action.onClicked.addListener((tab) => {
  if (!tab || !tab.id) return;
  chrome.tabs.sendMessage(tab.id, { type: 'LMT_TOGGLE_MANAGER' }, () => {
    // Swallow "Could not establish connection" when the active tab has no
    // content script (not a linkedin.com page, or not loaded yet) -- there's
    // nothing useful to show the user for that case.
    void chrome.runtime.lastError;
  });
});

// Phase 2: chrome.commands.onCommand.addListener(...) will post a message to
// the active LinkedIn tab's content script to toggle the insert picker for
// the focused compose box. No commands are registered in manifest.json yet,
// so this listener currently never fires -- left here as the intended
// extension point.
if (chrome.commands && chrome.commands.onCommand) {
  chrome.commands.onCommand.addListener((command) => {
    // Reserved for Phase 2.
  });
}
