using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.Principal;

namespace Breakdown.Host;
internal static class Native
{
    [StructLayout(LayoutKind.Sequential)] internal struct Rect { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct StartupInfo
    {
        public int cb; public string? reserved, desktop, title;
        public int x, y, xSize, ySize, xCount, yCount, fill, flags;
        public short show, reservedSize; public IntPtr reservedPtr, input, output, error;
    }
    [StructLayout(LayoutKind.Sequential)] private struct ProcessInfo { public IntPtr process, thread; public int pid, tid; }
    internal delegate IntPtr HookProc(int code, IntPtr wParam, IntPtr lParam);
    [DllImport("kernel32.dll")] private static extern uint WTSGetActiveConsoleSessionId();
    [DllImport("wtsapi32.dll", SetLastError = true)] private static extern bool WTSQueryUserToken(uint session, out IntPtr token);
    [DllImport("userenv.dll", SetLastError = true)] private static extern bool CreateEnvironmentBlock(out IntPtr environment, IntPtr token, bool inherit);
    [DllImport("userenv.dll")] private static extern bool DestroyEnvironmentBlock(IntPtr environment);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CreateProcessAsUser(IntPtr token, string application, string command, IntPtr processAttributes,
        IntPtr threadAttributes, bool inherit, uint flags, IntPtr environment, string directory, ref StartupInfo startup, out ProcessInfo info);
    [DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr handle);
    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool GetTokenInformation(IntPtr token, int kind, IntPtr data, int size, out int returned);
    [DllImport("user32.dll")] internal static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] internal static extern bool IsIconic(IntPtr hwnd);
    [DllImport("user32.dll")] internal static extern bool GetWindowRect(IntPtr hwnd, out Rect rect);
    [DllImport("user32.dll")] internal static extern int GetWindowThreadProcessId(IntPtr hwnd, out int pid);
    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] internal static extern IntPtr GetWindowLongPtr(IntPtr hwnd, int index);
    [DllImport("user32.dll")] internal static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] internal static extern bool SetForegroundWindow(IntPtr hwnd);
    [DllImport("user32.dll")] internal static extern bool ShowWindow(IntPtr hwnd, int command);
    [DllImport("user32.dll")] internal static extern IntPtr SetWindowsHookEx(int kind, HookProc proc, IntPtr module, uint thread);
    [DllImport("user32.dll")] internal static extern bool UnhookWindowsHookEx(IntPtr hook);
    [DllImport("user32.dll")] internal static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr w, IntPtr l);
    [DllImport("user32.dll")] internal static extern short GetAsyncKeyState(int key);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] internal static extern IntPtr GetModuleHandle(string? name);
    public static int ActiveSession => unchecked((int)WTSGetActiveConsoleSessionId());
    public static string LogonKey()
    {
        using var identity = WindowsIdentity.GetCurrent();
        var buffer = Marshal.AllocHGlobal(128);
        try
        {
            if (!GetTokenInformation(identity.Token, 10, buffer, 128, out _)) throw new System.ComponentModel.Win32Exception();
            return identity.User!.Value + ":" + Marshal.ReadInt64(buffer, 8).ToString("x");
        }
        finally { Marshal.FreeHGlobal(buffer); }
    }
    public static Process? StartInSession(int session, string expectedSid, string exe, string arguments)
    {
        if (!WTSQueryUserToken((uint)session, out var token)) return null;
        IntPtr environment = IntPtr.Zero;
        try
        {
            using var identity = new WindowsIdentity(token);
            if (identity.User?.Value != expectedSid) return null;
            if (!CreateEnvironmentBlock(out environment, token, false)) return null;
            var startup = new StartupInfo { cb = Marshal.SizeOf<StartupInfo>(), desktop = @"winsta0\default", flags = 1, show = 0 };
            if (!CreateProcessAsUser(token, exe, "\"" + exe + "\" " + arguments, IntPtr.Zero, IntPtr.Zero,
                false, 0x400, environment, Path.GetDirectoryName(exe)!, ref startup, out var info))
                throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
            CloseHandle(info.thread); CloseHandle(info.process);
            return Process.GetProcessById(info.pid);
        }
        finally { if (environment != IntPtr.Zero) DestroyEnvironmentBlock(environment); CloseHandle(token); }
    }
}
