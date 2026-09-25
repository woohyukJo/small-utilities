using Breakdown.Core;
using System.Diagnostics;
using System.Reflection;
using System.Text.Json;
using Microsoft.Data.Sqlite;
if (args.Length > 0 && args[0] == "--probe-argv")
{
    Console.WriteLine(JsonSerializer.Serialize(args.Skip(1).ToArray()));
    return;
}
int checks = 0;
void Check(bool value, string name) { if (!value) throw new Exception("FAIL: " + name); checks++; Console.WriteLine("PASS " + name); }
var root = Path.Combine(Path.GetTempPath(), "breakdown-tests-" + Guid.NewGuid());
Directory.CreateDirectory(root);
var succeeded = false;
try
{
var file = Path.Combine(root, "gate.db");
var targetA = "11111111-2222-4333-8444-555555555555";
var targetB = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
var targetC = "99999999-8888-4777-8666-555555555555";
var lifecycleFile = Path.Combine(root, "lifecycle.db");
var lifecycleNow = DateTimeOffset.Parse("2026-09-25T01:00:00Z");
using (var lifecycle = new GateStore(lifecycleFile))
{
    lifecycle.RequestUiExit();
    Check(lifecycle.Status().UiDismissed, "onboarding UI can be exited");
    lifecycle.RequestUiShow();
    Check(!lifecycle.Status().UiDismissed, "manual launch reopens onboarding");
    lifecycle.SetConversationTarget(targetA);
    lifecycle.SetPassword("exit-test"); lifecycle.MarkReady(); lifecycle.Arm(lifecycleNow);
    bool refused = false;
    try { lifecycle.RequestUiExit(); } catch (InvalidOperationException) { refused = true; }
    Check(refused && !lifecycle.Status().UiDismissed, "locked UI exit is rejected");
    for (int i=0;i<3;i++) { lifecycle.Submit(targetA,"exit-u"+i); lifecycle.Complete(targetA,"exit-u"+i,"exit-a"+i,lifecycleNow); }
    lifecycle.RequestUiExit();
    Check(lifecycle.Status().UiDismissed && lifecycle.Status().Unlocked, "normal exit accepted after three turns");
}
using (var lifecycle = new GateStore(lifecycleFile))
{
    Check(lifecycle.Status().UiDismissed, "intentional exit survives service or helper restart");
    lifecycle.ObserveSession("logon","same-day-reboot",lifecycleNow.AddHours(1));
    Check(lifecycle.Status().UiDismissed, "same-day reboot does not reopen intentionally closed UI");
    lifecycle.RequestUiShow();
    Check(!lifecycle.Status().UiDismissed && lifecycle.Status().Count==3, "manual reopen retains today's completed status");
    lifecycle.RequestUiExit();
    lifecycle.ObserveSession("unlock","next-day-unlock",lifecycleNow.AddDays(1));
    Check(!lifecycle.Status().UiDismissed && !lifecycle.Status().Unlocked, "next day's session trigger requires UI again");
}
var before = DateTimeOffset.Parse("2026-09-23T18:59:59Z"); // KST 03:59:59
var after = before.AddSeconds(1);
Check(GateStore.DayAt(before) == "2026-09-23", "KST 04:00 boundary before");
Check(GateStore.DayAt(after) == "2026-09-24", "KST 04:00 boundary after");
using (var store = new GateStore(file))
{
    Check(store.Status().ConversationId == null && !store.Status().Ready, "fresh DB starts without a conversation target");
    bool rejected = false; try { store.Arm(before); } catch (InvalidOperationException) { rejected = true; }
    Check(rejected, "cannot arm before onboarding");
    rejected = false; try { store.MarkReady(); } catch (InvalidOperationException) { rejected = true; }
    Check(rejected, "readiness requires a selected conversation");
    store.SetConversationTarget(targetA);
    store.SetPassword("test-password"); store.MarkReady(); store.ObserveSession("logon", "session-1", before); store.Arm(before);
    Check(store.Status().Armed && !store.Status().Unlocked, "arm starts locked");
    store.Complete(targetA, "fake", "fake-a", before);
    Check(store.Status().Count == 0, "completion without submission ignored");
    for (int i = 1; i <= 2; i++) { store.Submit(targetA, "u" + i); store.Complete(targetA, "u" + i, "a" + i, before); }
    store.Complete(targetA, "u2", "a2", before); store.Submit(targetA, "u2"); store.Complete(targetA, "u2", "another", before);
    Check(store.Status().Count == 2, "duplicate and regeneration cannot increment");
    store.ObserveSession("logon", "session-1", after);
    Check(store.Status().Day == "2026-09-23" && store.Status().Count == 2, "helper restart after boundary preserves OS session day");
}
using (var store = new GateStore(file))
{
    Check(store.Status().Count == 2, "two completed turns survive reopen");
    store.Submit(targetA, "u3"); store.Abort(targetA, "u3"); store.Complete(targetA, "u3", "a3", after);
    Check(!store.Status().Unlocked, "aborted turn cannot unlock");
    store.Submit(targetA, "u3"); store.Complete(targetA, "u3", "a3-new", after);
    Check(store.Status().Unlocked && store.Status().Count == 3, "explicit retry finishes third turn");
    store.ObserveSession("unlock", "session-1", after);
    Check(!store.Status().Unlocked && store.Status().Count == 0, "unlock event starts new day");
    for (int i = 0; i < 9; i++) store.Emergency("test-password", after);
    Check(!store.Status().Unlocked && store.Status().EmergencyCount == 9, "nine passwords insufficient");
    store.Emergency("wrong", after);
    Check(store.Status().EmergencyCount == 0, "wrong password resets consecutive counter");
    store.Emergency("test-password", after); store.ResetEmergency();
    Check(store.Status().EmergencyCount == 0, "cancel resets counter");
    for (int i = 0; i < 10; i++) store.Emergency("test-password", after);
    Check(store.Status().Unlocked && store.Status().Reason == "emergency", "tenth password unlocks current day");
    store.ObserveSession("logon", "session-2", after.AddHours(2));
    Check(store.Status().Unlocked, "same day reboot remains unlocked");
    store.SetPassword("new-password", "test-password");
    store.ObserveSession("unlock", "session-2", after.AddDays(1));
    Check(!store.Status().Unlocked, "emergency does not unlock tomorrow");
    Check(!store.Emergency("test-password", after.AddDays(1)), "old password no longer works");
    store.Submit(targetA, "first"); store.Complete(targetA, "first", "answer", after.AddDays(1));
    Check(store.Status().Count == 1, "confirmed turn is persisted");
}
using (var store = new GateStore(file)) Check(store.Status().EmergencyCount == 0, "process restart resets emergency progress");
var targetFile = Path.Combine(root, "runtime-target.db");
using (var store = new GateStore(targetFile))
{
    store.SetConversationTarget(targetA);
    store.SetPassword("target-test"); store.MarkReady(); store.Arm(before);
    store.Submit(targetA, "a-complete"); store.Complete(targetA, "a-complete", "a-answer", before);
    store.Submit(targetA, "a-pending");
    var beforeChange = store.Status();
    store.SetConversationTarget(targetB);
    var changed = store.Status();
    Check(changed.ConversationId == targetB && changed.Count == 1 && !changed.Ready && !changed.Unlocked,
        "target change preserves earned progress and lock while clearing readiness");
    bool rejected = false;
    try { store.Complete(targetA, "a-pending", "late-a-answer", before); } catch (InvalidOperationException) { rejected = true; }
    Check(rejected && store.Status().Count == 1, "late response from old target cannot increment after change");
    store.Complete(targetB, "historical-b", "historical-b-answer", before);
    Check(store.Status().Count == 1, "history in newly selected target cannot count without submission");
    store.Submit(targetB, "b-pending");
    store.SetConversationTarget(targetB);
    Check(store.Status().PendingUserIds.Contains("b-pending"), "saving the same target is idempotent and keeps pending state");
    store.Complete(targetB, "b-pending", "b-answer", before);
    store.Submit(targetB, "b-final"); store.Complete(targetB, "b-final", "b-final-answer", before);
    Check(store.Status().Unlocked && store.Status().Count == 3, "fresh responses in replacement target finish the daily requirement");
    store.RequestUiExit();
    var reason = store.Status().Reason;
    store.SetConversationTarget(targetC);
    var unlockedChange = store.Status();
    Check(unlockedChange.Unlocked && unlockedChange.Count == 3 && unlockedChange.Reason == reason && unlockedChange.UiDismissed,
        "target change after unlock preserves unlocked reason and dismissal state");
}
using (var store = new GateStore(targetFile))
{
    Check(store.Status().ConversationId == targetC && store.Status().Count == 3, "runtime target persists across restart");
    store.ObserveSession("unlock", "next-target-day", after);
    Check(store.Status().ConversationId == targetC && store.Status().Count == 0 && !store.Status().Unlocked,
        "next day keeps configured target and resets daily progress");
}

var legacyFile = Path.Combine(root, "legacy.db");
using (var seed = new GateStore(legacyFile))
{
    seed.SetConversationTarget(targetA);
    seed.SetPassword("legacy-password");
    seed.MarkReady();
    seed.ObserveSession("logon", "legacy-logon", before);
    seed.Arm(before);
    seed.Submit(targetA, "legacy-complete"); seed.Complete(targetA, "legacy-complete", "legacy-answer", before);
    seed.Submit(targetA, "legacy-pending");
}
using (var legacy = new SqliteConnection("Data Source=" + legacyFile))
{
    legacy.Open();
    using var command = legacy.CreateCommand();
    command.CommandText = "DELETE FROM settings WHERE k='targetConversationId';";
    command.ExecuteNonQuery();
}
using (var migrated = new GateStore(legacyFile))
{
    var migratedStatus = migrated.Status();
    Check(migratedStatus.ConversationId == targetA && migratedStatus.Ready && migratedStatus.Count == 1 &&
        migratedStatus.PendingUserIds.Contains("legacy-pending"), "legacy DB derives target from active day and preserves state");
    Check(migrated.Emergency("legacy-password", before), "legacy migration preserves password hash and salt");
    migrated.ResetEmergency();
    migrated.ObserveSession("logon", "legacy-logon", after);
    Check(migrated.Status().Day == "2026-09-23", "legacy migration preserves logon key across helper restart");
}
using (var migratedAgain = new GateStore(legacyFile))
{
    Check(migratedAgain.Status().ConversationId == targetA, "second restart keeps migrated target");
    migratedAgain.SetConversationTarget(targetB);
}
using (var migratedAfterChoice = new GateStore(legacyFile))
{
    Check(migratedAfterChoice.Status().ConversationId == targetB && migratedAfterChoice.Status().Count == 1,
        "later user target choice is not overwritten by migration fallback");
}
var legacyUnlockedFile = Path.Combine(root, "legacy-unlocked.db");
using (var seed = new GateStore(legacyUnlockedFile))
{
    seed.SetConversationTarget(targetA);
    seed.SetPassword("legacy-unlocked-password"); seed.MarkReady(); seed.Arm(before);
    for (int i = 0; i < 3; i++) { seed.Submit(targetA, "legacy-u" + i); seed.Complete(targetA, "legacy-u" + i, "legacy-a" + i, before); }
    seed.RequestUiExit();
}
using (var legacy = new SqliteConnection("Data Source=" + legacyUnlockedFile))
{
    legacy.Open();
    using var command = legacy.CreateCommand();
    command.CommandText = "DELETE FROM settings WHERE k='targetConversationId';";
    command.ExecuteNonQuery();
}
using (var migratedUnlocked = new GateStore(legacyUnlockedFile))
{
    var state = migratedUnlocked.Status();
    Check(state.ConversationId == targetA && state.Unlocked && state.Reason == "conversation" && state.UiDismissed,
        "legacy migration preserves unlock reason and intentional UI dismissal");
}
Console.WriteLine("All " + checks + " checks passed.");

var revisionFile = Path.Combine(root, "target-revision.db");
string savedRevision;
using (var store = new GateStore(revisionFile))
{
    store.SetConversationTarget(targetA);
    var first = store.Status();
    store.SetPassword("revision-test"); store.MarkReady(targetA, first.TargetRevision); store.Arm(before);
    store.Submit(targetA, "pending-a", first.TargetRevision);
    store.SetConversationTarget(targetA);
    Check(store.Status().TargetRevision == first.TargetRevision && store.Status().Ready && store.Status().PendingUserIds.Contains("pending-a"),
        "same target preserves revision, readiness and in-flight turn");
    store.SetConversationTarget(targetB); store.SetConversationTarget(targetA);
    savedRevision = store.Status().TargetRevision;
    Check(savedRevision != first.TargetRevision, "A-B-A selection uses a new persisted revision");
    foreach (Action stale in new Action[] {
        () => store.Submit(targetA,"pending-a",first.TargetRevision),
        () => store.Abort(targetA,"pending-a",first.TargetRevision),
        () => store.Complete(targetA,"pending-a","late",before,first.TargetRevision),
        () => store.MarkReady(targetA,first.TargetRevision)
    })
    {
        bool refused = false; try { stale(); } catch (InvalidOperationException) { refused = true; }
        Check(refused, "stale revision cannot mutate selected target after A-B-A");
    }
    Check(store.Status().Count == 0 && !store.Status().Ready && !store.Status().PendingUserIds.Contains("pending-a"),
        "late requests cannot resurrect retired pending turn or readiness");
    store.Submit(targetA,"fresh",savedRevision); store.Complete(targetA,"fresh","new-answer",before,savedRevision);
    Check(store.Status().Count == 1, "fresh revision continues counting after target replacement");
}
using (var store = new GateStore(revisionFile))
    Check(store.Status().TargetRevision == savedRevision && store.Status().Count == 1, "revision and earned progress survive service restart");
using (var sql = new SqliteConnection("Data Source=" + revisionFile))
{
    sql.Open(); using var command = sql.CreateCommand();
    command.CommandText = "UPDATE settings SET v='' WHERE k='targetConversationId';";
    command.ExecuteNonQuery();
}
using (var store = new GateStore(revisionFile))
    Check(store.Status().ConversationId == null && store.Status().Count == 1 && store.Status().Armed,
        "persisted empty target is not resurrected from legacy day and does not clear earned progress");

// Exercise Windows argv parsing using a real child process, without registering services.
var runtime = new DirectoryInfo(System.Runtime.InteropServices.RuntimeEnvironment.GetRuntimeDirectory());
string host = Path.Combine(runtime.Parent!.Parent!.Parent!.FullName, "dotnet.exe");
string assembly = Assembly.GetExecutingAssembly().Location;
string[] Receive(ProcessStartInfo info)
{
    using var process = Process.Start(info)!;
    var output = process.StandardOutput.ReadToEnd();
    var stderr = process.StandardError.ReadToEnd();
    process.WaitForExit();
    if (process.ExitCode != 0) throw new Exception("Argument probe failed: " + stderr);
    return JsonSerializer.Deserialize<string[]>(output.Trim())!;
}
var example = @"C:\Program Files\BREAKDOWN\resources\guard\Breakdown.Guard.exe";
var old = new ProcessStartInfo(host) {
    UseShellExecute = false, RedirectStandardOutput = true, RedirectStandardError = true, CreateNoWindow = true,
    Arguments = "\"" + assembly + "\" --probe-argv create BreakdownGuard binPath= \"\"" + example + "\"\" start= auto"
};
var broken = Receive(old);
Check(broken[3] == @"C:\Program" && broken[4].StartsWith(@"Files\BREAKDOWN"), "reproduced 0.1.0: Program Files path split by nested quotes");
foreach (var image in new[] { example, @"C:\Program Files\할일 BREAKDOWN\resources\guard\Breakdown.Guard.exe" })
{
    foreach (bool exists in new[] { false, true })
    {
        var expected = ServiceCommands.Registration(image, exists);
        var correct = ServiceCommands.StartInfo(host, new[] { assembly, "--probe-argv" }.Concat(expected));
        var received = Receive(correct);
        Check(received.SequenceEqual(expected), "registration argv preserved: " + expected[0] + " / " + image);
        Check(received[3] == "\"" + image + "\"", "service image retains its required enclosing quotes");
    }
}
Console.WriteLine("All " + checks + " checks passed, including installation quoting regression.");
succeeded = true;
}
finally
{
    if (succeeded)
    {
        SqliteConnection.ClearAllPools();
        var full = Path.GetFullPath(root);
        var prefix = Path.Combine(Path.GetFullPath(Path.GetTempPath()), "breakdown-tests-");
        if (!full.StartsWith(prefix, StringComparison.OrdinalIgnoreCase) ||
            (File.GetAttributes(full) & FileAttributes.ReparsePoint) != 0 ||
            Directory.EnumerateFileSystemEntries(full).Any(p => (File.GetAttributes(p) & FileAttributes.ReparsePoint) != 0))
            throw new InvalidOperationException("Refusing unexpected test cleanup path.");
        Directory.Delete(full, true);
    }
}
