using Microsoft.Data.Sqlite;
using System.Security.Cryptography;
using System.Globalization;

namespace Breakdown.Core;

public sealed record GateStatus(bool Armed, bool PasswordSet, bool Ready, string Day, int Count,
    bool Unlocked, string? Reason, string? ConversationId, string[] PendingUserIds, int EmergencyCount, string[] AbortedUserIds, bool UiDismissed, string TargetRevision);

public sealed class GateStore : IDisposable
{
    private const string TargetKey = "targetConversationId";
    private readonly SqliteConnection db;
    private int emergency;
    private readonly object sync = new();
    public static string DayAt(DateTimeOffset now) => now.ToOffset(TimeSpan.FromHours(9)).AddHours(-4).ToString("yyyy-MM-dd");
    public GateStore(string path)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(path))!);
        db = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = path }.ToString());
        db.Open();
        Exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;" +
            "CREATE TABLE IF NOT EXISTS settings(k TEXT PRIMARY KEY,v TEXT NOT NULL);" +
            "CREATE TABLE IF NOT EXISTS days(day TEXT PRIMARY KEY,conversation TEXT,reason TEXT,completedAt TEXT);" +
            "CREATE TABLE IF NOT EXISTS peer_completions(day TEXT PRIMARY KEY);" +
            "CREATE TABLE IF NOT EXISTS turns(day TEXT NOT NULL,conversation TEXT NOT NULL,userId TEXT NOT NULL," +
            "assistantId TEXT,state TEXT NOT NULL,PRIMARY KEY(day,conversation,userId));" +
            "CREATE UNIQUE INDEX IF NOT EXISTS response_identity ON turns(day,conversation,assistantId) WHERE assistantId IS NOT NULL;");
        MigrateConversationTarget();
    }
    private object? Scalar(string sql, params (string, object?)[] parameters)
    {
        using var command = db.CreateCommand(); command.CommandText = sql;
        foreach (var (key, value) in parameters) command.Parameters.AddWithValue(key, value ?? DBNull.Value);
        return command.ExecuteScalar();
    }
    private void Exec(string sql, params (string, object?)[] parameters)
    {
        using var command = db.CreateCommand(); command.CommandText = sql;
        foreach (var (key, value) in parameters) command.Parameters.AddWithValue(key, value ?? DBNull.Value);
        command.ExecuteNonQuery();
    }
    private string Get(string key) => Scalar("SELECT v FROM settings WHERE k=$k", ("$k", key)) as string ?? "";
    private void Set(string key, string value) => Exec("INSERT INTO settings VALUES($k,$v) ON CONFLICT(k) DO UPDATE SET v=$v", ("$k", key), ("$v", value));
    private string Day => Get("activeDay");
    private string Target => Get(TargetKey);
    private string TargetRevision => Get("targetRevision");
    private string UiPeriod => Get("armed") == "1" ? "day:" + Day : "setup";
    private void MigrateConversationTarget()
    {
        using var migration = db.BeginTransaction();
        if (TargetRevision == "") Set("targetRevision", Guid.NewGuid().ToString("N"));
        // An empty persisted choice is different from an old database with no key.
        if (Scalar("SELECT v FROM settings WHERE k=$k", ("$k", TargetKey)) is not null)
        { migration.Commit(); return; }
        string derived = "";
        if (Day != "") derived = Scalar("SELECT conversation FROM days WHERE day=$d", ("$d", Day)) as string ?? "";
        if (!ValidConversationId(derived))
            derived = Scalar("SELECT conversation FROM days WHERE conversation IS NOT NULL AND conversation<>'' ORDER BY day DESC LIMIT 1") as string ?? "";
        Set(TargetKey, ValidConversationId(derived) ? derived : "");
        if (!ValidConversationId(derived)) Set("ready", "0");
        migration.Commit();
    }
    public GateStatus Status()
    {
        lock (sync)
        {
            string day = Day;
            string? reason = Scalar("SELECT reason FROM days WHERE day=$d", ("$d", day)) as string;
            string target = Target;
            string? conversation = target == "" ? null : target;
            int count = Convert.ToInt32(Scalar("SELECT COUNT(*) FROM turns WHERE day=$d AND state='complete'", ("$d", day)));
            var pending = new List<string>(); var aborted = new List<string>();
            if (conversation != null)
            {
                using var command = db.CreateCommand();
                command.CommandText = "SELECT userId,state FROM turns WHERE day=$d AND conversation=$c AND state IN ('pending','aborted')";
                command.Parameters.AddWithValue("$d", day); command.Parameters.AddWithValue("$c", conversation);
                using var reader = command.ExecuteReader();
                while (reader.Read()) (reader.GetString(1) == "pending" ? pending : aborted).Add(reader.GetString(0));
            }
            return new(Get("armed") == "1", Get("hash") != "", conversation != null && Get("ready") == "1", day, reason == "sync" ? 3 : Math.Min(count, 3),
                reason != null, reason, conversation, pending.ToArray(), emergency, aborted.ToArray(),
                (Get("armed") != "1" || reason != null) && Get("uiDismissedFor") == UiPeriod, TargetRevision);
        }
    }
    public void SetConversationTarget(string conversation)
    {
        lock (sync)
        {
            ValidateConversationId(conversation);
            string previous = Target;
            if (previous == conversation) return;
            using var transaction = db.BeginTransaction();
            if (previous != "" && Day != "")
                Exec("UPDATE turns SET state='aborted' WHERE day=$d AND conversation=$c AND state='pending'", ("$d", Day), ("$c", previous));
            Set(TargetKey, conversation);
            Set("targetRevision", Guid.NewGuid().ToString("N"));
            Set("ready", "0");
            if (Day != "") Exec("UPDATE days SET conversation=$c WHERE day=$d", ("$c", conversation), ("$d", Day));
            transaction.Commit();
        }
    }
    public void SetPassword(string password, string? current = null)
    {
        lock (sync)
        {
            if (password.Length is < 1 or > 1024) throw new InvalidOperationException("비밀번호는 1~1024자로 입력하세요.");
            if (Get("hash") != "" && ((Get("armed") == "1" && !Status().Unlocked) || !CheckPassword(current ?? "")))
                throw new InvalidOperationException("잠금 해제 후 기존 비밀번호를 확인하세요.");
            var salt = RandomNumberGenerator.GetBytes(16);
            var hash = Rfc2898DeriveBytes.Pbkdf2(password, salt, 210000, HashAlgorithmName.SHA512, 64);
            using var transaction = db.BeginTransaction();
            Set("salt", Convert.ToBase64String(salt)); Set("hash", Convert.ToBase64String(hash)); transaction.Commit();
        }
    }
    private bool CheckPassword(string password)
    {
        if (Get("hash") == "" || password.Length > 1024) return false;
        var expected = Convert.FromBase64String(Get("hash"));
        var actual = Rfc2898DeriveBytes.Pbkdf2(password, Convert.FromBase64String(Get("salt")), 210000, HashAlgorithmName.SHA512, expected.Length);
        return CryptographicOperations.FixedTimeEquals(expected, actual);
    }
    public void MarkReady(string? conversation = null, string? targetRevision = null)
    {
        lock (sync)
        {
            if (Target == "") throw new InvalidOperationException("먼저 사용할 ChatGPT 대화를 지정하세요.");
            if (conversation != null && Target != conversation) throw new InvalidOperationException("선택한 대화가 변경되었습니다.");
            ValidateRevision(targetRevision);
            Set("ready", "1");
        }
    }
    public void Arm(DateTimeOffset now)
    {
        lock (sync)
        {
            if (Get("armed") == "1") return;
            if (Target == "" || Get("ready") != "1" || Get("hash") == "")
                throw new InvalidOperationException("대화 지정, 비밀번호, 테스트 대화 1턴을 먼저 완료하세요.");
            using var transaction = db.BeginTransaction();
            Set("armed", "1"); ActivateDay(DayAt(now), now); transaction.Commit();
        }
    }
    private void ActivateDay(string day, DateTimeOffset now)
    {
        string target = Target;
        object? conversation = target == "" ? null : target;
        Exec("INSERT OR IGNORE INTO days(day,conversation) VALUES($d,$c)", ("$d", day), ("$c", conversation));
        Exec("UPDATE days SET conversation=$c WHERE day=$d", ("$c", conversation), ("$d", day));
        Set("activeDay", day); emergency = 0;
        if (Scalar("SELECT day FROM peer_completions WHERE day=$d", ("$d", day)) != null &&
            Scalar("SELECT reason FROM days WHERE day=$d", ("$d", day)) is DBNull)
            Unlock("sync", now);
    }
    public void ObserveSession(string kind, string logonKey, DateTimeOffset now)
    {
        lock (sync)
        {
            if (kind is not ("logon" or "unlock")) return;
            // Same OS logon replayed by a restarted helper must not reset an overnight session.
            if (kind == "logon" && Get("logonKey") == logonKey) return;
            using var transaction = db.BeginTransaction();
            Set("logonKey", logonKey);
            if (Get("armed") == "1") ActivateDay(DayAt(now), now);
            else if (kind == "logon") Set("uiDismissedFor", "");
            transaction.Commit();
        }
    }
    public void RequestUiExit()
    {
        lock (sync)
        {
            var status = Status();
            if (status.Armed && !status.Unlocked) throw new InvalidOperationException("잠금이 풀린 뒤 종료할 수 있어요.");
            Set("uiDismissedFor", UiPeriod);
            emergency = 0;
        }
    }
    // The future transport authenticates a paired peer before calling this; it is not a public RPC.
    public void AcceptPeerCompletion(string day, DateTimeOffset now)
    {
        if (!DateOnly.TryParseExact(day, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out _))
            throw new InvalidOperationException("완료 기록의 날짜를 확인하세요.");
        lock (sync)
        {
            using var transaction = db.BeginTransaction();
            Exec("INSERT OR IGNORE INTO peer_completions(day) VALUES($d)", ("$d", day));
            if (Get("armed") == "1" && Day == day && !Status().Unlocked) { Unlock("sync", now); emergency = 0; }
            transaction.Commit();
        }
    }
    public void RequestUiShow()
    {
        lock (sync) Set("uiDismissedFor", "");
    }
    public void Submit(string conversation, string userId, string? targetRevision = null)
    {
        lock (sync)
        {
            ValidateId(userId); ValidateConversation(conversation); ValidateRevision(targetRevision);
            Exec("INSERT INTO turns(day,conversation,userId,state) VALUES($d,$c,$u,'pending') ON CONFLICT(day,conversation,userId) DO UPDATE SET state='pending' WHERE state='aborted'",
                ("$d", Day), ("$c", conversation), ("$u", userId));
        }
    }
    public void Abort(string conversation, string userId, string? targetRevision = null)
    {
        lock (sync)
        {
            ValidateId(userId); ValidateConversation(conversation); ValidateRevision(targetRevision);
            Exec("UPDATE turns SET state='aborted' WHERE day=$d AND conversation=$c AND userId=$u AND state='pending'",
                ("$d", Day), ("$c", conversation), ("$u", userId));
        }
    }
    public void Complete(string conversation, string userId, string assistantId, DateTimeOffset now, string? targetRevision = null)
    {
        lock (sync)
        {
            ValidateId(userId); ValidateId(assistantId); ValidateConversation(conversation); ValidateRevision(targetRevision);
            if (Status().Unlocked) return;
            using var transaction = db.BeginTransaction();
            Exec("UPDATE OR IGNORE turns SET assistantId=$a,state='complete' WHERE day=$d AND conversation=$c AND userId=$u AND state='pending'",
                ("$a", assistantId), ("$d", Day), ("$c", conversation), ("$u", userId));
            if (Status().Count >= 3) Unlock("conversation", now);
            transaction.Commit();
        }
    }
    private void ValidateConversation(string id)
    {
        if (Get("armed") != "1" || Target == "" || Target != id) throw new InvalidOperationException("대화 연결을 확인하세요.");
    }
    private void ValidateRevision(string? revision)
    {
        // Direct in-process calls may omit it; all external RPCs supply it, including an empty value when missing.
        if (revision != null && revision != TargetRevision)
            throw new InvalidOperationException("대화 설정이 변경되었습니다. 새 상태로 다시 연결하세요.");
    }
    private static bool ValidConversationId(string id) =>
        id.Length is >= 1 and <= 200 && id.All(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '_');
    private static void ValidateConversationId(string id)
    {
        if (!ValidConversationId(id)) throw new InvalidOperationException("대화 식별자를 확인할 수 없습니다.");
    }
    private static void ValidateId(string id)
    {
        if (id.Length is < 1 or > 200 || id.Any(c => !char.IsAsciiLetterOrDigit(c) && c != '-' && c != '_'))
            throw new InvalidOperationException("메시지 식별자를 확인할 수 없습니다.");
    }
    private void Unlock(string reason, DateTimeOffset now) =>
        Exec("UPDATE days SET reason=$r,completedAt=$t WHERE day=$d", ("$r", reason), ("$t", now.ToString("O")), ("$d", Day));
    public void ResetEmergency() { lock (sync) emergency = 0; }
    public bool Emergency(string password, DateTimeOffset now)
    {
        lock (sync)
        {
            if (!CheckPassword(password)) { emergency = 0; return false; }
            emergency++;
            if (emergency >= 10) { Unlock("emergency", now); emergency = 0; }
            return true;
        }
    }
    public void Dispose() => db.Dispose();
}
