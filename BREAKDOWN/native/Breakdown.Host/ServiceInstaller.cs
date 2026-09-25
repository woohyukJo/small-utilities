using Breakdown.Core;
using System.Diagnostics;
using System.Security.Principal;
using System.ServiceProcess;
using System.Text;
namespace Breakdown.Host;
internal static class ServiceInstaller
{
    public static int Register()
    {
        var log = new StringBuilder();
        var logPath = Path.Combine(Program.DataDir, "install-service.log");
        log.AppendLine("BREAKDOWN service registration " + DateTimeOffset.Now.ToString("O"));
        try
        {
            using var identity = WindowsIdentity.GetCurrent();
            if (!new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator))
                throw new InvalidOperationException("Administrator elevation is required (Windows error 5).");
            var sc = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "sc.exe");
            var exe = Environment.ProcessPath ?? throw new InvalidOperationException("Cannot locate the service executable.");
            var query = Run(sc, ["query", "BreakdownGuard"], log);
            if (query is not (0 or 1060))
                throw new InvalidOperationException("Service query failed with Windows exit code " + query + ".");
            Check(Run(sc, ServiceCommands.Registration(exe, query == 0), log), "Service registration");
            Check(Run(sc, ["failure", "BreakdownGuard", "reset=", "86400", "actions=", "restart/3000/restart/5000/restart/10000"], log), "Service recovery settings");
            var started = Run(sc, ["start", "BreakdownGuard"], log);
            if (started != 1056) Check(started, "Service start");
            using var controller = new ServiceController("BreakdownGuard");
            controller.WaitForStatus(ServiceControllerStatus.Running, TimeSpan.FromSeconds(20));
            log.AppendLine("Service state: Running");
            log.AppendLine("SUCCESS");
            return 0;
        }
        catch (Exception error) { log.AppendLine("FAILED: " + error.Message); return 1; }
        finally
        {
            try { Directory.CreateDirectory(Program.DataDir); File.WriteAllText(logPath, log.ToString(), new UTF8Encoding(false)); }
            catch (Exception error) { log.AppendLine("Log write failed: " + error.Message); }
            Console.WriteLine(log.ToString());
        }
    }
    private static int Run(string executable, string[] args, StringBuilder log)
    {
        using var process = Process.Start(ServiceCommands.StartInfo(executable, args))
            ?? throw new InvalidOperationException("Unable to start sc.exe.");
        var stdout = process.StandardOutput.ReadToEndAsync();
        var stderr = process.StandardError.ReadToEndAsync();
        if (!process.WaitForExit(30000)) { process.Kill(); throw new System.TimeoutException("sc.exe " + args[0] + " timed out."); }
        Task.WaitAll(stdout, stderr);
        log.AppendLine("sc.exe " + args[0] + " -> exit " + process.ExitCode);
        log.AppendLine(stdout.Result);
        if (!string.IsNullOrWhiteSpace(stderr.Result)) log.AppendLine(stderr.Result);
        return process.ExitCode;
    }
    private static void Check(int code, string stage)
    {
        if (code != 0) throw new InvalidOperationException(stage + " failed with Windows exit code " + code + ".");
    }
}
