package local.breakdown.mobile

import org.junit.Assert.*
import org.junit.Test

class ChatAddressTest {
    @Test fun normalizesOnlyRealConversationUrls() {
        assertEquals("test-id", ChatAddress.conversationId("https://chatgpt.com/c/test-id?model=example"))
        assertEquals("test-id", ChatAddress.conversationId("https://chatgpt.com/g/project/c/test-id"))
        assertNull(ChatAddress.conversationId("https://chatgpt.com.evil.example/c/test-id"))
        assertNull(ChatAddress.conversationId("https://chatgpt.com/share/test-id"))
        assertNull(ChatAddress.conversationId("file:///c/test-id"))
    }
}
