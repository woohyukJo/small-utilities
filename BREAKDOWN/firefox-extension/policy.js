"use strict";
globalThis.BreakdownNavigation = class {
  constructor() { this.auth = new Set(); }
  signInComplete(tabId) { this.auth.delete(tabId); }
  forget(tabId) { this.auth.delete(tabId); }
  shouldRestore(raw, target, locked, tabId) {
    if (!locked || !target) { this.auth.delete(tabId); return false; }
    let url;
    try { url = new URL(raw); } catch (_) { return true; }
    if (url.protocol === "https:") {
      const authHosts = ["auth.openai.com", "auth0.openai.com", "accounts.google.com", "login.microsoftonline.com", "login.live.com", "appleid.apple.com"];
      if (authHosts.includes(url.hostname) || (url.origin === "https://chatgpt.com" && /^\/(?:auth|api\/auth)(?:\/|$)/.test(url.pathname))) this.auth.add(tabId);
      // Once sign-in starts, let HTTPS SSO/MFA redirects finish without guessing callback paths.
      if (this.auth.has(tabId)) return false;
      const conversation = /^\/(?:g\/[^/]+\/)?c\/([a-zA-Z0-9_-]{1,200})\/?$/.exec(url.pathname)?.[1];
      if (url.origin === "https://chatgpt.com" && conversation === target) return false;
    }
    return raw !== "about:blank";
  }
};
