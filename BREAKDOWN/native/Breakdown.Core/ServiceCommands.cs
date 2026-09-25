using System.Diagnostics;
namespace Breakdown.Core;
// sc.exe expects one argv value containing the quoted image path.
public static class ServiceCommands
{
    public static string[] Registration(string executable, bool exists)
    {
        if (!Path.IsPathFullyQualified(executable) || executable.Contains('"'))
            throw new ArgumentException("A fully-qualified executable path without quotes is required.", nameof(executable));
        return [
            exists ? "config" : "create", "BreakdownGuard",
            "binPath=", "\"" + executable + "\"",
            "start=", "auto", "DisplayName=", "BREAKDOWN Guard"
        ];
    }
    public static ProcessStartInfo StartInfo(string executable, IEnumerable<string> arguments)
    {
        var info = new ProcessStartInfo(executable) {
            UseShellExecute = false, CreateNoWindow = true,
            RedirectStandardOutput = true, RedirectStandardError = true
        };
        foreach (var argument in arguments) info.ArgumentList.Add(argument);
        return info;
    }
}
