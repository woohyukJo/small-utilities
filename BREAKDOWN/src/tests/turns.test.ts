import { test } from "node:test";
import assert from "node:assert/strict";
import { PageSnapshot, MessageSnapshot } from "../protocol";
import { TurnTracker } from "../turn-tracker";
const user = (id: string): MessageSnapshot => ({ id, role: "user", complete: false, error: false });
const reply = (id: string, complete = true, error = false): MessageSnapshot => ({ id, role: "assistant", complete, error });
const snap = (messages: MessageSnapshot[], changes: Partial<PageSnapshot> = {}): PageSnapshot =>
  ({ conversationId: "chat", composer: true, generating: false, submitSerial: 0, stopSerial: 0, messages, ...changes });
test("three explicit user submissions and completed responses count regardless of content", () => {
  const tracker = new TurnTracker(); tracker.accept(snap([]));
  const messages: MessageSnapshot[] = [];
  let count = 0;
  for (let i = 1; i <= 3; i++) {
    messages.push(user("u" + i));
    assert.equal(tracker.accept(snap(messages, { submitSerial: i }))[0].type, "submitted");
    messages.push(reply("a" + i));
    tracker.accept(snap(messages, { submitSerial: i }));
    count += tracker.accept(snap(messages, { submitSerial: i })).filter(e => e.type === "completed").length;
  }
  assert.equal(count, 3);
  assert.deepEqual(tracker.accept(snap(messages, { submitSerial: 3 })), []);
});
test("old history and newly mounted older messages do not count", () => {
  const tracker = new TurnTracker();
  const page = snap([user("old"), reply("old-answer")]);
  for (let i = 0; i < 4; i++) assert.deepEqual(tracker.accept(page), []);
  assert.deepEqual(tracker.accept(snap([user("older"),reply("older-a"),...page.messages])), []);
});
test("a newly appended user turn counts without a keyboard or click signal", () => {
  const t = new TurnTracker();
  const history = [user("previous"),reply("previous-a")];
  t.accept(snap(history));
  const next = snap([...history,user("ime-or-voice")]);
  assert.deepEqual(t.accept(next),[{type:"submitted",userId:"ime-or-voice"}]);
  const done = snap([...next.messages,reply("new-a")]);
  t.accept(done);
  assert.deepEqual(t.accept(done),[{type:"completed",userId:"ime-or-voice",assistantId:"new-a"}]);
  assert.deepEqual(t.accept(done),[]);
});
test("scrolling into unrelated old history without the known tail does not count", () => {
  const t = new TurnTracker(); t.accept(snap([user("latest"),reply("latest-a")]));
  assert.deepEqual(t.accept(snap([user("older"),reply("older-a")])),[]);
  assert.deepEqual(t.accept(snap([user("latest"),reply("latest-a")])),[]);
  assert.deepEqual(t.accept(snap([user("latest"),reply("latest-a"),user("new")])),[{type:"submitted",userId:"new"}]);
});
test("streaming and stopped responses never count, explicit retry may finish once", () => {
  const tracker = new TurnTracker(); tracker.accept(snap([]));
  tracker.accept(snap([user("u")], { submitSerial: 1 }));
  assert.deepEqual(tracker.accept(snap([user("u"), reply("a")], { submitSerial: 1, generating: true })), []);
  assert.equal(tracker.accept(snap([user("u"), reply("a")], { submitSerial: 1, stopSerial: 1 }))[0].type, "aborted");
  for (let i = 0; i < 3; i++) assert.deepEqual(tracker.accept(snap([user("u"), reply("a")], { submitSerial: 1, stopSerial: 1 })), []);
  tracker.accept(snap([user("u"), reply("a2", false)], { submitSerial: 1, stopSerial: 1, retrySerial: 1, generating: true }));
  tracker.accept(snap([user("u"), reply("a2")], { submitSerial: 1, stopSerial: 1, retrySerial: 1 }));
  assert.equal(tracker.accept(snap([user("u"), reply("a2")], { submitSerial: 1, stopSerial: 1, retrySerial: 1 }))[0].type, "completed");
});
test("known pending turn can finish after app restart but historical turns cannot", () => {
  const tracker = new TurnTracker(["pending"]);
  const page = snap([user("old"), reply("old-a"), user("pending"), reply("new-a")]);
  assert.deepEqual(tracker.accept(page), []);
  assert.deepEqual(tracker.accept(page), [{ type: "completed", userId: "pending", assistantId: "new-a" }]);
});
test("a stopped turn resumed after restart requires explicit retry", () => {
  const t = new TurnTracker([], ["u"]);
  const page = snap([user("u"), reply("a")]);
  t.accept(page); assert.deepEqual(t.accept(page), []);
  t.accept({...page,retrySerial:1,generating:true});
  t.accept({...page,retrySerial:1});
  assert.equal(t.accept({...page,retrySerial:1})[0].type,"completed");
});
test("an existing selected conversation starts at zero and only counts newly submitted turns", () => {
  const history = [user("yesterday"),reply("yesterday-a")];
  const t = new TurnTracker();
  t.accept(snap(history));
  assert.deepEqual(t.accept(snap(history)),[]);
  const submitted = snap([...history,user("today")],{submitSerial:1,submissionBaseline:["yesterday","yesterday-a"]});
  assert.deepEqual(t.accept(submitted),[{type:"submitted",userId:"today"}]);
  const done = {...submitted,messages:[...submitted.messages,reply("today-a")]};
  t.accept(done);
  assert.deepEqual(t.accept(done),[{type:"completed",userId:"today",assistantId:"today-a"}]);
  const tomorrow = new TurnTracker();
  tomorrow.accept(done);
  assert.deepEqual(tomorrow.accept(done),[]);
});
test("virtualized history reappearing during send does not count as the new turn", () => {
  const t = new TurnTracker(); t.accept(snap([user("recent"),reply("recent-a")]));
  const history = [user("remounted"),reply("remounted-a"),user("recent"),reply("recent-a")];
  const baseline = ["remounted","remounted-a","recent","recent-a"];
  assert.deepEqual(t.accept(snap(history,{submitSerial:1,submissionBaseline:baseline})),[]);
  assert.deepEqual(t.accept(snap([...history,user("new")],{submitSerial:1,submissionBaseline:baseline})),
    [{type:"submitted",userId:"new"}]);
});
