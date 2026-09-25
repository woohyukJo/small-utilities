import { PageSnapshot } from "./protocol";
export type TurnEvent =
  | { type: "submitted"; userId: string }
  | { type: "aborted"; userId: string }
  | { type: "completed"; userId: string; assistantId: string };
// Identity + submission evidence + explicit completion controls. Never content quality.
export class TurnTracker {
  private seen = new Set<string>();
  private pending = new Set<string>();
  private completed = new Set<string>();
  private initialized = false;
  private submitSerial = 0;
  private stopSerial = 0;
  private retrySerial = 0;
  private aborted = new Set<string>();
  private awaitingSubmission = false;
  private submissionBaseline = new Set<string>();
  private lastUserId: string | null = null;
  private stable = new Map<string, number>();
  constructor(resumePending: string[] = [], resumeAborted: string[] = []) {
    resumePending.forEach(id => this.pending.add(id)); resumeAborted.forEach(id => this.aborted.add(id));
  }
  accept(snapshot: PageSnapshot): TurnEvent[] {
    const events: TurnEvent[] = [];
    if (!this.initialized) {
      snapshot.messages.forEach(m => this.seen.add(m.id));
      this.submitSerial = snapshot.submitSerial; this.stopSerial = snapshot.stopSerial;
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
      for (const userId of this.pending) { events.push({ type: "aborted", userId }); this.aborted.add(userId); }
      this.pending.clear(); this.stable.clear();
    }
    this.stopSerial = snapshot.stopSerial;
    if ((snapshot.retrySerial ?? 0) > this.retrySerial) {
      const last = snapshot.messages.filter(m => m.role === "user").at(-1);
      if (last && this.aborted.has(last.id)) {
        this.aborted.delete(last.id); this.pending.add(last.id);
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
    if (!this.awaitingSubmission && previousTail >= 0) {
      for (const message of users.slice(previousTail + 1)) {
        if (this.seen.has(message.id)) continue;
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
    let userId: string | null = null;
    for (const message of snapshot.messages) {
      if (message.role === "user") { userId = message.id; continue; }
      if (!userId || !this.pending.has(userId)) continue;
      if (message.error) {
        events.push({ type: "aborted", userId }); this.aborted.add(userId); this.pending.delete(userId); continue;
      }
      if (!message.complete || snapshot.generating) { this.stable.delete(message.id); continue; }
      const observations = (this.stable.get(message.id) ?? 0) + 1;
      this.stable.set(message.id, observations);
      if (observations >= 2 && !this.completed.has(message.id)) {
        events.push({ type: "completed", userId, assistantId: message.id });
        this.completed.add(message.id); this.pending.delete(userId);
      }
    }
    return events;
  }
}
