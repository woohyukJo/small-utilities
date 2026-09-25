import { test } from "node:test";
import assert from "node:assert/strict";
import { NavigationPolicy } from "../navigation";
test("outside sign-in only ChatGPT conversations are available", () => {
  const p = new NavigationPolicy();
  for (const url of ["https://chatgpt.com/", "https://chatgpt.com/c/abc-123"]) assert.ok(p.allows(url));
  for (const url of ["https://example.com", "https://chatgpt.com.evil.test/", "https://chatgpt.com/share/a"])
    assert.equal(p.allows(url), false, url);
});
test("onboarding and an already-unlocked app do not apply the lock's website restriction", () => {
  const p = new NavigationPolicy(false);
  assert.ok(p.authorizeNavigation("https://new-login-provider.example/continue"));
  assert.ok(p.allows("about:blank"));
  p.setLocked(true);
  assert.equal(p.allows("https://new-login-provider.example/continue"), false);
  p.beginAuth();
  assert.ok(p.allows("https://new-login-provider.example/continue"));
  p.endAuth(); p.setLocked(false);
  assert.ok(p.allows("https://new-login-provider.example/continue"));
});
test("ChatGPT sign-in and expiry redirects start login without an extra approval", () => {
  for (const start of ["https://chatgpt.com/auth/login", "https://auth.openai.com/", "https://auth0.openai.com/authorize"]) {
    const p = new NavigationPolicy(); assert.ok(p.authorizeNavigation(start)); assert.ok(p.authenticating);
  }
});
test("a background identity-provider frame does not suspend ordinary turn counting", () => {
  const p = new NavigationPolicy(false);
  assert.ok(p.authorizeNavigation("https://accounts.google.com/gsi/iframe", true));
  assert.equal(p.authenticating, false);
});
test("SSO, MFA and callback changes are not rejected by guessed paths or state", () => {
  const p = new NavigationPolicy(); p.beginAuth();
  const flow = [
    "https://auth.openai.com/", "https://auth.openai.com/log-in/password",
    "https://accounts.google.com/v3/signin/challenge/selection?flowName=GeneralOAuthFlow",
    "https://login.microsoftonline.com/common/federation/oauth2?state=server-owned",
    "https://tenant.example-idp.com/mfa/push",
    "https://auth.openai.com/api/accounts/callback/google?code=opaque&state=not-observed-by-browser-host",
    "https://auth.openai.com/api/accounts/callback/enterprise?code=opaque",
    "https://chatgpt.com/api/auth/callback?code=server-validated", "https://chatgpt.com/"
  ];
  for (const url of flow) assert.ok(p.authorizeNavigation(url), url);
});
test("login supports blank popups and authentication frames without an arbitrary expiry", () => {
  const p = new NavigationPolicy(); p.beginAuth();
  assert.ok(p.authorizeNavigation("about:blank"));
  assert.ok(p.authorizeNavigation("https://challenges.cloudflare.com/cdn-cgi/challenge-platform/test", true));
  assert.ok(p.authorizeNavigation("https://accounts.google.com/new-route/not-known-to-the-app", true));
  assert.ok(p.authenticating);
});
test("finishing/cancelling login restores the conversation boundary", () => {
  const p = new NavigationPolicy(); p.beginAuth(); p.endAuth();
  assert.equal(p.allows("https://tenant.example-idp.com/mfa"), false);
  assert.equal(p.allows("about:blank"), false);
  assert.ok(p.allows("https://chatgpt.com/c/current"));
});
test("authentication never launches local files, plaintext or arbitrary protocols", () => {
  const p = new NavigationPolicy(); p.beginAuth();
  for (const url of ["file:///C:/Windows", "javascript:alert(1)", "data:text/html,test", "http://example.com/",
    "mailto:a@example.com", "ms-settings:display", "https://user:password@example.com/"])
    assert.equal(p.authorizeNavigation(url), false, url);
});
