// Generated from desktop sources by scripts/build-firefox-extension.cjs.
globalThis.BreakdownDetector = Object.assign({}, (() => { const exports = {}; "use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readChatPage = readChatPage;
// Isolated world in our own ChatGPT view. No message text leaves this function.
function readChatPage() {
    const root = globalThis;
    const composerSelector = [
        '[data-testid="prompt-textarea"]',
        '#prompt-textarea',
        '[contenteditable="true"][data-lexical-editor="true"]',
        'form[data-chatgpt-composer] [data-composer-markdown][contenteditable="true"][role="textbox"]',
        '[data-testid="composer-text-input"]',
        'textarea[name="prompt-textarea"]'
    ].join(',');
    const visible = (element) => Boolean(element && element.getClientRects().length);
    // ChatGPT renders a hidden textarea before the visible rich-text composer on mobile.
    const composer = () => [...document.querySelectorAll(composerSelector)].find(visible);
    const roleIdentity = (role, raw) => {
        const prefix = role === "user" ? "u_" : "a_";
        const direct = prefix + raw;
        if (direct.length <= 200 && /^[a-zA-Z0-9_-]+$/.test(direct))
            return direct;
        const bytes = new TextEncoder().encode(raw);
        let binary = "";
        for (const byte of bytes)
            binary += String.fromCharCode(byte);
        const encoded = btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
        if (prefix.length + encoded.length <= 200)
            return prefix + encoded;
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
        const messages = new Map();
        for (const element of candidates) {
            const roleValue = element.getAttribute("data-turn") ?? element.getAttribute("data-message-author-role") ??
                element.getAttribute("data-conversation-role") ?? (element.hasAttribute("data-user-message-bubble") ? "user" : null);
            if (roleValue !== "user" && roleValue !== "assistant")
                continue;
            const role = roleValue;
            const group = element.closest('[data-turn-key]');
            const turn = element.closest('[data-testid^="conversation-turn-"]') ?? element.closest("article") ??
                element.closest("[data-turn-id]") ?? group ?? element;
            const storedId = turn.getAttribute("data-turn-id") ?? element.getAttribute("data-message-id") ??
                element.querySelector("[data-message-id]")?.getAttribute("data-message-id") ??
                element.closest("[data-turn-id-container]")?.getAttribute("data-turn-id-container");
            const groupKey = group?.getAttribute("data-turn-key");
            const id = groupKey ? roleIdentity(role, groupKey) : storedId;
            if (!id)
                continue;
            const completeControl = role === "assistant" ? [...turn.querySelectorAll("button")].find(button => {
                if (button.closest("pre,code,[data-code-block-preview-pane]"))
                    return false;
                if (group && !element.contains(button) &&
                    !(element.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING))
                    return false;
                const testId = button.getAttribute("data-testid") ?? "";
                if (/^(?:copy-turn-action-button|good-response-turn-action-button|bad-response-turn-action-button)$/.test(testId))
                    return true;
                if (group && button.closest(".turn-action-controls"))
                    return true;
                const label = (button.getAttribute("aria-label") ?? button.getAttribute("title") ?? "").trim();
                return /^(?:copy(?: response| message)?|복사|응답 복사|메시지 복사|good response|bad response|좋은 응답|별로인 응답)$/i.test(label);
            }) : undefined;
            const error = Boolean(turn.querySelector('[data-testid="error-message"], [data-testid="conversation-turn-error"], [role="alert"]'));
            const key = role + ":" + id;
            const previous = messages.get(key);
            const complete = role === "assistant" && Boolean(completeControl);
            if (previous) {
                previous.complete ||= complete;
                previous.error ||= error;
            }
            else
                messages.set(key, { id, role, complete, error });
        }
        return [...messages.values()];
    };
    const readIdentityBaseline = () => {
        const baseline = new Set(readMessages().map(message => message.id));
        for (const element of document.querySelectorAll("[data-turn-id],[data-turn-id-container],[data-message-id]")) {
            for (const attribute of ["data-turn-id", "data-turn-id-container", "data-message-id"]) {
                const id = element.getAttribute(attribute);
                if (id)
                    baseline.add(id);
            }
        }
        for (const group of document.querySelectorAll("[data-turn-key]")) {
            const key = group.getAttribute("data-turn-key");
            if (key) {
                baseline.add(roleIdentity("user", key));
                baseline.add(roleIdentity("assistant", key));
            }
        }
        return [...baseline];
    };
    if (!root.__breakdownProbe) {
        root.__breakdownProbe = { submit: 0, stop: 0, retry: 0, baseline: [] };
        const submitted = () => {
            // Capture existing identities before ChatGPT adds the new user turn.
            // Persistent wrappers also cover virtualized historical messages.
            root.__breakdownProbe.baseline = readIdentityBaseline();
            root.__breakdownProbe.submit++;
        };
        const isComposer = (target) => target instanceof Element && Boolean(target.closest(composerSelector));
        const hasInput = () => {
            const input = composer();
            return Boolean(input && ((input instanceof HTMLTextAreaElement ? input.value : input.textContent) ?? "").trim());
        };
        document.addEventListener("keydown", event => {
            if (event.key === "Enter" && !event.shiftKey && !event.isComposing && isComposer(event.target) && hasInput())
                submitted();
            if (event.key === "Escape" && document.querySelector('[data-testid="stop-button"]'))
                root.__breakdownProbe.stop++;
        }, true);
        document.addEventListener("click", event => {
            const button = event.target instanceof Element ? event.target.closest("button") : null;
            const testId = button?.getAttribute("data-testid") ?? "";
            if (button && (testId === "send-button" || button.id === "composer-submit-button" ||
                button.matches('form[data-chatgpt-composer] button[type="submit"]')) && hasInput())
                submitted();
            if (/stop-button|stop-generating/.test(testId))
                root.__breakdownProbe.stop++;
            if (/retry|regenerate/.test(testId))
                root.__breakdownProbe.retry++;
        }, true);
    }
    const generating = visible(document.querySelector('[data-testid="stop-button"], [data-testid="stop-generating-button"]')) ||
        Boolean(document.querySelector('[data-is-streaming="true"]'));
    const messages = readMessages().map(message => ({ ...message, complete: message.complete && !generating }));
    return {
        conversationId: /\/c\/([a-zA-Z0-9-]+)\/?$/.exec(location.pathname)?.[1] ?? null,
        composer: Boolean(composer()),
        generating, submitSerial: root.__breakdownProbe.submit, stopSerial: root.__breakdownProbe.stop,
        retrySerial: root.__breakdownProbe.retry, submissionBaseline: root.__breakdownProbe.baseline, messages
    };
}

return exports; })(), (() => { const exports = {}; "use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TurnTracker = void 0;
// Identity + submission evidence + explicit completion controls. Never content quality.
class TurnTracker {
    allowImplicitSubmission;
    seen = new Set();
    pending = new Set();
    completed = new Set();
    initialized = false;
    submitSerial = 0;
    stopSerial = 0;
    retrySerial = 0;
    aborted = new Set();
    awaitingSubmission = false;
    submissionBaseline = new Set();
    lastUserId = null;
    stable = new Map();
    constructor(resumePending = [], resumeAborted = [], allowImplicitSubmission = true) {
        this.allowImplicitSubmission = allowImplicitSubmission;
        resumePending.forEach(id => this.pending.add(id));
        resumeAborted.forEach(id => this.aborted.add(id));
    }
    accept(snapshot) {
        const events = [];
        if (!this.initialized) {
            snapshot.messages.forEach(m => this.seen.add(m.id));
            this.submitSerial = snapshot.submitSerial;
            this.stopSerial = snapshot.stopSerial;
            this.retrySerial = snapshot.retrySerial ?? 0;
            this.initialized = true;
            this.lastUserId = snapshot.messages.filter(m => m.role === "user").at(-1)?.id ?? null;
        }
        if (snapshot.submitSerial > this.submitSerial) {
            this.awaitingSubmission = true;
            this.submissionBaseline = new Set(snapshot.submissionBaseline ?? this.seen);
        }
        this.submitSerial = snapshot.submitSerial;
        if (snapshot.stopSerial > this.stopSerial) {
            for (const userId of this.pending) {
                events.push({ type: "aborted", userId });
                this.aborted.add(userId);
            }
            this.pending.clear();
            this.stable.clear();
        }
        this.stopSerial = snapshot.stopSerial;
        if ((snapshot.retrySerial ?? 0) > this.retrySerial) {
            const last = snapshot.messages.filter(m => m.role === "user").at(-1);
            if (last && this.aborted.has(last.id)) {
                this.aborted.delete(last.id);
                this.pending.add(last.id);
                events.push({ type: "submitted", userId: last.id });
            }
        }
        this.retrySerial = snapshot.retrySerial ?? 0;
        const newestUser = snapshot.messages.filter(m => m.role === "user").at(-1);
        const users = snapshot.messages.filter(m => m.role === "user");
        const previousTail = users.findIndex(m => m.id === this.lastUserId);
        // An appended user turn is authoritative even if React, IME, voice input or
        // a changed send button prevented the keyboard/click hook from firing.
        // Prepending/remounting history does not move beyond this known tail.
        if (this.allowImplicitSubmission && !this.awaitingSubmission && previousTail >= 0) {
            for (const message of users.slice(previousTail + 1)) {
                if (this.seen.has(message.id))
                    continue;
                this.pending.add(message.id);
                events.push({ type: "submitted", userId: message.id });
            }
        }
        if (this.awaitingSubmission && newestUser && !this.submissionBaseline.has(newestUser.id)) {
            this.pending.add(newestUser.id);
            events.push({ type: "submitted", userId: newestUser.id });
            this.awaitingSubmission = false;
        }
        snapshot.messages.forEach(message => this.seen.add(message.id));
        if (newestUser && (previousTail >= 0 || this.lastUserId === null || events.some(e => e.type === "submitted")))
            this.lastUserId = newestUser.id;
        let userId = null;
        for (const message of snapshot.messages) {
            if (message.role === "user") {
                userId = message.id;
                continue;
            }
            if (!userId || !this.pending.has(userId))
                continue;
            if (message.error) {
                events.push({ type: "aborted", userId });
                this.aborted.add(userId);
                this.pending.delete(userId);
                continue;
            }
            if (!message.complete || snapshot.generating) {
                this.stable.delete(message.id);
                continue;
            }
            const observations = (this.stable.get(message.id) ?? 0) + 1;
            this.stable.set(message.id, observations);
            if (observations >= 2 && !this.completed.has(message.id)) {
                events.push({ type: "completed", userId, assistantId: message.id });
                this.completed.add(message.id);
                this.pending.delete(userId);
            }
        }
        return events;
    }
}
exports.TurnTracker = TurnTracker;

return exports; })());
