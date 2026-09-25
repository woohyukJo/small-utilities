// Isolated world in our own ChatGPT view. No message text leaves this function.
export function readChatPage() {
  const root = globalThis as typeof globalThis & { __breakdownProbe?: { submit: number; stop: number; retry: number; baseline: string[] } };
  if (!root.__breakdownProbe) {
    root.__breakdownProbe = { submit: 0, stop: 0, retry: 0, baseline: [] };
    const submitted = () => {
      // Capture existing identities before ChatGPT adds the new user turn.
      // Persistent wrappers also cover virtualized historical messages.
      root.__breakdownProbe!.baseline = [...document.querySelectorAll("[data-turn-id],[data-turn-id-container],[data-message-id]")]
        .flatMap(e => ["data-turn-id","data-turn-id-container","data-message-id"].map(k => e.getAttribute(k)).filter((id): id is string => Boolean(id)));
      root.__breakdownProbe!.submit++;
    };
    const isComposer = (target: EventTarget | null) =>
      target instanceof Element && Boolean(target.closest('#prompt-textarea, [data-testid="composer-text-input"], textarea'));
    const hasInput = () => {
      const input = document.querySelector('#prompt-textarea, [data-testid="composer-text-input"], textarea');
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
      if (testId === "send-button" && hasInput()) submitted();
      if (/stop-button|stop-generating/.test(testId)) root.__breakdownProbe!.stop++;
      if (/retry|regenerate/.test(testId)) root.__breakdownProbe!.retry++;
    }, true);
  }
  const visible = (element: Element | null) => Boolean(element && element.getClientRects().length);
  const generating = visible(document.querySelector('[data-testid="stop-button"], [data-testid="stop-generating-button"]')) ||
    Boolean(document.querySelector('[data-is-streaming="true"]'));
  const turnElements = [...document.querySelectorAll('[data-testid^="conversation-turn-"]')];
  const candidates = turnElements.length ? turnElements : [...document.querySelectorAll('[data-message-author-role]')];
  const identities = new Set<string>();
  const messages = candidates.flatMap(element => {
    const role = element.getAttribute("data-turn") ?? element.getAttribute("data-message-author-role") ??
      element.querySelector("[data-message-author-role]")?.getAttribute("data-message-author-role");
    if (role !== "user" && role !== "assistant") return [];
    const turn = element.closest('[data-testid^="conversation-turn-"]') ?? element.closest("article") ??
      element.closest("[data-turn-id]") ?? element;
    const id = turn.getAttribute("data-turn-id") ?? element.getAttribute("data-message-id") ??
      element.querySelector("[data-message-id]")?.getAttribute("data-message-id") ??
      element.closest("[data-turn-id-container]")?.getAttribute("data-turn-id-container");
    if (!id || identities.has(role + ":" + id)) return [];
    identities.add(role + ":" + id);
    const completeControl = turn.querySelector('[data-testid="copy-turn-action-button"], [data-testid="good-response-turn-action-button"], [data-testid="bad-response-turn-action-button"]') ??
      [...turn.querySelectorAll("button")].find(button => {
        if (button.closest("pre,code,[data-code-block-preview-pane]")) return false;
        const label = (button.getAttribute("aria-label") ?? button.getAttribute("title") ?? "").trim();
        return /^(?:copy(?: response| message)?|복사|응답 복사|메시지 복사|good response|bad response|좋은 응답|별로인 응답)$/i.test(label);
      });
    const error = Boolean(turn.querySelector('[data-testid="error-message"], [data-testid="conversation-turn-error"], [role="alert"]'));
    return [{ id, role, complete: role === "assistant" && Boolean(completeControl) && !generating, error }];
  });
  return {
    conversationId: /\/c\/([a-zA-Z0-9-]+)\/?$/.exec(location.pathname)?.[1] ?? null,
    composer: visible(document.querySelector('#prompt-textarea, [data-testid="composer-text-input"]')),
    generating, submitSerial: root.__breakdownProbe.submit, stopSerial: root.__breakdownProbe.stop,
    retrySerial: root.__breakdownProbe.retry, submissionBaseline: root.__breakdownProbe.baseline, messages
  };
}
