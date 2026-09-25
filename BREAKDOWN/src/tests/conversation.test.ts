import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalConversationUrl, conversationIdFromUrl, isConversationTarget } from "../conversation";
import { NavigationPolicy, isChatConversation } from "../navigation";

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
