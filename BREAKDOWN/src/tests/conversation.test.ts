import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalConversationUrl, conversationIdFromUrl, isConversationTarget } from "../conversation";
import { NavigationPolicy, isChatConversation } from "../navigation";
import { emptyStatus } from "../protocol";
import { selectConversationTarget } from "../target-selection";

const target = "11111111-2222-4333-8444-555555555555";

test("canonical and project conversation URLs normalize to the same runtime target", () => {
  assert.equal(canonicalConversationUrl(target), "https://chatgpt.com/c/" + target);
  assert.equal(conversationIdFromUrl("https://chatgpt.com/c/" + target), target);
  assert.equal(conversationIdFromUrl("https://chatgpt.com/g/g-example-project/c/" + target + "?model=example"), target);
  assert.ok(isConversationTarget("https://chatgpt.com/g/g-example-project/c/" + target, target));
  assert.ok(isChatConversation("https://chatgpt.com/g/g-example-project/c/" + target));
  assert.ok(new NavigationPolicy().allows("https://chatgpt.com/c/" + target));
});

test("malformed and foreign conversation URLs are rejected", () => {
  for (const url of [
    "https://example.com/c/" + target,
    "https://chatgpt.com/share/" + target,
    "https://chatgpt.com/c/",
    "https://chatgpt.com/g/project/not-c/" + target,
    "http://chatgpt.com/c/" + target,
    "https://user:password@chatgpt.com/c/" + target
  ]) assert.equal(conversationIdFromUrl(url), null, url);
  assert.equal(isConversationTarget("https://chatgpt.com/c/other", target), false);
});

test("saving the already-selected target still repairs a wrong loaded page", async () => {
  const loaded: string[] = [];
  const result = await selectConversationTarget({
    currentConversationId: "selected-chat",
    persist: async () => { throw new Error("same target must not be rewritten"); },
    applyStatus: async () => { throw new Error("same target has no new status"); },
    currentUrl: () => "https://chatgpt.com/c/wrong-chat",
    loadUrl: async url => { loaded.push(url); }
  }, "selected-chat", true);
  assert.deepEqual(result, { persisted: false, navigated: true });
  assert.deepEqual(loaded, ["https://chatgpt.com/c/selected-chat"]);
});

test("a changed target is persisted before its canonical page loads", async () => {
  const order: string[] = [];
  const saved = { ...emptyStatus, conversationId: "new-chat", targetRevision: "new-revision" };
  const result = await selectConversationTarget({
    currentConversationId: "old-chat",
    persist: async id => { order.push("persist:" + id); return saved; },
    applyStatus: async status => { order.push("status:" + status.targetRevision); },
    currentUrl: () => "https://chatgpt.com/c/old-chat",
    loadUrl: async url => { order.push("load:" + url); }
  }, "new-chat", true);
  assert.deepEqual(result, { persisted: true, navigated: true });
  assert.deepEqual(order, ["persist:new-chat", "status:new-revision", "load:https://chatgpt.com/c/new-chat"]);
});
