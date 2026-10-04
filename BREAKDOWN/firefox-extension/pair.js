"use strict";
(async () => {
  const key = new URLSearchParams(location.hash.slice(1)).get("key");
  if (!key) return;
  history.replaceState(null, "", "/pair");
  const result = await browser.runtime.sendMessage({type: "pair", key});
  if (result.error) { document.querySelector("p").textContent = result.error; return; }
  location.replace("https://chatgpt.com/" + (result.state.conversationId ? "c/" + encodeURIComponent(result.state.conversationId) : ""));
})();
