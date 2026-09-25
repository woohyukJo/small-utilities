const CHATGPT_ORIGIN = "https://chatgpt.com";
const ID = /^[a-zA-Z0-9_-]{1,200}$/;

export function conversationIdFromUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.origin !== CHATGPT_ORIGIN || url.username || url.password) return null;
    const direct = /^\/c\/([^/]+)\/?$/.exec(url.pathname);
    const project = /^\/g\/[^/]+\/c\/([^/]+)\/?$/.exec(url.pathname);
    const id = decodeURIComponent((direct ?? project)?.[1] ?? "");
    return ID.test(id) ? id : null;
  } catch { return null; }
}

export function canonicalConversationUrl(id: string): string {
  if (!ID.test(id)) throw new Error("대화 주소에서 올바른 대화 ID를 찾지 못했습니다.");
  return CHATGPT_ORIGIN + "/c/" + id;
}

export function isConversationTarget(raw: string, id: string | null | undefined): boolean {
  return Boolean(id) && conversationIdFromUrl(raw) === id;
}
