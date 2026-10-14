using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using Playarr.Core.Account;
using Playarr.Core.Localization;
using Playarr.Core.Models;
using Playarr.Core.Networking;
using Playarr.Core.Remote;
using Xunit;

namespace Playarr.Core.Tests
{
    public class SettingsRowsTests
    {
        [Fact]
        public void InviteLinkMatchesTheWebBuildInviteUrl()
        {
            var link = InviteLink.Build(
                new[]
                {
                    new PeerAddressEntry { PeerNodeId = Guid.Parse("11111111-1111-1111-1111-111111111111"), Url = "https://a.example" },
                    new PeerAddressEntry { PeerNodeId = Guid.Parse("22222222-2222-2222-2222-222222222222"), Url = "https://b.example:8443/x" },
                },
                "tok_AbC-123");
            // Produced by the web's buildInviteUrl for the same input.
            Assert.Equal(
                "https://playarr.app/signup?servers=W3sicGVlcl9ub2RlX2lkIjoiMTExMTExMTEtMTExMS0xMTExLTExMTEtMTExMTExMTExMTExIiwidXJsIjoiaHR0cHM6Ly9hLmV4YW1wbGUifSx7InBlZXJfbm9kZV9pZCI6IjIyMjIyMjIyLTIyMjItMjIyMi0yMjIyLTIyMjIyMjIyMjIyMiIsInVybCI6Imh0dHBzOi8vYi5leGFtcGxlOjg0NDMveCJ9XQ&invite=tok_AbC-123",
                link);
        }

        [Fact]
        public void EveryLanguageHasEveryEnglishKeyWithTheSamePlaceholders()
        {
            var en = Strings.All["en"];
            Assert.NotEmpty(en);
            foreach (var language in new[] { "th", "ja" })
            {
                foreach (var pair in en)
                {
                    Assert.True(Strings.All[language].TryGetValue(pair.Key, out var translated), language + " lacks " + pair.Key);
                    Assert.Equal(Tokens(pair.Value), Tokens(translated));
                }
            }
        }

        private static string Tokens(string text) =>
            string.Join(",", Regex.Matches(text, @"\{\{\w+\}\}").Cast<Match>().Select(m => m.Value).OrderBy(v => v));

        [Fact]
        public void LanguageFollowsTheDeviceUntilOneIsChosen()
        {
            Lang.Configure(null, "th-TH");
            Assert.Equal("th", Lang.Current);
            Assert.Equal("ไทย", Lang.NameOf("th"));
            Lang.SetPreference("ja");
            Assert.Equal("ja", Lang.Current);
            Lang.SetPreference("klingon");
            Assert.Equal("th", Lang.Current);
            Lang.Configure("system", "fr-FR");
            Assert.Equal("en", Lang.Current);
            Assert.Equal("Language", Lang.T("settings.index.language.title"));
            Assert.Equal("missing.key", Lang.T("missing.key"));
            Lang.Configure(null, "en");
        }

        [Fact]
        public void TranslationFillsNamedTokens()
        {
            Lang.Configure("en", "en");
            Assert.Equal("Waiting for approval on Lounge TV. Code 123456", Lang.T("remote.targets.pairing", "name", "Lounge TV", "code", "123456"));
        }

        [Fact]
        public void ImportPreviewReadsSummaryCounts()
        {
            var preview = Newtonsoft.Json.JsonConvert.DeserializeObject<UserDataImportPreview>(
                "{\"package_sha256\":\"x\",\"summary\":{\"watch_progress\":{\"will_add\":3},\"unmatched_total\":2},\"warnings\":[]}")!;
            Assert.Equal(3, preview.Count("watch_progress", "will_add"));
            Assert.Equal(0, preview.Count("playlists", "new"));
            Assert.Equal(2, preview.UnmatchedTotal);
            Assert.False(preview.HasWatchlist);
        }

        private sealed class FakeInbox : IRemoteInboxClient, IRemoteTargetHandlers
        {
            public List<string> Calls = new List<string>();
            public Queue<Func<RemoteInbox>> Polls = new Queue<Func<RemoteInbox>>();
            public CancellationTokenSource Cancel = new CancellationTokenSource();

            public Task RegisterRemoteTargetAsync(string name, string platform, IEnumerable<string> capabilities, CancellationToken cancellationToken = default)
            {
                Calls.Add("register " + name + " " + string.Join("+", capabilities));
                return Task.CompletedTask;
            }

            public Task<RemoteInbox> PollRemoteInboxAsync(long after, int waitSeconds, CancellationToken cancellationToken = default)
            {
                Calls.Add("poll " + after);
                if (Polls.Count == 0)
                {
                    Cancel.Cancel();
                    throw new OperationCanceledException();
                }

                return Task.FromResult(Polls.Dequeue()());
            }

            public Task AckRemoteEventAsync(Guid eventId, string status, string? detail, CancellationToken cancellationToken = default)
            {
                Calls.Add("ack " + status + " " + detail);
                return Task.CompletedTask;
            }

            public void OnPairingRequest(PairingRequest request) => Calls.Add("pairing " + request.ControllerName + " " + request.VerificationCode);

            public void OnPairingRevoked(Guid pairingId) => Calls.Add("revoked");

            public Task<RemoteOutcome> ExecuteAsync(string kind, JObject args) =>
                Task.FromResult((string?)args["key"] == "up" ? RemoteOutcome.Ok() : RemoteOutcome.Unsupported("no"));
        }

        private static RemoteInboxEvent Event(string kind, string json) =>
            new RemoteInboxEvent { Id = Guid.NewGuid(), Seq = 1, Kind = kind, Payload = JObject.Parse(json) };

        [Fact]
        public async Task HostRegistersPollsAcknowledgesAndAdvancesTheCursor()
        {
            var fake = new FakeInbox();
            fake.Polls.Enqueue(() => new RemoteInbox
            {
                Next = 7,
                Events = new List<RemoteInboxEvent>
                {
                    Event("pairing_request", "{\"pairing_id\":\"" + Guid.NewGuid() + "\",\"controller_name\":\"Phone\",\"verification_code\":\"123456\"}"),
                    Event("command", "{\"kind\":\"navigate\",\"args\":{\"key\":\"up\"}}"),
                    Event("command", "{\"kind\":\"navigate\",\"args\":{\"key\":\"sideways\"}}"),
                    Event("handoff_offer", "{}"),
                },
            });
            var host = new RemoteTargetHost(fake, fake, "Xbox", "xbox", new[] { "navigate" }, (_, __) => Task.CompletedTask);
            await host.RunAsync(fake.Cancel.Token);
            Assert.Equal(
                new[] { "register Xbox navigate", "poll 0", "pairing Phone 123456", "ack ok ", "ack ok ", "ack unsupported no", "ack unsupported unknown event", "poll 7" },
                fake.Calls.Take(8).ToArray());
        }
    }
}
