using Breakdown.Core;
using System.Globalization;
using System.Diagnostics;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Security;
using System.Net.Sockets;
using System.Security.Authentication;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Security.Principal;
using System.Text;
using System.Text.Json;

namespace Breakdown.Host;

internal sealed class PeerSyncServer : IDisposable
{
    internal const int DefaultPort = 18431;
    private readonly GateStore store;
    private readonly string directory;
    private readonly int port;
    private readonly object sync = new();
    private CancellationTokenSource? stop;
    private TcpListener? listener;
    private X509Certificate2? certificate;
    private readonly SemaphoreSlim connections = new(8);

    public PeerSyncServer(GateStore store, string directory, int port = DefaultPort)
    { this.store = store; this.directory = directory; this.port = port; }

    public void Restore()
    {
        if (!store.PeerSyncEnabled) return;
        try { Enable(); } catch (Exception e) { Console.Error.WriteLine("Peer sync unavailable: " + e.GetType().Name); }
    }

    public object Enable()
    {
        lock (sync)
        {
            var secret = store.PeerSecret();
            var starting = listener == null;
            if (listener == null)
            {
                certificate ??= LoadCertificate(secret);
                var server = new TcpListener(port == 0 ? IPAddress.Loopback : IPAddress.Any, port);
                try { server.Start(8); }
                catch (SocketException) { throw new InvalidOperationException("동기화 포트를 열지 못했습니다. 다른 프로그램의 사용 여부를 확인하세요."); }
                stop = new CancellationTokenSource(); listener = server;
                _ = Accept(server, stop.Token);
            }
            if ((starting || !store.PeerSyncEnabled) && port != 0 && WindowsIdentity.GetCurrent().IsSystem) ConfigureFirewall(true);
            store.SetPeerSyncEnabled(true);
            return Info();
        }
    }

    public object Info()
    {
        lock (sync)
        {
            if (!store.PeerSyncEnabled || certificate == null || listener == null) return new { enabled = false };
            var addresses = NetworkInterface.GetAllNetworkInterfaces().Where(n => n.OperationalStatus == OperationalStatus.Up)
                .SelectMany(n => n.GetIPProperties().UnicastAddresses).Select(a => a.Address)
                .Where(a => a.AddressFamily == AddressFamily.InterNetwork && IsLocalAddress(a) && !IPAddress.IsLoopback(a))
                .Select(a => a.ToString()).Distinct().ToArray();
            return new { enabled = true, version = 1, addresses, port = ((IPEndPoint)listener.LocalEndpoint).Port,
                certificate = certificate.ExportCertificatePem(),
                fingerprint = Convert.ToHexString(SHA256.HashData(certificate.RawData)).ToLowerInvariant(), token = store.PeerSecret() };
        }
    }

    public void Disable()
    {
        lock (sync) { store.SetPeerSyncEnabled(false); Stop(); if (port != 0 && WindowsIdentity.GetCurrent().IsSystem) ConfigureFirewall(false); }
    }
    private void Stop() { stop?.Cancel(); listener?.Stop(); listener = null; stop?.Dispose(); stop = null; }
    public void Dispose() { lock (sync) Stop(); }

    private void ConfigureFirewall(bool enable)
    {
        var executable = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "netsh.exe");
        void Run(params string[] args) {
            var start = new ProcessStartInfo(executable) { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true };
            foreach (var arg in args) start.ArgumentList.Add(arg);
            using var process = Process.Start(start)!;
            var output = process.StandardOutput.ReadToEndAsync(); var errors = process.StandardError.ReadToEndAsync();
            if (!process.WaitForExit(4000)) { process.Kill(); throw new InvalidOperationException("동기화 방화벽 설정 시간이 초과됐습니다."); }
            if (process.ExitCode != 0 && args.Contains("add")) throw new InvalidOperationException("로컬 네트워크 동기화 방화벽 규칙을 만들지 못했습니다.");
        }
        Run("advfirewall", "firewall", "delete", "rule", "name=BREAKDOWN local sync");
        if (enable) Run("advfirewall", "firewall", "add", "rule", "name=BREAKDOWN local sync", "dir=in", "action=allow",
            "protocol=TCP", "localport=" + port, "remoteip=localsubnet", "profile=any", "program=" + Environment.ProcessPath!);
    }

    private X509Certificate2 LoadCertificate(string password)
    {
        var file = Path.Combine(directory, "peer-sync.pfx");
        if (File.Exists(file)) return X509CertificateLoader.LoadPkcs12FromFile(file, password, X509KeyStorageFlags.DefaultKeySet);
        using var key = RSA.Create(2048);
        var request = new CertificateRequest("CN=BREAKDOWN local sync", key, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        request.CertificateExtensions.Add(new X509BasicConstraintsExtension(false, false, 0, true));
        request.CertificateExtensions.Add(new X509KeyUsageExtension(X509KeyUsageFlags.DigitalSignature | X509KeyUsageFlags.KeyEncipherment, true));
        using var generated = request.CreateSelfSigned(DateTimeOffset.UtcNow.AddMinutes(-5), DateTimeOffset.UtcNow.AddYears(5));
        var bytes = generated.Export(X509ContentType.Pfx, password);
        File.WriteAllBytes(file, bytes);
        return X509CertificateLoader.LoadPkcs12(bytes, password, X509KeyStorageFlags.DefaultKeySet);
    }

    private async Task Accept(TcpListener server, CancellationToken token)
    {
        try {
            while (!token.IsCancellationRequested) {
                var client = await server.AcceptTcpClientAsync(token);
                if (!connections.Wait(0)) { client.Dispose(); continue; }
                _ = Handle(client, token);
            }
        } catch (OperationCanceledException) { } catch (SocketException) when (token.IsCancellationRequested) { }
    }

    private async Task Handle(TcpClient client, CancellationToken stopping)
    {
        using (client)
        using (var timeout = CancellationTokenSource.CreateLinkedTokenSource(stopping))
        {
            timeout.CancelAfter(TimeSpan.FromSeconds(6)); var token = timeout.Token;
            try {
                if (client.Client.RemoteEndPoint is not IPEndPoint remote || !IsLocalAddress(remote.Address)) return;
                using var ssl = new SslStream(client.GetStream(), false);
                await ssl.AuthenticateAsServerAsync(new SslServerAuthenticationOptions {
                    ServerCertificate = certificate!, EnabledSslProtocols = SslProtocols.Tls12 | SslProtocols.Tls13
                }, token);
                var header = new List<byte>(); var one = new byte[1];
                while (header.Count < 4096) {
                    if (await ssl.ReadAsync(one, token) == 0) return;
                    header.Add(one[0]);
                    if (header.Count >= 4 && header[^4] == 13 && header[^3] == 10 && header[^2] == 13 && header[^1] == 10) break;
                }
                var lines = Encoding.ASCII.GetString(header.ToArray()).Split("\r\n");
                if (header.Count >= 4096 || lines[0] != "POST /v1/sync HTTP/1.1") { await Reply(ssl, 400, "{}", token); return; }
                var headers = new Dictionary<string,string>(StringComparer.OrdinalIgnoreCase);
                foreach (var line in lines.Skip(1).Where(s => s != "")) {
                    var separator = line.IndexOf(':');
                    if (separator <= 0 || !headers.TryAdd(line[..separator], line[(separator+1)..].Trim())) throw new InvalidOperationException();
                }
                var expected = Encoding.ASCII.GetBytes("Bearer " + store.PeerSecret());
                var supplied = Encoding.ASCII.GetBytes(headers.GetValueOrDefault("Authorization", ""));
                if (!store.PeerSyncEnabled || !CryptographicOperations.FixedTimeEquals(expected, supplied)) { await Reply(ssl, 401, "{}", token); return; }
                if (headers.ContainsKey("Transfer-Encoding") || !int.TryParse(headers.GetValueOrDefault("Content-Length"), out var length) || length < 2 || length > 8192)
                { await Reply(ssl, 400, "{}", token); return; }
                var body = new byte[length]; await ssl.ReadExactlyAsync(body, token);
                using var json = JsonDocument.Parse(body);
                var root = json.RootElement;
                if (root.GetProperty("version").GetInt32() != 1) throw new InvalidOperationException();
                var days = root.GetProperty("completedDays").EnumerateArray().Select(x => x.GetString()!).ToArray();
                if (days.Length > 32 || days.Any(d => !DateOnly.TryParseExact(d, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out _)))
                    throw new InvalidOperationException();
                foreach (var day in days) store.AcceptPeerCompletion(day, DateTimeOffset.UtcNow);
                await Reply(ssl, 200, JsonSerializer.Serialize(new { version = 1, completedDays = store.CompletedDays() }), token);
            } catch (Exception e) when (e is IOException or OperationCanceledException or AuthenticationException or JsonException or InvalidOperationException or KeyNotFoundException or FormatException) {
                // No credentials, payloads or conversation identifiers are logged.
                if (e is AuthenticationException) Console.Error.WriteLine("Peer TLS handshake failed: " + e.Message);
            } finally { connections.Release(); }
        }
    }
    private static async Task Reply(SslStream stream, int status, string body, CancellationToken token)
    {
        var payload = Encoding.UTF8.GetBytes(body);
        var header = Encoding.ASCII.GetBytes($"HTTP/1.1 {status} {(status == 200 ? "OK" : "Error")}\r\nContent-Type: application/json\r\nContent-Length: {payload.Length}\r\nConnection: close\r\n\r\n");
        await stream.WriteAsync(header, token); await stream.WriteAsync(payload, token);
    }
    private static bool IsLocalAddress(IPAddress address)
    {
        if (address.IsIPv4MappedToIPv6) address = address.MapToIPv4();
        if (IPAddress.IsLoopback(address)) return true;
        var bytes = address.GetAddressBytes();
        return bytes.Length == 4 && (bytes[0] == 10 || (bytes[0] == 172 && bytes[1] is >= 16 and <= 31) || (bytes[0] == 192 && bytes[1] == 168));
    }
}
