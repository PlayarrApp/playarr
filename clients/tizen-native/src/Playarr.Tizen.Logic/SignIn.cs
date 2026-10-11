using Playarr.Core.Auth;
using Playarr.Core.Models;

namespace Playarr.Tizen.Logic;

public enum SignInStage { Requesting, ShowingCode, Linking, SignedIn, Failed }

public sealed record SignInState(SignInStage Stage, HostedLinkCode? Code = null, string? Error = null);

/// <summary>
/// QR sign-in through the hosted link broker: request a code, show it, wait for the phone, redeem the server device code for
/// tokens and persist them. An expired code is replaced automatically (web does the same), any other failure stops with a message.
/// </summary>
public sealed class SignIn(HostedLinkClient broker, FileSessionStore store, Func<Uri, DeviceFlowClient> deviceFlow, Action<SignInState> report)
{
    public async Task RunAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            report(new SignInState(SignInStage.Requesting));
            try
            {
                var code = await broker.RequestCodeAsync(TizenClient.PlatformId, ct).ConfigureAwait(false);
                report(new SignInState(SignInStage.ShowingCode, code));
                var claim = await broker.PollClaimAsync(code, ct: ct).ConfigureAwait(false);
                report(new SignInState(SignInStage.Linking, code));
                var server = new Uri(claim.ServerUrl);
                var token = await deviceFlow(server).PollForTokenAsync(claim.ServerDeviceCode, TimeSpan.FromSeconds(code.IntervalSeconds),
                    TimeSpan.FromSeconds(60), cancellationToken: ct).ConfigureAwait(false);
                store.SaveServerUrl(claim.ServerUrl);
                await store.StoreSessionAsync(new StoredAuthSession(token.AccessToken, token.RefreshToken, token.TokenType,
                    DateTimeOffset.UtcNow.AddSeconds(token.ExpiresIn)), ct).ConfigureAwait(false);
                report(new SignInState(SignInStage.SignedIn));
                return;
            }
            catch (HostedLinkException e) when (e.Expired) { /* new code */ }
            catch (OperationCanceledException) { return; }
            catch (Exception e)
            {
                report(new SignInState(SignInStage.Failed, Error: e is DeviceFlowException d ? d.DisplayMessage : e.Message));
                try { await Task.Delay(TimeSpan.FromSeconds(5), ct).ConfigureAwait(false); } catch (OperationCanceledException) { return; }
            }
        }
    }
}
