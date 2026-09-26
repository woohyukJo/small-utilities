import { canonicalConversationUrl, isConversationTarget } from "./conversation";
import { GateStatus } from "./protocol";

export interface TargetSelectionPort {
  currentConversationId: string | null;
  persist(conversationId: string): Promise<GateStatus>;
  applyStatus(status: GateStatus): Promise<void>;
  currentUrl(): string;
  beforeNavigate?(): void;
  loadUrl(url: string): Promise<void>;
}

export async function selectConversationTarget(
  port: TargetSelectionPort,
  conversationId: string,
  navigate: boolean
): Promise<{ persisted: boolean; navigated: boolean }> {
  let persisted = false;
  if (port.currentConversationId !== conversationId) {
    const status = await port.persist(conversationId);
    await port.applyStatus(status);
    persisted = true;
  }
  let navigated = false;
  if (navigate && !isConversationTarget(port.currentUrl(), conversationId)) {
    port.beforeNavigate?.();
    await port.loadUrl(canonicalConversationUrl(conversationId));
    navigated = true;
  }
  return { persisted, navigated };
}
