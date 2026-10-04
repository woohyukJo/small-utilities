# BREAKDOWN Firefox extension privacy

This extension connects ChatGPT conversation progress to the BREAKDOWN Android app on the same device.

It sends the selected conversation identifier, opaque user/assistant message identifiers, submission/completion/abort events, and a locally generated pairing key to `http://127.0.0.1:18432`. This key is not a Google, ChatGPT or Firefox credential.

Message bodies, Google/ChatGPT cookies, passwords, passkeys and browser history are not sent. No analytics or remote service is used by the extension. During an active routine, the background script checks the active tab URL locally to restore the selected conversation while allowing sign-in redirects. Page content observation is limited to ChatGPT.

The pairing key is stored in Firefox extension storage and the app's private preferences. Removing the extension removes its copy. The Android app separately persists routine progress and supports user-configured same-LAN completed-day synchronization with a PC. No messages or login credentials are sent to that PC.

The manifest declares authentication information for the local pairing key, browsing activity for the selected conversation, and website activity for submission/completion events. These data stay on the device between browser and app, apart from the app's separately configured completed-day sync.
