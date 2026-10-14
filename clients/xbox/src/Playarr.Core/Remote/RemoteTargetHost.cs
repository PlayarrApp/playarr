using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using Playarr.Core.Models;
using Playarr.Core.Networking;

namespace Playarr.Core.Remote
{
    public sealed class PairingRequest
    {
        public Guid PairingId { get; set; }

        public string ControllerName { get; set; } = string.Empty;

        public string VerificationCode { get; set; } = string.Empty;
    }

    /// <summary>The result of running one command: ok, failed or unsupported (with a detail for the controller).</summary>
    public sealed class RemoteOutcome
    {
        public string Status { get; set; } = "ok";

        public string? Detail { get; set; }

        public static RemoteOutcome Ok() => new RemoteOutcome();

        public static RemoteOutcome Failed(string detail) => new RemoteOutcome { Status = "failed", Detail = detail };

        public static RemoteOutcome Unsupported(string detail) => new RemoteOutcome { Status = "unsupported", Detail = detail };
    }

    public interface IRemoteTargetHandlers
    {
        void OnPairingRequest(PairingRequest request);

        void OnPairingRevoked(Guid pairingId);

        /// <summary>Runs a controller command (<c>navigate</c> with <c>{key}</c>, ...) on this device.</summary>
        Task<RemoteOutcome> ExecuteAsync(string kind, JObject args);
    }

    /// <summary>
    /// Makes this device a phone-remote target (the web's <c>RemoteTargetHost</c>): registers, long-polls the inbox and hands
    /// pairing requests and commands to the handlers. Handoff offers are answered "unsupported"; push (SSE) is not used, long polling
    /// is the web's own fallback and works through every proxy.
    /// </summary>
    public sealed class RemoteTargetHost
    {
        private readonly IRemoteInboxClient _client;
        private readonly IRemoteTargetHandlers _handlers;
        private readonly string _name;
        private readonly string _platform;
        private readonly string[] _capabilities;
        private readonly Func<TimeSpan, CancellationToken, Task> _delay;
        private CancellationTokenSource? _cts;
        private long _after;

        public RemoteTargetHost(
            IRemoteInboxClient client,
            IRemoteTargetHandlers handlers,
            string name,
            string platform,
            IEnumerable<string> capabilities,
            Func<TimeSpan, CancellationToken, Task>? delay = null)
        {
            _client = client;
            _handlers = handlers;
            _name = name;
            _platform = platform;
            _capabilities = new List<string>(capabilities).ToArray();
            _delay = delay ?? Task.Delay;
        }

        public void Start()
        {
            if (_cts != null)
            {
                return;
            }

            _cts = new CancellationTokenSource();
            _ = RunAsync(_cts.Token);
        }

        public void Stop()
        {
            _cts?.Cancel();
            _cts = null;
        }

        /// <summary>Registers and polls until cancelled; a failure backs off 1 s doubling to 15 s, and a 404 registers again.</summary>
        public async Task RunAsync(CancellationToken cancellationToken)
        {
            var backoff = TimeSpan.FromSeconds(1);
            var registered = false;
            while (!cancellationToken.IsCancellationRequested)
            {
                try
                {
                    if (!registered)
                    {
                        await _client.RegisterRemoteTargetAsync(_name, _platform, _capabilities, cancellationToken).ConfigureAwait(false);
                        registered = true;
                    }

                    var inbox = await _client.PollRemoteInboxAsync(_after, 25, cancellationToken).ConfigureAwait(false);
                    backoff = TimeSpan.FromSeconds(1);
                    foreach (var received in inbox.Events)
                    {
                        await HandleAsync(received).ConfigureAwait(false);
                    }

                    _after = Math.Max(_after, inbox.Next);
                }
                catch (Exception error) when (!cancellationToken.IsCancellationRequested)
                {
                    // A 404 means the server forgot this target.
                    if (error is ApiException { Kind: ApiErrorKind.NotFound })
                    {
                        registered = false;
                    }

                    try
                    {
                        await _delay(backoff, cancellationToken).ConfigureAwait(false);
                    }
                    catch (OperationCanceledException)
                    {
                        return;
                    }

                    backoff = TimeSpan.FromSeconds(Math.Min(backoff.TotalSeconds * 2, 15));
                }
                catch (OperationCanceledException)
                {
                    return;
                }
            }
        }

        public async Task HandleAsync(RemoteInboxEvent received)
        {
            var payload = received.Payload ?? new JObject();
            RemoteOutcome outcome;
            try
            {
                switch (received.Kind)
                {
                    case "pairing_request":
                        _handlers.OnPairingRequest(new PairingRequest
                        {
                            PairingId = ParseGuid((string?)payload["pairing_id"]) ?? received.PairingId ?? Guid.Empty,
                            ControllerName = (string?)payload["controller_name"] ?? string.Empty,
                            VerificationCode = (string?)payload["verification_code"] ?? string.Empty,
                        });
                        outcome = RemoteOutcome.Ok();
                        break;
                    case "pairing_revoked":
                        _handlers.OnPairingRevoked(ParseGuid((string?)payload["pairing_id"]) ?? received.PairingId ?? Guid.Empty);
                        outcome = RemoteOutcome.Ok();
                        break;
                    case "command":
                        outcome = await _handlers.ExecuteAsync((string?)payload["kind"] ?? string.Empty, payload["args"] as JObject ?? new JObject()).ConfigureAwait(false);
                        break;
                    default:
                        outcome = RemoteOutcome.Unsupported("unknown event");
                        break;
                }
            }
            catch (Exception)
            {
                outcome = RemoteOutcome.Failed("handler error");
            }

            try
            {
                await _client.AckRemoteEventAsync(received.Id, outcome.Status, outcome.Status == "ok" ? null : outcome.Detail).ConfigureAwait(false);
            }
            catch (Exception)
            {
                // Already acknowledged or expired: nothing more to do.
            }
        }

        private static Guid? ParseGuid(string? value) => Guid.TryParse(value, out var id) ? id : (Guid?)null;
    }
}
