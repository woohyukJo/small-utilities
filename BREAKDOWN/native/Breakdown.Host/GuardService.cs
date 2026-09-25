using System.Diagnostics;
using System.ServiceProcess;
using System.Text.Json;

namespace Breakdown.Host;
internal sealed class GuardService : ServiceBase
{
    private GateServer? server;
    private System.Threading.Timer? monitor;
    private Process? helper;
    private int helperSession = -1;
    private InstallConfig? config;
    public GuardService() { ServiceName = "BreakdownGuard"; CanStop = true; }
    protected override void OnStart(string[] args)
    {
        config = JsonSerializer.Deserialize<InstallConfig>(File.ReadAllText(Program.ConfigPath), Program.Json)!;
        server = new(Program.PipeFor(config.UserSid), config.UserSid, Path.Combine(Program.DataDir, "gate.db"));
        server.Start();
        monitor = new(_ => CheckSession(), null, 0, 2000);
    }
    private void CheckSession()
    {
        lock (this)
        {
            try
            {
                int session = Native.ActiveSession;
                if (session < 0 || config == null) return;
                if (helper is { HasExited: false } && session == helperSession) return;
                if (helper is { HasExited: false }) helper.Kill(true);
                helper?.Dispose();
                helper = Native.StartInSession(session, config.UserSid, Environment.ProcessPath!,
                    "--guard --pipe \"" + Program.PipeFor(config.UserSid) + "\" --app \"" + config.AppPath + "\"");
                helperSession = session;
            }
            catch { /* Retry only our helper on next tick. No foreign process discovery/termination. */ }
        }
    }
    protected override void OnStop()
    {
        monitor?.Dispose();
        lock (this) { if (helper is { HasExited: false }) helper.Kill(true); helper?.Dispose(); }
        server?.Dispose();
    }
}
