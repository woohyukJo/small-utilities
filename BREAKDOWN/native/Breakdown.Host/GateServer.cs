using Breakdown.Core;
using System.IO.Pipes;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using System.Text.Json;

namespace Breakdown.Host;
internal sealed record UiHealth(long Handle, bool Responsive, long ReceivedAt, long ShowRequestedAt = 0, string ServiceEpoch = "");
internal sealed record DetectionStatus(string Phase, int Users, int Assistants, int CompletedResponses,
    int SubmitSignals, bool Generating, bool Composer, long ReceivedAt);
internal sealed class GateServer : IDisposable
{
    private readonly string pipe, sid;
    private readonly GateStore store;
    private readonly CancellationTokenSource stop = new();
    private UiHealth health = new(0, false, 0);
    private DetectionStatus detection = new("not_observed", 0, 0, 0, 0, false, false, 0);
    private long showRequestedAt;
    private readonly string epoch = Guid.NewGuid().ToString("N");
    public GateServer(string pipe, string sid, string path) { this.pipe = pipe; this.sid = sid; store = new(path); }
    public void Start() => _ = Accept();
    private async Task Accept()
    {
        while (!stop.IsCancellationRequested)
        {
            NamedPipeServerStream? server = null;
            try
            {
                var acl = new PipeSecurity();
                acl.SetAccessRuleProtection(true, false);
                acl.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(sid), PipeAccessRights.ReadWrite, AccessControlType.Allow));
                acl.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null), PipeAccessRights.FullControl, AccessControlType.Allow));
                // The server identity needs CreateNewInstance for subsequent instances (also in console tests).
                acl.AddAccessRule(new PipeAccessRule(WindowsIdentity.GetCurrent().User!, PipeAccessRights.FullControl, AccessControlType.Allow));
                server = NamedPipeServerStreamAcl.Create(pipe, PipeDirection.InOut, 16,
                    PipeTransmissionMode.Byte, PipeOptions.Asynchronous, 65536, 65536, acl);
                await server.WaitForConnectionAsync(stop.Token);
                _ = Handle(server); server = null;
            }
            catch (OperationCanceledException) { break; }
            catch (Exception e) { Console.Error.WriteLine("Pipe listener: " + e.GetType().Name); await Task.Delay(1000, stop.Token).ConfigureAwait(ConfigureAwaitOptions.SuppressThrowing); }
            finally { server?.Dispose(); }
        }
    }
    private async Task Handle(NamedPipeServerStream stream)
    {
        using (stream)
        using (var reader = new StreamReader(stream, new UTF8Encoding(false), false, 4096, true))
        using (var writer = new StreamWriter(stream, new UTF8Encoding(false), 4096, true) { AutoFlush = true })
        {
            try
            {
                using var timeout = CancellationTokenSource.CreateLinkedTokenSource(stop.Token);
                timeout.CancelAfter(5000);
                // Bounded request; do not permit a client to consume unbounded service memory.
                var line = new StringBuilder();
                var one = new char[1];
                while (line.Length <= 65536 && await reader.ReadAsync(one.AsMemory(), timeout.Token) != 0)
                { if (one[0] == '\n') break; line.Append(one[0]); }
                if (line.Length > 65536) throw new InvalidOperationException("요청이 너무 큽니다.");
                using var request = JsonDocument.Parse(line.ToString());
                string method = request.RootElement.GetProperty("method").GetString()!;
                var a = request.RootElement.GetProperty("args");
                string Text(string name) => a.TryGetProperty(name, out var v) ? v.GetString() ?? "" : "";
                object? result = null;
                var now = DateTimeOffset.UtcNow;
                switch (method)
                {
                    case "GetGateStatus": result = store.Status(); break;
                    case "RequestUiExit": store.RequestUiExit(); result = store.Status(); break;
                    case "Hello": store.ResetEmergency(); result = store.Status(); break;
                    case "SetConversationTarget": store.SetConversationTarget(Text("conversationId")); result = store.Status(); break;
                    case "SetPassword": store.SetPassword(Text("password"), Text("current")); result = store.Status(); break;
                    case "MarkReady": store.MarkReady(Text("conversationId"), Text("targetRevision")); result = store.Status(); break;
                    case "Arm": store.Arm(now); result = store.Status(); break;
                    case "ObserveUserTurn": store.Submit(Text("conversationId"), Text("userId"), Text("targetRevision")); break;
                    case "AbortTurn": store.Abort(Text("conversationId"), Text("userId"), Text("targetRevision")); break;
                    case "RecordCompletedTurn": store.Complete(Text("conversationId"), Text("userId"), Text("assistantId"), now, Text("targetRevision")); result = store.Status(); break;
                    case "ResetEmergency": store.ResetEmergency(); result = store.Status(); break;
                    case "SubmitEmergencyPassword":
                        result = new { correct = store.Emergency(Text("password"), now), status = store.Status() }; break;
                    case "ObserveSessionEvent": store.ObserveSession(Text("kind"), Text("logonKey"), now); result = store.Status(); break;
                    case "ReportUiHealth":
                        health = new(a.GetProperty("handle").GetInt64(), a.GetProperty("responsive").GetBoolean(), now.ToUnixTimeMilliseconds()); break;
                    case "GetUiHealth": result = health with { ShowRequestedAt = showRequestedAt, ServiceEpoch = epoch }; break;
                    case "ReportDetectionStatus":
                        var phase = Text("phase");
                        if (phase is not ("loading" or "login" or "wrong_conversation" or "observing" or "submitted" or "completed" or "aborted" or "error"))
                            throw new InvalidOperationException("알 수 없는 감지 상태입니다.");
                        detection = new(phase, a.GetProperty("users").GetInt32(), a.GetProperty("assistants").GetInt32(),
                            a.GetProperty("completedResponses").GetInt32(), a.GetProperty("submitSignals").GetInt32(),
                            a.GetProperty("generating").GetBoolean(), a.GetProperty("composer").GetBoolean(), now.ToUnixTimeMilliseconds());
                        break;
                    case "GetDetectionStatus": result = detection; break;
                    case "ShowUi": store.RequestUiShow(); showRequestedAt = now.ToUnixTimeMilliseconds(); break;
                    default: throw new InvalidOperationException("지원하지 않는 요청입니다.");
                }
                await writer.WriteLineAsync(JsonSerializer.Serialize(new { ok = true, data = result }, Program.Json));
            }
            catch (Exception e)
            {
                try { await writer.WriteLineAsync(JsonSerializer.Serialize(new { ok = false, error = e is InvalidOperationException ? e.Message : "관리 서비스 요청을 처리하지 못했습니다." }, Program.Json)); }
                catch { /* peer disconnected */ }
            }
        }
    }
    public void Dispose() { stop.Cancel(); /* process exit owns DB lifetime; pending clients may still drain */ }
}
