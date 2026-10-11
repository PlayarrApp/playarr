using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Playarr.Core.Auth;
using Playarr.Core.Models;
using Xunit;

namespace Playarr.Core.Tests
{
    public class QrPairingFlowTests
    {
        private static DeviceCodeResponse Code(string id) => new DeviceCodeResponse
        {
            DeviceCode = id, UserCode = "AAAA-" + id, VerificationUri = "https://link.example/tv", VerificationUriComplete = "https://link.example/tv?c=" + id,
            ExpiresIn = 300, Interval = 5,
        };

        private static HostedLinkClaim Claim() => new HostedLinkClaim { ServerUrl = "https://server.example", ServerDeviceCode = "srv" };

        /// <summary>Runs the flow on a fake clock: every wait just advances it.</summary>
        private static async Task<List<QrPairingUpdate>> Run(
            Func<int, Task<DeviceCodeResponse>> requestCode,
            Func<string, int, HostedLinkPoll> pollHosted,
            Func<int, ServerPoll> pollServer)
        {
            var clock = DateTimeOffset.UnixEpoch;
            var requests = 0;
            var hostedPolls = 0;
            var serverPolls = 0;
            var flow = new QrPairingFlow(
                _ => requestCode(++requests),
                (code, _) => Task.FromResult(pollHosted(code, ++hostedPolls)),
                (_, _) => Task.CompletedTask,
                (_, _) => Task.FromResult(pollServer(++serverPolls)),
                (span, _) => { clock += span; return Task.CompletedTask; },
                () => clock);
            var updates = new List<QrPairingUpdate>();
            await flow.RunAsync(updates.Add, CancellationToken.None);
            return updates;
        }

        [Fact]
        public async Task ExpiredLinkCodeIsReplacedSilentlyThenLinks()
        {
            var updates = await Run(
                n => Task.FromResult(Code("c" + n)),
                (code, _) => code == "c1" ? new HostedLinkPoll { Status = HostedLinkStatus.Expired } : new HostedLinkPoll { Status = HostedLinkStatus.Approved, Claim = Claim() },
                _ => new ServerPoll { Status = ServerPollStatus.Approved, Token = new TokenResponse() });
            var shown = updates.Where(u => u.Kind == QrPairingUpdateKind.ShowCode).Select(u => u.Code!.DeviceCode).ToArray();
            Assert.Equal(new[] { "c1", "c2" }, shown);
            Assert.Equal(QrPairingUpdateKind.Linked, updates.Last().Kind);
        }

        [Fact]
        public async Task ExpiredServerCodeRestartsPairingWithAFreshQr()
        {
            var updates = await Run(
                n => Task.FromResult(Code("c" + n)),
                (_, _) => new HostedLinkPoll { Status = HostedLinkStatus.Approved, Claim = Claim() },
                n => n == 1 ? new ServerPoll { Status = ServerPollStatus.Expired } : new ServerPoll { Status = ServerPollStatus.Approved, Token = new TokenResponse() });
            Assert.Equal(2, updates.Count(u => u.Kind == QrPairingUpdateKind.ShowCode));
            Assert.Equal(QrPairingUpdateKind.Linked, updates.Last().Kind);
        }

        [Fact]
        public async Task NetworkBlipsNeverSurfaceAnError()
        {
            var updates = await Run(
                n => n < 3 ? throw new InvalidOperationException("offline") : Task.FromResult(Code("c" + n)),
                (_, n) => n < 3 ? new HostedLinkPoll { Status = HostedLinkStatus.Failed } : new HostedLinkPoll { Status = HostedLinkStatus.Approved, Claim = Claim() },
                n => n < 2 ? new ServerPoll { Status = ServerPollStatus.Failed } : new ServerPoll { Status = ServerPollStatus.Approved, Token = new TokenResponse() });
            Assert.Equal(QrPairingUpdateKind.Linked, updates.Last().Kind);
            Assert.DoesNotContain(updates, u => u.Kind == QrPairingUpdateKind.Declined);
        }

        [Fact]
        public async Task DecliningOnThePhoneEndsPairing()
        {
            var updates = await Run(
                n => Task.FromResult(Code("c" + n)),
                (_, _) => new HostedLinkPoll { Status = HostedLinkStatus.Approved, Claim = Claim() },
                _ => new ServerPoll { Status = ServerPollStatus.Denied });
            Assert.Equal(QrPairingUpdateKind.Declined, updates.Last().Kind);
            Assert.Single(updates, u => u.Kind == QrPairingUpdateKind.ShowCode);
        }

        [Fact]
        public void QrMatrixIsSquareWithFinderPatterns()
        {
            var m = QrMatrix.Encode("https://link.example/tv?c=abc");
            Assert.Equal(m.GetLength(0), m.GetLength(1));
            Assert.False(m[0, 0]); // quiet zone
            Assert.True(m[4, 4] && m[4, 10] && m[10, 4] && m[10, 10]);
        }
    }
}
