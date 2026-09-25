package local.breakdown.mobile

import java.net.URI

object ChatAddress {
    fun conversationId(raw: String): String? = try {
        val uri = URI(raw.trim())
        if (uri.scheme != "https" || uri.host != "chatgpt.com" || uri.userInfo != null || uri.port !in listOf(-1, 443)) null
        else Regex("^/(?:g/[^/]+/)?c/([a-zA-Z0-9_-]{1,200})/?$").matchEntire(uri.path)?.groupValues?.get(1)
    } catch (_: Exception) { null }

    fun url(id: String): String {
        require(Regex("[a-zA-Z0-9_-]{1,200}").matches(id))
        return "https://chatgpt.com/c/$id"
    }
}
