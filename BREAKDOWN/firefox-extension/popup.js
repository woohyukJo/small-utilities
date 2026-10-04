"use strict";
async function update(type) {
  const result = await browser.runtime.sendMessage({type});
  document.getElementById("status").textContent = result.error || `${result.state.testOnly ? "연결 시험" : "오늘의 대화"} ${result.state.count}/3`;
}
document.getElementById("select").onclick = () => update("select");
void update("state");
