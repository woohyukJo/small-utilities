// Isolated world in our own ChatGPT view. No message text leaves this function.
export function readChatPage() {
  const root = globalThis as typeof globalThis & { __breakdownProbe?: { submit: number; stop: number; retry: number; baseline: string[] } };
  const composerSelector = [
    '[data-testid="prompt-textarea"]',
    '#prompt-textarea',
    '[contenteditable="true"][data-lexical-editor="true"]',
    'form[data-chatgpt-composer] [data-composer-markdown][contenteditable="true"][role="textbox"]',
    '[data-testid="composer-text-input"]',
    'textarea[name="prompt-textarea"]'
  ].join(',');
  const visible = (element: Element | null) => Boolean(element && element.getClientRects().length);
  const roleIdentity = (role: "user" | "assistant", raw: string) => {
    const prefix = role === "user" ? "u_" : "a_";
    const direct = prefix + raw;
    if (direct.length <= 200 && /^[a-zA-Z0-9_-]+$/.test(direct)) return direct;
    const bytes = new TextEncoder().encode(raw);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    const encoded = btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
    if (prefix.length + encoded.length <= 200) return prefix + encoded;
    let first = 2166136261, second = 2246822519;
    for (const byte of bytes) {
      first = Math.imul(first ^ byte, 16777619);
      second = Math.imul(second ^ byte, 3266489917);
    }
    const suffix = (first >>> 0).toString(16).padStart(8, "0") + (second >>> 0).toString(16).padStart(8, "0");
    return prefix + encoded.slice(0, 179) + "_" + suffix;
  };
  const readMessages = () => {
    const candidates = [...document.querySelectorAll([
      '[data-testid^="conversation-turn-"]',
      '[data-turn="user"]',
      '[data-turn="assistant"]',
      '[data-message-author-role]',
      '[data-turn-key] [data-user-message-bubble]',
      '[data-turn-key] [data-conversation-role="assistant"]'
    ].join(','))];
    const messages = new Map<string, { id: string; role: "user" | "assistant"; complete: boolean; error: boolean }>();
    for (const element of candidates) {
      const roleValue = element.getAttribute("data-turn") ?? element.getAttribute("data-message-author-role") ??
        element.getAttribute("data-conversation-role") ?? (element.hasAttribute("data-user-message-bubble") ? "user" : null);
      if (roleValue !== "user" && roleValue !== "assistant") continue;
      const role = roleValue as "user" | "assistant";
      const group = element.closest('[data-turn-key]');
      const turn = element.closest('[data-testid^="conversation-turn-"]') ?? element.closest("article") ??
        element.closest("[data-turn-id]") ?? group ?? element;
      const storedId = turn.getAttribute("data-turn-id") ?? element.getAttribute("data-message-id") ??
        element.querySelector("[data-message-id]")?.getAttribute("data-message-id") ??
        element.closest("[data-turn-id-container]")?.getAttribute("data-turn-id-container");
      const groupKey = group?.getAttribute("data-turn-key");
      const id = groupKey ? roleIdentity(role, groupKey) : storedId;
      if (!id) continue;
      const completeControl = role === "assistant" ? [...turn.querySelectorAll("button")].find(button => {
        if (button.closest("pre,code,[data-code-block-preview-pane]")) return false;
        if (group && !element.contains(button) &&
            !(element.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING)) return false;
        const testId = button.getAttribute("data-testid") ?? "";
        if (/^(?:copy-turn-action-button|good-response-turn-action-button|bad-response-turn-action-button)$/.test(testId)) return true;
        if (group && button.closest(".turn-action-controls")) return true;
        const label = (button.getAttribute("aria-label") ?? button.getAttribute("title") ?? "").trim();
        return /^(?:copy(?: response| message)?|복사|응답 복사|메시지 복사|good response|bad response|좋은 응답|별로인 응답)$/i.test(label);
      }) : undefined;
      const error = Boolean(turn.querySelector('[data-testid="error-message"], [data-testid="conversation-turn-error"], [role="alert"]'));
      const key = role + ":" + id;
      const previous = messages.get(key);
      const complete = role === "assistant" && Boolean(completeControl);
      if (previous) { previous.complete ||= complete; previous.error ||= error; }
      else messages.set(key, { id, role, complete, error });
    }
    return [...messages.values()];
  };
  const readIdentityBaseline = () => {
    const baseline = new Set(readMessages().map(message => message.id));
    for (const element of document.querySelectorAll("[data-turn-id],[data-turn-id-container],[data-message-id]")) {
      for (const attribute of ["data-turn-id", "data-turn-id-container", "data-message-id"]) {
        const id = element.getAttribute(attribute);
        if (id) baseline.add(id);
      }
    }
    for (const group of document.querySelectorAll("[data-turn-key]")) {
      const key = group.getAttribute("data-turn-key");
      if (key) { baseline.add(roleIdentity("user", key)); baseline.add(roleIdentity("assistant", key)); }
    }
    return [...baseline];
  };
  if (!root.__breakdownProbe) {
    root.__breakdownProbe = { submit: 0, stop: 0, retry: 0, baseline: [] };
    const submitted = () => {
      // Capture existing identities before ChatGPT adds the new user turn.
      // Persistent wrappers also cover virtualized historical messages.
      root.__breakdownProbe!.baseline = readIdentityBaseline();
      root.__breakdownProbe!.submit++;
    };
    const isComposer = (target: EventTarget | null) =>
      target instanceof Element && Boolean(target.closest(composerSelector));
    const hasInput = () => {
      const input = document.querySelector(composerSelector);
      return Boolean(input && ((input instanceof HTMLTextAreaElement ? input.value : input.textContent) ?? "").trim());
    };
    document.addEventListener("keydown", event => {
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing && isComposer(event.target) && hasInput())
        submitted();
      if (event.key === "Escape" && document.querySelector('[data-testid="stop-button"]'))
        root.__breakdownProbe!.stop++;
    }, true);
    document.addEventListener("click", event => {
      const button = event.target instanceof Element ? event.target.closest("button") : null;
      const testId = button?.getAttribute("data-testid") ?? "";
      if (button && (testId === "send-button" || button.id === "composer-submit-button" ||
          button.matches('form[data-chatgpt-composer] button[type="submit"]')) && hasInput()) submitted();
      if (/stop-button|stop-generating/.test(testId)) root.__breakdownProbe!.stop++;
      if (/retry|regenerate/.test(testId)) root.__breakdownProbe!.retry++;
    }, true);
  }
  const generating = visible(document.querySelector('[data-testid="stop-button"], [data-testid="stop-generating-button"]')) ||
    Boolean(document.querySelector('[data-is-streaming="true"]'));
  const messages = readMessages().map(message => ({ ...message, complete: message.complete && !generating }));
  return {
    conversationId: /\/c\/([a-zA-Z0-9-]+)\/?$/.exec(location.pathname)?.[1] ?? null,
    composer: visible(document.querySelector(composerSelector)),
    generating, submitSerial: root.__breakdownProbe.submit, stopSerial: root.__breakdownProbe.stop,
    retrySerial: root.__breakdownProbe.retry, submissionBaseline: root.__breakdownProbe.baseline, messages
  };
}
