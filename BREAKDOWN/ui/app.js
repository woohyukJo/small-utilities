const $ = id => document.getElementById(id);
let state = {}, dialogMode = "password", submitting = false, targetSaving = false;
let renderedTarget;
const call = async (name, args = {}) => {
  const result = await window.breakdown.action(name, args);
  if (result && result.ok === false) throw new Error(result.error);
  return result;
};
window.breakdown.onState(next => {
  state = next;
  const targetUrl = next.conversationId ? "https://chatgpt.com/c/" + next.conversationId : "";
  const displayedCount = next.armed ? next.count : next.ready ? 1 : 0;
  $("count").textContent = displayedCount;
  document.querySelector(".denominator").textContent = next.armed ? "/ 3" : "/ 1";
  $("day").textContent = next.armed ? next.day.replaceAll("-", ". ") : "테스트 대화";
  $("badge").textContent = next.armed ? "대화 중" : !next.conversationId ? "설정 필요" : next.ready ? "완료" : "테스트 중";
  for (let i = 1; i <= 3; i++) {
    $("step" + i).classList.toggle("done", displayedCount >= i);
    $("step" + i).hidden = !next.armed && i > 1;
  }
  $("mode").textContent = next.preview ? "미리보기 · 잠금 없음" : next.connected ? "CHATGPT WEB" : "서비스 연결 필요";
  $("notice").textContent = next.error || (next.preview ? "미리보기입니다. 실제 잠금은 설치 후 설정을 완료해야 활성화됩니다." : "");
  $("login").textContent = next.authenticating ? "로그인 다시 시작" : "로그인 / 다시 연결";
  $("cancel-login").hidden = !next.authenticating;
  $("setup").hidden = next.armed;
  $("settings").hidden = !next.armed;
  $("settings").disabled = !next.unlocked;
  $("arm").disabled = !(next.conversationId && next.passwordSet && next.ready && next.connected && !next.preview);
  $("password").textContent = next.passwordSet ? "✓ 비상 비밀번호 설정됨" : "② 비상 비밀번호 설정";
  $("test-note").textContent = !next.conversationId ? "③ 먼저 사용할 ChatGPT 대화를 지정하세요."
    : next.ready ? "✓ 선택한 대화의 테스트 감지 완료" : "③ 선택한 대화에서 테스트 1턴을 완료하세요.";
  $("target-summary").textContent = targetUrl || "사용할 대화를 아직 지정하지 않았어요.";
  if (renderedTarget !== targetUrl) {
    renderedTarget = targetUrl;
    $("target-url").value = targetUrl;
  }
  $("open-target").disabled = !next.conversationId;
  $("progress-description").textContent = !next.armed
    ? !next.conversationId ? "계속 사용할 ChatGPT 대화를 먼저 지정하세요."
      : next.ready ? "감지를 확인했어요. 아래에서 잠금을 시작할 수 있어요." : "메시지를 보내고 답변이 끝나면 1/1로 바뀌어요."
    : "3턴을 마친 뒤 ESC로 창 모드로 돌아갈 수 있어요.";
  if ($("dialog").open && dialogMode === "emergency")
    $("dialog-description").textContent = "연속 " + next.emergencyCount + " / 10회 · 정확히 10회 입력하면 오늘만 해제돼요.";
});
async function setTarget(name, args = {}) {
  if (targetSaving) return;
  targetSaving = true;
  $("target-save").disabled = true; $("target-current").disabled = true;
  $("target-error").textContent = "";
  try { await call(name, args); }
  catch (error) { $("target-error").textContent = error.message; }
  finally { targetSaving = false; $("target-save").disabled = false; $("target-current").disabled = false; }
}
$("target-save").onclick = () => setTarget("set-target-url", { url: $("target-url").value.trim() });
$("target-current").onclick = () => setTarget("set-current-target");
async function openDialog(mode) {
  dialogMode = mode; await call("modal", { open: "true" });
  $("form").reset(); $("dialog-error").textContent = "";
  $("confirm-label").hidden = mode !== "password";
  $("current-label").hidden = mode !== "password" || !state.passwordSet;
  $("dialog-title").textContent = mode === "emergency" ? "오늘만 비상 해제" : "비상 비밀번호 설정";
  $("dialog-description").textContent = mode === "emergency" ? "비밀번호를 10회 연속 입력하세요. 오입력·취소하면 횟수가 초기화돼요." : "Windows 비밀번호와 별개예요. 앱이 연결되지 않을 때 사용할 비밀번호를 정하세요.";
  $("dialog").showModal(); $("secret").focus();
}
async function closeDialog() { $("dialog").close(); $("form").reset(); await call("modal", { open: "false" }); }
$("password").onclick = () => openDialog("password");
$("settings").onclick = () => openDialog("password");
$("emergency").onclick = () => openDialog("emergency");
$("cancel").onclick = closeDialog;
$("dialog").addEventListener("cancel", event => { event.preventDefault(); void closeDialog(); });
$("form").onsubmit = async event => {
  event.preventDefault(); if (submitting) return; submitting = true; $("dialog-error").textContent = "";
  try {
    const password = $("secret").value;
    if (dialogMode === "password") {
      if (password !== $("confirm").value) throw new Error("두 비밀번호가 일치하지 않습니다.");
      await call("password", { password, current: $("current").value }); await closeDialog();
    } else {
      const result = await call("emergency", { password });
      $("secret").value = ""; $("secret").focus();
      if (!result.correct) $("dialog-error").textContent = "비밀번호가 다릅니다. 연속 횟수를 초기화했어요.";
      if (result.status.unlocked) await closeDialog();
    }
  } catch (error) { $("dialog-error").textContent = error.message; }
  finally { submitting = false; }
};
for (const name of ["login","cancel-login","retry","close","arm","open-target"])
  $(name).onclick = async () => { try { await call(name); } catch (error) { $("notice").textContent = error.message; } };
call("status");
let peerInfo = {enabled:false};
function renderPeer() {
  $("peer-status").textContent = peerInfo.enabled ? "연결 정보를 휴대폰의 PC 연결 화면에 붙여넣으세요." : "휴대폰 연결이 꺼져 있어요. 켜면 이 앱의 동기화 포트만 같은 서브넷에 허용합니다.";
  $("peer-enable").disabled = peerInfo.enabled;
  $("peer-disable").disabled = !peerInfo.enabled;
  const host = $("peer-address").value;
  $("peer-copy").disabled = !peerInfo.enabled || !host;
  $("peer-code").value = peerInfo.enabled && host ? JSON.stringify({version:1,host,port:peerInfo.port,fingerprint:peerInfo.fingerprint,token:peerInfo.token}) : "";
}
async function loadPeer(action) {
  $("peer-error").textContent = "";
  try {
    peerInfo = await call(action);
    $("peer-address").replaceChildren();
    for (const address of peerInfo.addresses || []) {
      const option = document.createElement("option"); option.value = address; option.textContent = address; $("peer-address").append(option);
    }
    renderPeer();
  } catch(error) { $("peer-error").textContent = error.message; }
}
$("peer-settings").onclick = async () => { await call("modal",{open:"true"}); $("peer-dialog").showModal(); await loadPeer("peer-info"); };
$("peer-address").onchange = renderPeer;
$("peer-enable").onclick = () => loadPeer("peer-enable");
$("peer-disable").onclick = () => loadPeer("peer-disable");
$("peer-copy").onclick = () => call("peer-copy",{text:$("peer-code").value});
async function closePeer() { $("peer-dialog").close(); $("peer-code").value=""; peerInfo={enabled:false}; await call("modal",{open:"false"}); }
$("peer-close").onclick = closePeer;
$("peer-dialog").addEventListener("cancel",event=>{event.preventDefault(); void closePeer();});
