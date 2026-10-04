"use strict";
(() => {
  if (globalThis.__breakdownFirefoxObserverActive) return;
  globalThis.__breakdownFirefoxObserverActive = true;
  const {readChatPage, TurnTracker} = globalThis.BreakdownDetector;
  let scope = "", tracker, pending = [], busy = false, debug = false;
  const report = data => { if (debug) document.documentElement.setAttribute("data-breakdown-diagnostic", JSON.stringify(data)); };
  async function inspect() {
    if (busy || document.visibilityState !== "visible") return;
    busy = true;
    try {
      const config = await browser.runtime.sendMessage({type: "state"});
      if (config.error) { report({phase:"connection-error"}); return; }
      const state = config.state;
      debug = state.testOnly === true;
      if (!debug) document.documentElement.removeAttribute("data-breakdown-diagnostic");
      const snapshot = readChatPage();
      report({phase:"observing",composer:snapshot.composer,generating:snapshot.generating,users:snapshot.messages.filter(m=>m.role==="user").length,
        assistants:snapshot.messages.filter(m=>m.role==="assistant").length,complete:snapshot.messages.filter(m=>m.complete).length,pending:pending.length});
      void browser.runtime.sendMessage({type: "diagnostics", summary: {
        composer: snapshot.composer, generating: snapshot.generating,
        users: snapshot.messages.filter(m=>m.role==="user").length,
        assistants: snapshot.messages.filter(m=>m.role==="assistant").length,
        complete: snapshot.messages.filter(m=>m.complete).length,
        pending: pending.length
      }});
      if (snapshot.conversationId !== state.conversationId) { report({phase:"wrong-conversation"}); scope = ""; tracker = null; pending = []; return; }
      if (scope !== state.scope) {
        scope = state.scope;
        // Browser tabs hydrate old history after the extension starts. Require an
        // actual send signal; never infer a new turn solely from appended history.
        tracker = new TurnTracker(state.pendingUserIds, state.abortedUserIds, false);
        pending = [];
      }
      pending.push(...tracker.accept(snapshot));
      if (!pending.length) return;
      const sent = pending.slice(0, 64);
      const result = await browser.runtime.sendMessage({type: "events", payload: {
        scope, conversationId: state.conversationId, events: sent
      }});
      if (!result.error) pending.splice(0, sent.length);
      report({phase:result.error?"send-error":"sent",events:sent.map(e=>e.type),pending:pending.length});
    } catch (_) { report({phase:"script-error"}); /* Retain unacknowledged events for retry. */ }
    finally { busy = false; }
  }
  setInterval(inspect, 1000);
  document.addEventListener("visibilitychange", inspect);
  void inspect();
})();
