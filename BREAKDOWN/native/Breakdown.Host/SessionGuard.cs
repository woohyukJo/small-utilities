using Breakdown.Core;
using Microsoft.Win32;
using System.Diagnostics;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;

namespace Breakdown.Host;
internal sealed class SessionGuard : ApplicationContext
{
    private readonly string pipe, app;
    private readonly System.Windows.Forms.Timer timer = new() { Interval = 1000 };
    private readonly List<Form> backdrops = [];
    private readonly Native.HookProc hookCallback;
    private IntPtr hook;
    private Process? ui;
    private DateTime started, unhealthySince;
    private bool locked, ticking, sessionLocked;
    private string screensKey = "";
    private long lastShow;
    private string? serviceEpoch;
    private bool recoveryRaised = true;
    public SessionGuard(string pipe, string app)
    {
        this.pipe = pipe; this.app = app;
        hookCallback = KeyHook;
        SystemEvents.SessionSwitch += SessionSwitch;
        timer.Tick += async (_, _) => await Tick();
        timer.Start();
        // Retry logon registration before starting UI; never convert helper restarts into a new day.
        _ = Initialize();
    }
    private bool initialized;
    private async Task Initialize()
    {
        try
        {
            await Call<object>("ObserveSessionEvent", new { kind = "logon", logonKey = Native.LogonKey() });
            initialized = true;
        }
        catch { /* Tick retries; no UI until authoritative state available. */ }
    }
    private async void SessionSwitch(object sender, SessionSwitchEventArgs e)
    {
        sessionLocked = e.Reason == SessionSwitchReason.SessionLock;
        if (e.Reason == SessionSwitchReason.SessionUnlock)
        {
            try { await Call<object>("ObserveSessionEvent", new { kind = "unlock", logonKey = Native.LogonKey() }); }
            catch { pendingUnlock = true; }
        }
    }
    private bool pendingUnlock;
    private async Task Tick()
    {
        if (ticking) return;
        ticking = true;
        try
        {
            if (!initialized) { await Initialize(); return; }
            if (pendingUnlock)
            {
                await Call<object>("ObserveSessionEvent", new { kind = "unlock", logonKey = Native.LogonKey() });
                pendingUnlock = false;
            }
            var status = await Call<GateStatus>("GetGateStatus");
            locked = status.Armed && !status.Unlocked;
            UpdateBackdrops();
            var health = await Call<UiHealth>("GetUiHealth");
            if (serviceEpoch != null && serviceEpoch != health.ServiceEpoch)
            {
                // A restarted service will launch a fresh owner. Retire only this helper's UI.
                if (ui is { HasExited: false }) ui.Kill(true);
                ExitThread(); return;
            }
            serviceEpoch = health.ServiceEpoch;
            if (ui == null || ui.HasExited)
            {
                // A quit may have been accepted after the first status read.
                // Read again after observing process exit before deciding to respawn.
                var launchStatus = await Call<GateStatus>("GetGateStatus");
                locked = launchStatus.Armed && !launchStatus.Unlocked;
                UpdateBackdrops();
                if (launchStatus.UiDismissed)
                {
                    ui?.Dispose(); ui = null; unhealthySince = default;
                    return;
                }
                SetRecoveryCover(true); StartUi(); return;
            }
            var hwnd = new IntPtr(health.Handle);
            Native.GetWindowThreadProcessId(hwnd, out int owner);
            if (health.ShowRequestedAt > lastShow && owner == ui.Id)
            {
                lastShow = health.ShowRequestedAt; Native.ShowWindow(hwnd, 9); Native.SetForegroundWindow(hwnd);
            }
            if (!locked || sessionLocked) { unhealthySince = default; return; }
            var primary = Screen.PrimaryScreen!.Bounds;
            bool geometry = Native.GetWindowRect(hwnd, out var bounds) &&
                bounds.Left <= primary.Left && bounds.Top <= primary.Top &&
                bounds.Right >= primary.Right && bounds.Bottom >= primary.Bottom;
            bool topmost = (Native.GetWindowLongPtr(hwnd, -20).ToInt64() & 8) != 0;
            bool healthy = owner == ui.Id && health.Responsive &&
                DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - health.ReceivedAt < 6000 &&
                Native.IsWindowVisible(hwnd) && !Native.IsIconic(hwnd) && geometry && topmost;
            if (healthy)
            {
                unhealthySince = default;
                // Stable healthy state: leave the opaque recovery windows behind
                // the topmost app. Never promote/demote them every polling tick.
                SetRecoveryCover(false);
                Native.GetWindowThreadProcessId(Native.GetForegroundWindow(), out int foreground);
                if (foreground != ui.Id) Native.SetForegroundWindow(hwnd);
            }
            else
            {
                // The UI can leave fullscreen immediately after an unlock.
                // Do not mistake that permission change for a failed window.
                var latest = await Call<GateStatus>("GetGateStatus");
                if (!latest.Armed || latest.Unlocked) { locked = false; UpdateBackdrops(); return; }
                if (unhealthySince == default) unhealthySince = DateTime.UtcNow;
                SetRecoveryCover(true);
                if (DateTime.UtcNow - started > TimeSpan.FromSeconds(15) &&
                    DateTime.UtcNow - unhealthySince > TimeSpan.FromSeconds(6))
                {
                    // Only the Process returned by our own Start is eligible.
                    ui.Kill(true); ui.WaitForExit(2000); StartUi();
                }
            }
        }
        catch { if (locked) { UpdateBackdrops(); SetRecoveryCover(true); } }
        finally { ticking = false; }
    }
    private void StartUi()
    {
        ui?.Dispose();
        ui = Process.Start(new ProcessStartInfo(app, "--managed --pipe \"" + pipe + "\"")
        { UseShellExecute = false, WorkingDirectory = Path.GetDirectoryName(app)!, WindowStyle = ProcessWindowStyle.Hidden });
        started = DateTime.UtcNow; unhealthySince = default;
    }
    private void UpdateBackdrops()
    {
        string key = string.Join(";", Screen.AllScreens.Select(s => s.Bounds.ToString()));
        if (!locked || key != screensKey)
        {
            foreach (var f in backdrops) f.Dispose(); backdrops.Clear(); screensKey = key;
        }
        if (locked && backdrops.Count == 0)
        {
            recoveryRaised = true;
            foreach (var screen in Screen.AllScreens)
            {
                var f = new Form {
                    FormBorderStyle = FormBorderStyle.None, StartPosition = FormStartPosition.Manual,
                    Bounds = screen.Bounds, TopMost = true, ShowInTaskbar = false,
                    BackColor = Color.FromArgb(15, 20, 24), ForeColor = Color.White, Text = "BREAKDOWN recovery"
                };
                f.Controls.Add(new Label { Dock = DockStyle.Fill, TextAlign = ContentAlignment.MiddleCenter,
                    Font = new Font("Segoe UI", 18), Text = "BREAKDOWN\n대화 화면을 연결하고 있습니다.\n\n복구가 계속 실패하면 관리자 복구 안내를 사용하세요." });
                f.FormClosing += (_, e) => { if (locked && e.CloseReason == CloseReason.UserClosing) e.Cancel = true; };
                f.Show(); backdrops.Add(f);
            }
        }
        if (locked)
        {
            for (int i = 0; i < backdrops.Count; i++)
            {
                var f = backdrops[i];
                if (!f.Visible) f.Show();
                if (f.WindowState != FormWindowState.Normal) f.WindowState = FormWindowState.Normal;
                if (f.Bounds != Screen.AllScreens[i].Bounds) f.Bounds = Screen.AllScreens[i].Bounds;
                if (f.TopMost != recoveryRaised) f.TopMost = recoveryRaised;
            }
        }
        if (locked && hook == IntPtr.Zero) hook = Native.SetWindowsHookEx(13, hookCallback, Native.GetModuleHandle(null), 0);
        if (!locked && hook != IntPtr.Zero) { Native.UnhookWindowsHookEx(hook); hook = IntPtr.Zero; }
    }
    private void SetRecoveryCover(bool raised)
    {
        recoveryRaised = raised;
        foreach (var form in backdrops)
            if (form.TopMost != raised) form.TopMost = raised;
    }
    private IntPtr KeyHook(int code, IntPtr w, IntPtr l)
    {
        if (code >= 0 && locked && !sessionLocked)
        {
            int key = Marshal.ReadInt32(l);
            bool alt = (Native.GetAsyncKeyState(0x12) & 0x8000) != 0;
            bool ctrl = (Native.GetAsyncKeyState(0x11) & 0x8000) != 0;
            if (key is 0x5B or 0x5C || (alt && key is 0x09 or 0x73) || (ctrl && key == 0x1B))
                return new IntPtr(1);
        }
        return Native.CallNextHookEx(hook, code, w, l);
    }
    private async Task<T> Call<T>(string method, object? args = null)
    {
        using var stream = new NamedPipeClientStream(".", pipe, PipeDirection.InOut, PipeOptions.Asynchronous);
        using var timeout = new CancellationTokenSource(4000);
        await stream.ConnectAsync(timeout.Token);
        using var writer = new StreamWriter(stream, new UTF8Encoding(false), 4096, true) { AutoFlush = true };
        using var reader = new StreamReader(stream, Encoding.UTF8, false, 4096, true);
        await writer.WriteLineAsync(JsonSerializer.Serialize(new { method, args = args ?? new { } }, Program.Json));
        var line = await reader.ReadLineAsync(timeout.Token);
        using var doc = JsonDocument.Parse(line!);
        if (!doc.RootElement.GetProperty("ok").GetBoolean()) throw new InvalidOperationException("Guard request failed");
        return doc.RootElement.GetProperty("data").Deserialize<T>(Program.Json)!;
    }
    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            timer.Dispose(); SystemEvents.SessionSwitch -= SessionSwitch;
            if (hook != IntPtr.Zero) Native.UnhookWindowsHookEx(hook);
            foreach (var f in backdrops) f.Dispose();
            ui?.Dispose();
        }
        base.Dispose(disposing);
    }
}
