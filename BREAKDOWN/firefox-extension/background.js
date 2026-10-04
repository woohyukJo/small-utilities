"use strict";
const endpoint = "http://127.0.0.1:18432";
globalThis.breakdownDiagnostics = {};
async function request(route, payload = {}, overrideKey) {
  const {key} = await browser.storage.local.get("key");
  const token = overrideKey || key;
  if (!token) throw new Error("BREAKDOWN 앱에서 Firefox 연결을 열어 주세요.");
  const response = await fetch(endpoint + route, {
    method: "POST", headers: {"Content-Type": "application/json", Authorization: "Bearer " + token},
    body: JSON.stringify(payload), signal: AbortSignal.timeout(4000), credentials: "omit", cache: "no-store"
  });
  globalThis.breakdownDiagnostics.lastBridgeResponse = {route, status: response.status,
    events: (payload.events || []).map(event => event.type), at: Date.now()};
  if (!response.ok) throw new Error("앱 연결을 다시 확인해 주세요.");
  return response.json();
}
browser.runtime.onMessage.addListener(async (message, sender) => {
  try {
    if (message.type === "pair") {
      const source = new URL(sender.url);
      if (source.origin !== endpoint || source.pathname !== "/pair" || !/^[a-f0-9]{64}$/.test(message.key)) throw new Error("Invalid pairing source");
      const state = await request("/v1/state", {}, message.key);
      await browser.storage.local.set({key: message.key});
      return {state};
    }
    const fromChat = sender.tab && new URL(sender.url).origin === "https://chatgpt.com";
    const fromExtension = !sender.tab && sender.url?.startsWith(browser.runtime.getURL(""));
    if (!fromChat && !fromExtension) throw new Error("Invalid sender");
    if (message.type === "diagnostics" && fromChat) {
      const s = message.summary;
      globalThis.breakdownDiagnostics.detection = {composer: !!s.composer, generating: !!s.generating,
        users: Number(s.users), assistants: Number(s.assistants), complete: Number(s.complete), pending: Number(s.pending)};
      return {};
    }
    if (message.type === "state") return {state: await request("/v1/state")};
    if (message.type === "events" && fromChat) {
      const id = /^\/(?:g\/[^/]+\/)?c\/([a-zA-Z0-9_-]{1,200})\/?$/.exec(new URL(sender.url).pathname)?.[1];
      if (!id || id !== message.payload.conversationId) throw new Error("Conversation changed");
      return {state: await request("/v1/events", message.payload)};
    }
    if (message.type === "select" && fromExtension) {
      const [tab] = await browser.tabs.query({active: true, currentWindow: true});
      return {state: await request("/v1/target", {url: tab.url})};
    }
    throw new Error("Unknown request");
  } catch (error) { return {error: error.message}; }
});
browser.runtime.onInstalled.addListener(async () => {
  for (const tab of await browser.tabs.query({url: "https://chatgpt.com/*"})) {
    await browser.tabs.executeScript(tab.id, {file: "detector.js"}).catch(()=>{});
    await browser.tabs.executeScript(tab.id, {file: "content.js"}).catch(()=>{});
  }
});
