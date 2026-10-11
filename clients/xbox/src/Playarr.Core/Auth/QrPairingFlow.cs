using System;
using System.Threading;
using System.Threading.Tasks;
using Playarr.Core.Models;

namespace Playarr.Core.Auth
{
    public enum QrPairingUpdateKind
    {
        /// <summary>Asking for a (fresh) code: show the spinner, never an error.</summary>
        Requesting,

        /// <summary>Show this QR and code. Raised again for each renewed code.</summary>
        ShowCode,

        /// <summary>Linked; terminal.</summary>
        Linked,

        /// <summary>The viewer declined on the other device; terminal.</summary>
        Declined,
    }

    public sealed class QrPairingUpdate
    {
        public QrPairingUpdateKind Kind { get; set; }

        public DeviceCodeResponse? Code { get; set; }

        public TokenResponse? Token { get; set; }
    }

    public enum ServerPollStatus
    {
        Pending,
        SlowDown,
        Approved,
        Denied,
        Expired,
        Failed,
    }

    public sealed class ServerPoll
    {
        public ServerPollStatus Status { get; set; }

        public TokenResponse? Token { get; set; }
    }

    /// <summary>
    /// Self-renewing QR sign-in, matching the web's <c>DeviceLogin</c> and Android's <c>QrPairingFlow</c>. An expired
    /// link code, an expired server code and any transient failure (network blip, HTTP 5xx) silently ask for a fresh
    /// code and show a new QR, with no error and no user action. It ends when the viewer approves
    /// (<see cref="QrPairingUpdateKind.Linked"/>), declines, or the token is cancelled. Transient failures back off
    /// 2 s doubling to 30 s, reset by every success.
    /// </summary>
    public sealed class QrPairingFlow
    {
        public static readonly TimeSpan MaxAttempt = TimeSpan.FromMinutes(5);
        private static readonly TimeSpan MinHostedInterval = TimeSpan.FromSeconds(5);
        private static readonly TimeSpan ServerInterval = TimeSpan.FromSeconds(1);

        private readonly Func<CancellationToken, Task<DeviceCodeResponse>> _requestCode;
        private readonly Func<string, CancellationToken, Task<HostedLinkPoll>> _pollHosted;
        private readonly Func<HostedLinkClaim, CancellationToken, Task> _prepareServer;
        private readonly Func<HostedLinkClaim, CancellationToken, Task<ServerPoll>> _pollServer;
        private readonly Func<TimeSpan, CancellationToken, Task> _wait;
        private readonly Func<DateTimeOffset> _now;

        public QrPairingFlow(
            Func<CancellationToken, Task<DeviceCodeResponse>> requestCode,
            Func<string, CancellationToken, Task<HostedLinkPoll>> pollHosted,
            Func<HostedLinkClaim, CancellationToken, Task> prepareServer,
            Func<HostedLinkClaim, CancellationToken, Task<ServerPoll>> pollServer,
            Func<TimeSpan, CancellationToken, Task>? wait = null,
            Func<DateTimeOffset>? now = null)
        {
            _requestCode = requestCode;
            _pollHosted = pollHosted;
            _prepareServer = prepareServer;
            _pollServer = pollServer;
            _wait = wait ?? ((span, token) => Task.Delay(span, token));
            _now = now ?? (() => DateTimeOffset.UtcNow);
        }

        public async Task RunAsync(Action<QrPairingUpdate> report, CancellationToken cancellationToken)
        {
            var backoff = new Backoff();
            while (true)
            {
                cancellationToken.ThrowIfCancellationRequested();
                report(new QrPairingUpdate { Kind = QrPairingUpdateKind.Requesting });
                DeviceCodeResponse code;
                try
                {
                    code = await _requestCode(cancellationToken).ConfigureAwait(false);
                }
                catch (Exception error) when (!(error is OperationCanceledException && cancellationToken.IsCancellationRequested))
                {
                    await _wait(backoff.Next(), cancellationToken).ConfigureAwait(false);
                    continue;
                }

                backoff.Reset();
                report(new QrPairingUpdate { Kind = QrPairingUpdateKind.ShowCode, Code = code });
                var claim = await AwaitClaimAsync(code, backoff, cancellationToken).ConfigureAwait(false);
                if (claim == null)
                {
                    continue;
                }

                var outcome = await RedeemAsync(claim, backoff, cancellationToken).ConfigureAwait(false);
                if (outcome == null)
                {
                    continue;
                }

                report(outcome);
                return;
            }
        }

        /// <summary>Waits for the phone-side approval; null means the code ran out and a new one is needed.</summary>
        private async Task<HostedLinkClaim?> AwaitClaimAsync(DeviceCodeResponse code, Backoff backoff, CancellationToken token)
        {
            var lifetime = TimeSpan.FromSeconds(Math.Max(0, Math.Min(code.ExpiresIn, (long)MaxAttempt.TotalSeconds)));
            var deadline = _now() + lifetime;
            var interval = TimeSpan.FromSeconds(Math.Max(code.Interval, (long)MinHostedInterval.TotalSeconds));
            while (true)
            {
                var remaining = deadline - _now();
                if (remaining <= TimeSpan.Zero)
                {
                    return null;
                }

                await _wait(remaining < interval ? remaining : interval, token).ConfigureAwait(false);
                if (_now() >= deadline)
                {
                    return null;
                }

                var poll = await SafeAsync(() => _pollHosted(code.DeviceCode, token), token).ConfigureAwait(false);
                switch (poll?.Status)
                {
                    case HostedLinkStatus.Approved:
                        return poll!.Claim;
                    case HostedLinkStatus.Expired:
                        return null;
                    case HostedLinkStatus.Pending:
                        backoff.Reset();
                        break;
                    default:
                        await _wait(backoff.Next(), token).ConfigureAwait(false);
                        break;
                }
            }
        }

        /// <summary>Exchanges the claim for a token; null means the server code expired and pairing restarts.</summary>
        private async Task<QrPairingUpdate?> RedeemAsync(HostedLinkClaim claim, Backoff backoff, CancellationToken token)
        {
            var deadline = _now() + MaxAttempt;
            while (_now() < deadline)
            {
                try
                {
                    await _prepareServer(claim, token).ConfigureAwait(false);
                }
                catch (Exception error) when (!(error is OperationCanceledException && token.IsCancellationRequested))
                {
                    await _wait(backoff.Next(), token).ConfigureAwait(false);
                    continue;
                }

                var poll = await SafeAsync(() => _pollServer(claim, token), token).ConfigureAwait(false);
                switch (poll?.Status)
                {
                    case ServerPollStatus.Approved:
                        return new QrPairingUpdate { Kind = QrPairingUpdateKind.Linked, Token = poll!.Token };
                    case ServerPollStatus.Denied:
                        return new QrPairingUpdate { Kind = QrPairingUpdateKind.Declined };
                    case ServerPollStatus.Expired:
                        return null;
                    case ServerPollStatus.Pending:
                        backoff.Reset();
                        await _wait(ServerInterval, token).ConfigureAwait(false);
                        break;
                    case ServerPollStatus.SlowDown:
                        backoff.Reset();
                        await _wait(ServerInterval + TimeSpan.FromSeconds(5), token).ConfigureAwait(false);
                        break;
                    default:
                        await _wait(backoff.Next(), token).ConfigureAwait(false);
                        break;
                }
            }

            return null;
        }

        private static async Task<T?> SafeAsync<T>(Func<Task<T>> call, CancellationToken token) where T : class
        {
            try
            {
                return await call().ConfigureAwait(false);
            }
            catch (Exception error) when (!(error is OperationCanceledException && token.IsCancellationRequested))
            {
                return null; // treated like a failed poll: the caller backs off and retries
            }
        }

        private sealed class Backoff
        {
            private int _attempt;

            public TimeSpan Next()
            {
                var seconds = Math.Min(2 << Math.Min(_attempt, 5), 30);
                _attempt++;
                return TimeSpan.FromSeconds(seconds);
            }

            public void Reset() => _attempt = 0;
        }
    }
}
