export interface GateStatus {
  armed: boolean; passwordSet: boolean; ready: boolean; day: string;
  count: number; unlocked: boolean; reason: string | null;
  conversationId: string | null; pendingUserIds: string[]; abortedUserIds?: string[]; emergencyCount: number;
  uiDismissed?: boolean; targetRevision: string;
}
export interface RpcReply<T> { ok: boolean; data?: T; error?: string }
export interface MessageSnapshot {
  id: string; role: "user" | "assistant"; complete: boolean; error: boolean;
}
export interface PageSnapshot {
  conversationId: string | null; composer: boolean; generating: boolean;
  submitSerial: number; stopSerial: number; retrySerial?: number;
  submissionBaseline?: string[]; messages: MessageSnapshot[];
}
export const emptyStatus: GateStatus = {
  armed: false, passwordSet: false, ready: false, day: "", count: 0,
  unlocked: false, reason: null, conversationId: null,
  pendingUserIds: [], emergencyCount: 0, targetRevision: ""
};
