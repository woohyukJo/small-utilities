package local.breakdown.mobile.sync

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import local.breakdown.mobile.GateRepository
import java.util.concurrent.Executors

/** Background service/app process shares one scheduler; neither cookies nor message text enter it. */
class PeerSyncController(context: Context, private val gate: GateRepository) {
    private val handler = Handler(Looper.getMainLooper())
    private val executor = Executors.newSingleThreadExecutor()
    private val power = context.getSystemService(Context.POWER_SERVICE) as PowerManager
    private var inFlight = false
    private var scheduled = false
    private var generation = 0L
    private var pendingPair: Long? = null
    var statusText: String = "PC 연결 안 됨"
        private set
    private val loop = Runnable { scheduled = false; synchronize() }

    fun start() { gate.listen { requestSoon() }; requestSoon() }
    fun requestSoon() {
        if (gate.peerConfiguration() == null || inFlight) return
        handler.removeCallbacks(loop); scheduled = true; handler.post(loop)
    }
    fun disconnect() {
        generation++; pendingPair = null; gate.setPeerConfiguration(null); handler.removeCallbacks(loop); scheduled = false
        statusText = "PC 연결 안 됨"
    }
    fun cancelPairing() {
        if (pendingPair == null) return
        generation++; pendingPair = null; requestSoon()
    }

    fun pair(raw: String, callback: (String?) -> Unit) {
        val config = try { PeerConfig.parse(raw) } catch (_: Exception) { callback("PC의 연결 정보를 그대로 붙여넣으세요."); return }
        generation++; val epoch = generation; pendingPair = epoch
        executor.execute {
            val response = runCatching { PeerClient().exchange(config, emptyList()) }
            handler.post {
                if (epoch != generation) return@post
                pendingPair = null
                response.onSuccess { days ->
                    gate.setPeerConfiguration(raw)
                    applyDays(days)
                    statusText = "같은 Wi-Fi PC와 연결됨"
                    callback(null); requestSoon()
                }.onFailure { callback("PC에 연결하지 못했어요. 같은 Wi-Fi, PC 동기화 설정과 방화벽을 확인하세요.") }
            }
        }
    }

    private fun synchronize() {
        val raw = gate.peerConfiguration() ?: return
        if (inFlight) return
        if (!power.isInteractive) { schedule(60000); return }
        val config = try { PeerConfig.parse(raw) } catch (_: Exception) { statusText = "PC 연결 정보를 다시 설정하세요."; return }
        val days = gate.completedDays(); val epoch = generation
        inFlight = true
        executor.execute {
            val result = runCatching { PeerClient().exchange(config, days) }
            handler.post {
                inFlight = false
                if (epoch != generation) { requestSoon(); return@post }
                result.onSuccess { applyDays(it); statusText = "PC 완료 상태 동기화됨" }
                    .onFailure { statusText = "PC 연결 대기 중 · 오프라인" }
                schedule(if (gate.engine.status().unlocked) 30000 else 5000)
            }
        }
    }
    private fun applyDays(days: List<String>) {
        val known = gate.engine.persistedState().peerCompletedDays
        val missing = days.filterNot(known::contains)
        if (missing.isNotEmpty()) gate.update { engine -> missing.forEach { engine.acceptPeerCompletion(it) } }
    }
    private fun schedule(delay: Long) {
        if (gate.peerConfiguration() == null) return
        if (scheduled) handler.removeCallbacks(loop)
        scheduled = true; handler.postDelayed(loop, delay)
    }
}
