using System.Security.Principal;
using System.ServiceProcess;
using System.Text.Json;

namespace Breakdown.Host;
internal record InstallConfig(string UserSid, string AppPath);
internal static class Program
{
    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    public static readonly string DataDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "BREAKDOWN");
    public static string ConfigPath => Path.Combine(DataDir, "install.json");
    public static string PipeFor(string sid) => "BREAKDOWN-" + sid;
    [STAThread]
    static int Main(string[] args)
    {
        if (args.Contains("--register-service")) return ServiceInstaller.Register();
        if (args.Contains("--guard"))
        {
            using var mutex = new Mutex(false, @"Local\BREAKDOWN.Guard." + WindowsIdentity.GetCurrent().User!.Value + "." + System.Diagnostics.Process.GetCurrentProcess().SessionId);
            bool acquired;
            try { acquired = mutex.WaitOne(0); } catch (AbandonedMutexException) { acquired = true; }
            if (!acquired) return 0;
            try
            {
                ApplicationConfiguration.Initialize();
                Application.Run(new SessionGuard(Value(args, "--pipe")!, Value(args, "--app")!));
            }
            finally { mutex.ReleaseMutex(); }
            return 0;
        }
        if (args.Contains("--configure"))
        {
            var app = Path.GetFullPath(Value(args, "--app")!);
            if (!File.Exists(app)) throw new FileNotFoundException("BREAKDOWN executable missing.", app);
            var previous = File.Exists(ConfigPath) ? JsonSerializer.Deserialize<InstallConfig>(File.ReadAllText(ConfigPath), Json) : null;
            var sid = Value(args, "--sid") ?? previous?.UserSid ?? WindowsIdentity.GetCurrent().User!.Value;
            Directory.CreateDirectory(DataDir);
            File.WriteAllText(ConfigPath, JsonSerializer.Serialize(new InstallConfig(sid, app), Json));
            return 0;
        }
        if (args.Contains("--console"))
        {
            var sid = WindowsIdentity.GetCurrent().User!.Value;
            using var server = new GateServer(Value(args, "--pipe") ?? "BREAKDOWN-Dev", sid,
                Path.Combine(Value(args, "--data") ?? Path.Combine(Environment.CurrentDirectory, ".dev"), "gate.db"),
                int.TryParse(Value(args, "--peer-port"), out var peerPort) ? peerPort : PeerSyncServer.DefaultPort);
            server.Start();
            Thread.Sleep(Timeout.Infinite);
            return 0;
        }
        ServiceBase.Run(new GuardService());
        return 0;
    }
    public static string? Value(string[] args, string key)
    { int i = Array.IndexOf(args, key); return i >= 0 && i + 1 < args.Length ? args[i + 1] : null; }
}
