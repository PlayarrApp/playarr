using System;
using System.Collections.Generic;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Playarr.Core.Auth;
using Playarr.Core.Models;

namespace Playarr.Core.Networking
{
    /// <summary>
    /// Owns "what bearer token should this request carry": returns a cached
    /// one, rotates an expiring one through
    /// <c>POST /api/v1/auth/refresh</c>, or falls back to a credential-less
    /// trusted-network login.
    /// </summary>
    /// <remarks>
    /// Port of <c>AccessTokenCoordinator</c> in the iOS client's
    /// PlayarrKit, including its two deliberately different retry scopes.
    /// </remarks>
    internal sealed class AccessTokenCoordinator
    {
        private readonly ApiClientConfiguration _configuration;
        private readonly ITokenStore _tokenStore;
        private readonly IKnownServerGroupStore? _serverGroupStore;
        private readonly HttpClient _http;
        private readonly Func<DateTimeOffset> _clock;

        /// <summary>
        /// Collapses concurrent callers onto one in-flight acquisition, so a
        /// screen firing six parallel requests on load cannot start six
        /// simultaneous refreshes and rotate the refresh token out from
        /// under itself.
        /// </summary>
        private readonly SemaphoreSlim _gate = new SemaphoreSlim(1, 1);

        internal AccessTokenCoordinator(
            ApiClientConfiguration configuration,
            ITokenStore tokenStore,
            IKnownServerGroupStore? serverGroupStore,
            HttpClient http,
            Func<DateTimeOffset>? clock = null)
        {
            _configuration = configuration;
            _tokenStore = tokenStore;
            _serverGroupStore = serverGroupStore;
            _http = http;
            _clock = clock ?? (() => DateTimeOffset.UtcNow);
        }

        public async Task<string> GetAccessTokenAsync(
            bool forceRefresh,
            CancellationToken cancellationToken)
        {
            await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
            try
            {
                return await AcquireAsync(forceRefresh, cancellationToken).ConfigureAwait(false);
            }
            finally
            {
                _gate.Release();
            }
        }

        private async Task<string> AcquireAsync(bool forceRefresh, CancellationToken cancellationToken)
        {
            var existing = await _tokenStore.GetSessionAsync(cancellationToken).ConfigureAwait(false);

            // A two-minute skew guard: a token that expires while the request
            // is in flight is no use, and the refresh is cheap.
            if (!forceRefresh &&
                existing != null &&
                existing.ExpiresAt > _clock().AddMinutes(2))
            {
                return existing.AccessToken.ExposeSecret();
            }

            Exception? transientError = null;
            var definitive = false;
            if (existing != null)
            {
                var (candidates, sameNode) = await RefreshCandidatesAsync(existing, cancellationToken).ConfigureAwait(false);
                foreach (var baseUrl in candidates)
                {
                    try
                    {
                        var rotated = await RefreshAsync(
                            existing.RefreshToken.ExposeSecret(),
                            JwtClaims.DeviceId(existing.AccessToken.ExposeSecret()) ?? _configuration.DeviceId,
                            baseUrl,
                            cancellationToken).ConfigureAwait(false);
                        await _tokenStore.StoreSessionAsync(rotated, cancellationToken).ConfigureAwait(false);
                        return rotated.AccessToken.ExposeSecret();
                    }
                    catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
                    {
                        throw;
                    }
                    catch (ApiException error) when (error.StatusCode == HttpStatusCode.Forbidden && error.Body?.Error == "pin_required")
                    {
                        // The profile needs its PIN: the session is fine, so keep it and let the caller ask for the unlock.
                        throw;
                    }
                    catch (Exception error)
                    {
                        // Try the next same-node address before giving up. Only a server answer that rejects the refresh
                        // token (400/401/403) proves it dead; a timeout (an HttpClient timeout is a cancellation too), a dropped
                        // connection or a 5xx says nothing about it, and clearing then would sign the device out for a network blip.
                        //
                        // A rejection only counts when it comes from the node that issued the token (or the group or issuer is
                        // unknown): another node never saw this refresh token, so its 401 proves nothing. The trade-off: if the
                        // issuing node is gone for good the device stays signed in but failing, which is safer than a silent
                        // switch to another user through the credential-less login.
                        var fromIssuer = sameNode is null || sameNode.Contains(baseUrl.ToString().TrimEnd('/'));
                        if (IsDefinitiveRejection(error) && fromIssuer) definitive = true; else transientError = error;
                    }
                }

                // a definitive rejection from any address wins over a transient error elsewhere
                if (definitive)
                {
                    await _tokenStore.ClearSessionAsync(cancellationToken).ConfigureAwait(false);
                }
                else if (transientError != null)
                {
                    // Only a transient failure, no rejection: the session stays as it is and the credential-less login is NOT
                    // tried, because it can sign the device into the household user and bypass a child or PIN profile. A token
                    // that is still valid (and was not just rejected, i.e. not a forced refresh) is returned; otherwise the
                    // transient error surfaces.
                    if (!forceRefresh && existing.ExpiresAt > _clock())
                    {
                        return existing.AccessToken.ExposeSecret();
                    }

                    throw transientError;
                }
            }

            Exception lastLoginError = new ApiException(
                ApiErrorKind.Unauthorized,
                "no session, and no server address accepted a credential-less login");

            foreach (var baseUrl in await LoginCandidatesAsync(cancellationToken).ConfigureAwait(false))
            {
                try
                {
                    var session = await LoginAsync(baseUrl, cancellationToken).ConfigureAwait(false);
                    await _tokenStore.StoreSessionAsync(session, cancellationToken).ConfigureAwait(false);
                    return session.AccessToken.ExposeSecret();
                }
                catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
                {
                    throw;
                }
                catch (Exception error)
                {
                    lastLoginError = error;
                }
            }

            throw lastLoginError;
        }

        private static bool IsDefinitiveRejection(Exception error) =>
            error is ApiException api &&
            (api.StatusCode == HttpStatusCode.Unauthorized ||
             api.StatusCode == HttpStatusCode.BadRequest ||
             api.StatusCode == HttpStatusCode.Forbidden);

        /// <summary>
        /// <strong>Any-node.</strong> Used only by the credential-less login
        /// fallback, which is valid to attempt at any group member since
        /// accounts and policies sync across the group.
        /// </summary>
        private async Task<IReadOnlyList<Uri>> LoginCandidatesAsync(CancellationToken cancellationToken)
        {
            var urls = new List<Uri> { _configuration.BaseUrl };

            if (_serverGroupStore is null)
            {
                return urls;
            }

            var group = await _serverGroupStore.GetGroupAsync(cancellationToken).ConfigureAwait(false);
            if (group is null)
            {
                return urls;
            }

            foreach (var candidate in group.CandidateUrls())
            {
                if (Uri.TryCreate(candidate, UriKind.Absolute, out var parsed) && !urls.Contains(parsed))
                {
                    urls.Add(parsed);
                }
            }

            return urls;
        }

        /// <summary>
        /// <strong>Same-node only.</strong> Refresh tokens are never synced
        /// across peer nodes, so only addresses attributed to the node that
        /// issued this session's access token are worth retrying -- read
        /// from the token's own <c>iss</c> claim, a routing hint with no
        /// signature verification. When the issuer can't be determined (a
        /// standalone node's non-GUID issuer string, an unknown group, a
        /// malformed token) this degrades to the configured address alone.
        /// </summary>
        private async Task<(IReadOnlyList<Uri> Urls, HashSet<string>? SameNode)> RefreshCandidatesAsync(
            StoredAuthSession session,
            CancellationToken cancellationToken)
        {
            var urls = new List<Uri> { _configuration.BaseUrl };

            if (_serverGroupStore is null)
            {
                return (urls, null);
            }

            var group = await _serverGroupStore.GetGroupAsync(cancellationToken).ConfigureAwait(false);
            var issuer = JwtClaims.IssuerPeerId(session.AccessToken.ExposeSecret());

            if (group is null || issuer is null)
            {
                return (urls, null);
            }

            var sameNode = new HashSet<string>(StringComparer.Ordinal);
            foreach (var candidate in group.SameNodeAddresses(issuer.Value))
            {
                if (Uri.TryCreate(candidate, UriKind.Absolute, out var parsed))
                {
                    sameNode.Add(parsed.ToString().TrimEnd('/'));
                    if (!urls.Contains(parsed))
                    {
                        urls.Add(parsed);
                    }
                }
            }

            return (urls, sameNode);
        }

        private async Task<StoredAuthSession> RefreshAsync(
            string refreshToken,
            Guid deviceId,
            Uri baseUrl,
            CancellationToken cancellationToken)
        {
            var body = new RefreshRequest
            {
                DeviceId = deviceId,
                RefreshToken = refreshToken,
            };

            var refreshed = await PostAsync<RefreshResponse>(
                "/api/v1/auth/refresh",
                JsonCoding.Serialize(body),
                baseUrl,
                cancellationToken).ConfigureAwait(false);

            await RecordOutcomeAsync(refreshed.PeerAddresses, baseUrl, cancellationToken).ConfigureAwait(false);

            return new StoredAuthSession(
                refreshed.AccessToken,
                refreshed.RefreshToken,
                refreshed.TokenType,
                _clock().AddSeconds(refreshed.ExpiresIn));
        }

        private async Task<StoredAuthSession> LoginAsync(Uri baseUrl, CancellationToken cancellationToken)
        {
            var body = new LoginRequest
            {
                DeviceId = _configuration.DeviceId,
                DeviceName = _configuration.DeviceName,
                ClientPlatform = _configuration.ClientPlatform,
                ClientVersion = _configuration.ClientVersion,
            };

            var loggedIn = await PostAsync<LoginResponse>(
                "/api/v1/auth/login",
                JsonCoding.Serialize(body),
                baseUrl,
                cancellationToken).ConfigureAwait(false);

            await RecordOutcomeAsync(loggedIn.PeerAddresses, baseUrl, cancellationToken).ConfigureAwait(false);

            return new StoredAuthSession(
                loggedIn.AccessToken,
                loggedIn.RefreshToken,
                loggedIn.TokenType,
                _clock().AddSeconds(loggedIn.ExpiresIn));
        }

        /// <summary>
        /// A successful refresh or login is the only signal this coordinator
        /// has that an address is currently reachable -- feed it back into
        /// the group so the next attempt fast-paths it, whether or not the
        /// server sent a fresh bundle this time.
        /// </summary>
        private async Task RecordOutcomeAsync(
            PeerAddressBundle? bundle,
            Uri successfulUrl,
            CancellationToken cancellationToken)
        {
            if (_serverGroupStore is null)
            {
                return;
            }

            var url = successfulUrl.ToString().TrimEnd('/');

            if (bundle != null)
            {
                await _serverGroupStore
                    .MergeAsync(bundle, url, _clock(), cancellationToken)
                    .ConfigureAwait(false);
            }
            else
            {
                await _serverGroupStore
                    .RecordSuccessAsync(url, _clock(), cancellationToken)
                    .ConfigureAwait(false);
            }
        }

        private async Task<T> PostAsync<T>(
            string path,
            string json,
            Uri baseUrl,
            CancellationToken cancellationToken)
            where T : class
        {
            var builder = new UriBuilder(baseUrl);
            builder.Path = builder.Path.TrimEnd('/') + path;

            using var request = new HttpRequestMessage(HttpMethod.Post, builder.Uri)
            {
                Content = new StringContent(json, Encoding.UTF8, "application/json"),
            };
            request.Headers.TryAddWithoutValidation("Accept", "application/json");
            request.Headers.TryAddWithoutValidation(
                PlayarrApiClient.ClientPlatformHeader,
                _configuration.ClientPlatform.WireName());
            request.Headers.TryAddWithoutValidation(
                PlayarrApiClient.ClientVersionHeader,
                _configuration.ClientVersion);

            using var response = await _http.SendAsync(request, cancellationToken).ConfigureAwait(false);
            var payload = await response.Content.ReadAsStringAsync().ConfigureAwait(false);

            if (response.StatusCode != HttpStatusCode.OK)
            {
                throw ApiException.ForStatus(
                    response.StatusCode,
                    JsonCoding.Deserialize<ApiErrorBody>(payload));
            }

            return JsonCoding.Deserialize<T>(payload)
                ?? throw new ApiException(ApiErrorKind.Decoding, $"unreadable {typeof(T).Name} response");
        }
    }
}
