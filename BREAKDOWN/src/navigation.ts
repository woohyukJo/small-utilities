import { conversationIdFromUrl } from "./conversation";
// A browser host must not reimplement ChatGPT's OAuth client or guess its routes.
const authHosts = new Set([
  "auth.openai.com", "auth0.openai.com", "accounts.google.com",
  "login.microsoftonline.com", "login.live.com", "appleid.apple.com"
]);
export function isChatConversation(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.origin === "https://chatgpt.com" &&
      (url.pathname === "/" || conversationIdFromUrl(raw) !== null);
  } catch { return false; }
}
function isHttps(raw: string): boolean {
  try { const u = new URL(raw); return u.protocol === "https:" && !u.username && !u.password; }
  catch { return false; }
}
export class NavigationPolicy {
  private active = false;
  constructor(private locked = true) {}
  setLocked(value: boolean): void { this.locked = value; }
  beginAuth(): void { this.active = true; }
  endAuth(): void { this.active = false; }
  get authenticating(): boolean { return this.active; }
  authorizeNavigation(raw: string, frame = false): boolean {
    // ChatGPT's Sign in button and expiry redirects need no second approval.
    if (!frame && isHttps(raw)) {
      const u = new URL(raw);
      if (!this.active && (authHosts.has(u.hostname) ||
        (u.origin === "https://chatgpt.com" && /^\/(?:auth|api\/auth)(?:\/|$)/.test(u.pathname))))
        this.beginAuth();
    }
    return this.allows(raw, frame);
  }
  allows(raw: string, _frame = false): boolean {
    if (raw === "about:blank") return this.active || !this.locked;
    if (!isHttps(raw)) return false;
    // HTTPS redirects/SSO/MFA remain inside our sandboxed browser. The sites
    // validate state/code; this app neither reads tokens nor makes that decision.
    if (this.active || !this.locked) return true;
    return isChatConversation(raw);
  }
}
