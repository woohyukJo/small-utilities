package local.breakdown.mobile

import android.app.Activity
import android.app.AlertDialog
import android.text.InputType
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView

object GatePasswordDialog {
    fun show(activity: Activity, repository: GateRepository, emergency: Boolean, changed: () -> Unit) {
        val fields = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL; setPadding(24,8,24,8) }
        fun field(label: String) = EditText(activity).apply { hint = label; inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD; fields.addView(this) }
        val current = if (!emergency && repository.hasPassword()) field("기존 비밀번호") else null
        val password = field(if (emergency) "비상 비밀번호" else "새 비밀번호")
        val confirm = if (!emergency) field("새 비밀번호 확인") else null
        val message = TextView(activity).apply { text = if (emergency) "10회 연속 정확히 입력하면 오늘만 해제됩니다." else "Windows 비밀번호와 별개입니다."; fields.addView(this) }
        var busy = false
        val dialog = AlertDialog.Builder(activity).setTitle(if (emergency) "오늘 비상 해제" else "비상 비밀번호 설정")
            .setView(fields).setNegativeButton("취소", null).setPositiveButton("확인", null).create()
        dialog.setOnDismissListener { repository.engine.cancelEmergency(); password.text.clear(); current?.text?.clear(); confirm?.text?.clear() }
        dialog.setOnShowListener {
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                if (busy) return@setOnClickListener
                if (!emergency && password.text.toString() != confirm?.text.toString()) { message.text = "두 비밀번호가 일치하지 않습니다."; return@setOnClickListener }
                busy = true
                val chars = password.text.toString().toCharArray(); val old = current?.text?.toString()?.toCharArray() ?: charArrayOf()
                Thread {
                    val result = runCatching { if (emergency) repository.checkPassword(chars) else { repository.setPassword(chars, old); true } }
                    chars.fill('\u0000'); old.fill('\u0000')
                    activity.runOnUiThread {
                        busy = false
                        if (!dialog.isShowing || activity.isDestroyed) return@runOnUiThread
                        result.onSuccess { correct ->
                            if (emergency) {
                                runCatching { repository.update { it.emergencyResult(correct) } }.onSuccess { state ->
                                    password.text.clear()
                                    message.text = if (correct) "연속 ${state.emergencyStreak} / 10회" else "비밀번호가 다릅니다. 횟수가 초기화됐어요."
                                    if (state.unlocked) dialog.dismiss()
                                }.onFailure { message.text = it.message }
                            } else { dialog.dismiss(); changed() }
                        }.onFailure { message.text = it.message }
                    }
                }.start()
            }
        }
        dialog.show()
    }
}
