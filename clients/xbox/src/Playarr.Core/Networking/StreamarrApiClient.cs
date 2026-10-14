using System;
using System.Collections.Generic;
using System.Linq;
using System.Globalization;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Playarr.Core.Auth;
using Playarr.Core.Models;
using Playarr.Core.Playback;

namespace Playarr.Core.Networking
{
    /// <summary>
    /// The shape of the Playarr HTTP API this client depends on,
    /// independent of how a request is actually made -- so screens can be
    /// tested against a substitute.
    /// </summary>
    /// <remarks>
    /// The RFC 8628 device-flow endpoints are deliberately absent: they live
    /// in <see cref="DeviceFlowClient"/>, because their unauthenticated,
    /// polling-with-backoff shape does not fit this interface's "one call in,
    /// one typed result out" pattern.
    /// </remarks>
    public interface IRemoteInboxClient
    {
        Task RegisterRemoteTargetAsync(string name, string platform, IEnumerable<string> capabilities, CancellationToken cancellationToken = default);

        /// <summary>Long-polls this target's inbox for up to <paramref name="waitSeconds"/> (the server caps it at 25).</summary>
        Task<RemoteInbox> PollRemoteInboxAsync(long after, int waitSeconds, CancellationToken cancellationToken = default);

        /// <summary>Acknowledges an inbox event with ok, failed or unsupported.</summary>
        Task AckRemoteEventAsync(Guid eventId, string status, string? detail, CancellationToken cancellationToken = default);
    }

    public interface IPlayarrApiClient : IRemoteInboxClient
    {
        Uri BaseUrl { get; }

        Task<VersionEnvelope> GetVersionAsync(CancellationToken cancellationToken = default);

        Task<CatalogPage> BrowseCatalogAsync(
            WorkKind? kind = null,
            string? genre = null,
            string? sort = null,
            int? limit = null,
            int? offset = null,
            CancellationToken cancellationToken = default,
            bool availableOnly = false,
            string? order = null);

        Task<IList<Work>> SearchCatalogAsync(
            string query,
            int? limit = null,
            CancellationToken cancellationToken = default);

        Task<WorkDetail> GetWorkAsync(Guid id, CancellationToken cancellationToken = default);

        /// <summary>Works similar to <paramref name="id"/> (<c>/api/v1/catalog/{id}/similar</c>), used for end-of-playback suggestions.</summary>
        Task<IList<Work>> GetSimilarWorksAsync(Guid id, int? limit = null, CancellationToken cancellationToken = default);

        Task<HomeRailsResponse> GetHomeRailsAsync(CancellationToken cancellationToken = default);

        Task<IList<MediaChapter>> GetMediaChaptersAsync(Guid mediaFileId, CancellationToken cancellationToken = default);

        /// <summary><c>GET /api/v1/catalog/{id}/resume-plan</c>: where a series' Start / Resume / Watch again button goes.</summary>
        Task<ResumePlan> GetResumePlanAsync(Guid seriesWorkId, CancellationToken cancellationToken = default);

        /// <summary><c>POST /api/v1/catalog/{id}/resume-plan/choice</c>: records the option the viewer picked.</summary>
        Task RecordResumeChoiceAsync(Guid seriesWorkId, ResumeOption option, CancellationToken cancellationToken = default);

        /// <summary><c>DELETE /api/v1/catalog/{id}/resume-plan/choices</c>: forgets every recorded answer ("Ask again").</summary>
        Task ClearResumeChoicesAsync(Guid seriesWorkId, CancellationToken cancellationToken = default);

        /// <summary><c>GET /api/v1/catalog/{id}/credits</c>: the work's cast and crew.</summary>
        Task<WorkCredits> GetWorkCreditsAsync(Guid workId, CancellationToken cancellationToken = default);

        /// <summary>A cast or crew headshot through the server's resizing proxy (the web asks for 240 px).</summary>
        Task<byte[]> GetPersonArtworkAsync(Guid personId, int width, CancellationToken cancellationToken = default);

        /// <summary><c>GET /api/v1/media/{id}/playback-options</c>: the quality, audio and subtitle choices and the viewer's remembered ones.</summary>
        Task<MediaPlaybackOptions> GetMediaPlaybackOptionsAsync(Guid mediaFileId, CancellationToken cancellationToken = default);

        /// <summary><c>PATCH /api/v1/media/{id}/playback-options</c>: remember the viewer's selections (null audio or subtitle = automatic / off).</summary>
        Task SaveMediaPlaybackPreferencesAsync(Guid mediaFileId, MediaPlaybackPreferences preferences, CancellationToken cancellationToken = default);

        /// <summary>A frame of the file at <paramref name="positionMs"/> (the web's chapter thumbnails); empty when it has nothing to extract.</summary>
        Task<byte[]> GetMediaThumbnailAsync(Guid mediaFileId, long positionMs, CancellationToken cancellationToken = default);

        Task<RailPreferencesResponse> GetRailPreferencesAsync(CancellationToken cancellationToken = default);

        Task SaveRailPreferencesAsync(IEnumerable<RailPreferenceEntry> rails, CancellationToken cancellationToken = default);

        Task ResetRailPreferencesAsync(CancellationToken cancellationToken = default);

        /// <summary>
        /// Server-cached, resized artwork (<c>/api/v1/artwork/work/{id}/{kind}</c>), the only route that serves
        /// art the source stores behind a private scheme. Needs the bearer token, so an Image cannot load it by URL.
        /// </summary>
        Task<byte[]> GetEpisodeArtworkAsync(Guid seriesId, Guid episodeId, ImageKind kind, int width, string? version = null, CancellationToken cancellationToken = default);

        Task<byte[]> GetWorkArtworkAsync(Guid id, ImageKind kind, int width, string? version = null, CancellationToken cancellationToken = default);

        Task<CalendarResponse> GetCalendarAsync(DateTime start, DateTime end, CancellationToken cancellationToken = default);

        Task<IList<WorkKind>> ListCatalogKindsAsync(CancellationToken cancellationToken = default);

        Task<IList<AvailableProfile>> ListProfilesAsync(CancellationToken cancellationToken = default);

        Task<ProfileAvatarSettingResponse> GetProfileAvatarAsync(CancellationToken cancellationToken = default);

        Task<DownloadOptionsResponse> GetDownloadOptionsAsync(Guid mediaFileId, CancellationToken cancellationToken = default);

        Task<DownloadTicket> CreateDownloadAsync(Guid mediaFileId, string qualityId, CancellationToken cancellationToken = default);

        Task<DownloadTicket> GetDownloadAsync(Guid id, CancellationToken cancellationToken = default);

        /// <summary>Tells the server the device has the whole file, so its staged copy is deleted at once.</summary>
        Task CompleteDownloadAsync(Guid id, CancellationToken cancellationToken = default);

        /// <summary>Cancels or deletes a ticket and its server-side file.</summary>
        Task CancelDownloadAsync(Guid id, CancellationToken cancellationToken = default);

        /// <summary>Opens the ticket's file from <paramref name="from"/> (a <c>Range</c> request); the caller disposes the response.</summary>
        Task<HttpResponseMessage> OpenDownloadFileAsync(Guid id, long from, CancellationToken cancellationToken = default);

        Task<ProfilePinSettingResponse> GetProfilePinSettingAsync(CancellationToken cancellationToken = default);

        /// <summary>Sets an exactly four-digit PIN, or removes the lock with <c>null</c>.</summary>
        Task SetProfilePinAsync(string? pin, CancellationToken cancellationToken = default);

        Task SetProfileAvatarPresetAsync(string preset, CancellationToken cancellationToken = default);

        Task<IList<WatchProgress>> ListWatchProgressAsync(CancellationToken cancellationToken = default);

        Task<WatchlistResponse> GetWatchlistAsync(CancellationToken cancellationToken = default);

        /// <summary>Saves a library title to the watchlist (<c>POST /api/v1/watchlist</c> with the title snapshot).</summary>
        Task AddToWatchlistAsync(Work work, CancellationToken cancellationToken = default);

        /// <summary>Adds a work to a playlist (<c>POST /api/v1/playlists/{id}/items</c>).</summary>
        Task AddToPlaylistAsync(Guid playlistId, Guid workId, CancellationToken cancellationToken = default);

        Task RemoveFromWatchlistAsync(string titleKey, CancellationToken cancellationToken = default);

        Task<IList<RequestView>> ListRequestsAsync(CancellationToken cancellationToken = default);

        Task<IList<PlaylistInfo>> ListPlaylistsAsync(CancellationToken cancellationToken = default);

        Task<IList<PlaylistItem>> ListPlaylistItemsAsync(Guid playlistId, CancellationToken cancellationToken = default);

        Task<WatchProgress> GetWatchProgressAsync(Guid mediaFileId, CancellationToken cancellationToken = default);

        Task<WatchProgress> UpdateWatchProgressAsync(
            Guid mediaFileId,
            UpdateWatchProgressRequest body,
            CancellationToken cancellationToken = default);

        /// <summary>
        /// Negotiates delivery for one media file against this console's
        /// declared capabilities.
        /// </summary>
        Task<PlaybackInfoResponse> GetPlaybackInfoAsync(
            Guid mediaFileId,
            XboxPlaybackProfile profile,
            CancellationToken cancellationToken = default,
            DeviceCaps? caps = null);

        /// <summary>
        /// The <c>Authorization</c> header a media element must send when
        /// fetching the stream itself. <c>MediaPlayerElement</c> fetches
        /// segments outside this client, so it needs the token handed to it.
        /// </summary>
        Task<IDictionary<string, string>> GetPlaybackRequestHeadersAsync(
            CancellationToken cancellationToken = default);

        // ---- Settings > Invite a friend, Phone remote and Your data (the web's api-client, same endpoints) ----

        /// <summary><c>GET /api/v1/users/me/user-invite-request</c>; null when this account never asked.</summary>
        Task<UserInviteRequest?> GetMyUserInviteRequestAsync(CancellationToken cancellationToken = default);

        Task<UserInviteRequest> CreateUserInviteRequestAsync(string? message, CancellationToken cancellationToken = default);

        Task<UserInvite> GenerateApprovedUserInviteAsync(CancellationToken cancellationToken = default);

        /// <summary>Admin-only (403 for everyone else); callers fall back to this server's own address.</summary>
        Task<PeerAddressBundle> GetPeerAddressBundleAsync(CancellationToken cancellationToken = default);

        Task UnregisterRemoteTargetAsync(CancellationToken cancellationToken = default);

        Task<IList<RemoteTarget>> ListRemoteTargetsAsync(CancellationToken cancellationToken = default);

        Task<IList<RemotePairing>> ListRemotePairingsAsync(CancellationToken cancellationToken = default);

        Task<RemotePairing> RequestRemotePairingAsync(Guid targetDeviceId, string controllerName, CancellationToken cancellationToken = default);

        Task<RemotePairing> GetRemotePairingAsync(Guid id, CancellationToken cancellationToken = default);

        Task<RemotePairing> ApproveRemotePairingAsync(Guid id, CancellationToken cancellationToken = default);

        Task DenyRemotePairingAsync(Guid id, CancellationToken cancellationToken = default);

        Task RenameRemotePairingAsync(Guid id, string name, CancellationToken cancellationToken = default);

        Task RevokeRemotePairingAsync(Guid id, CancellationToken cancellationToken = default);

        Task<RemoteCommandAccepted> SendRemoteCommandAsync(Guid pairingId, string kind, string payloadJson, CancellationToken cancellationToken = default);

        Task<RemoteCommandStatus> GetRemoteCommandStatusAsync(Guid commandId, CancellationToken cancellationToken = default);

        Task<UserDataExportJob> StartUserDataExportAsync(CancellationToken cancellationToken = default);

        Task<UserDataExportJob> GetUserDataExportAsync(string id, CancellationToken cancellationToken = default);

        Task<UserDataTransferLink> CreateUserDataTransferLinkAsync(string exportId, CancellationToken cancellationToken = default);

        Task<UserDataImportSession> CreateUserDataImportSessionAsync(CancellationToken cancellationToken = default);

        Task<UserDataImportSession> GetUserDataImportSessionAsync(string id, CancellationToken cancellationToken = default);

        Task DeleteUserDataImportSessionAsync(string id, CancellationToken cancellationToken = default);

        Task<UserDataImportPreview> PreviewUserDataImportSessionAsync(string id, bool includePreferences, string progressConflicts, CancellationToken cancellationToken = default);

        Task<UserDataImportResult> ApplyUserDataImportSessionAsync(string id, string packageSha256, bool includePreferences, string progressConflicts, CancellationToken cancellationToken = default);

        /// <summary>
        /// Resolves a possibly server-relative URL (as returned in
        /// <see cref="PlaybackInfoResponse.Url"/>) against
        /// <see cref="BaseUrl"/>.
        /// </summary>
        Uri? ResolveUrl(string path);
    }

    /// <summary>
    /// One platform's row in the server's compatibility table.
    /// </summary>
    public sealed class CompatibilityEntry
    {
        [Newtonsoft.Json.JsonProperty("platform")] public ClientPlatform? Platform { get; set; }

        [Newtonsoft.Json.JsonProperty("latest_version")] public string LatestVersion { get; set; } = string.Empty;

        [Newtonsoft.Json.JsonProperty("min_supported_version")] public string MinSupportedVersion { get; set; } = string.Empty;

        [Newtonsoft.Json.JsonProperty("deprecated_below")] public string? DeprecatedBelow { get; set; }

        [Newtonsoft.Json.JsonProperty("sunset")] public string? Sunset { get; set; }
    }

    public sealed class VersionEnvelope
    {
        [Newtonsoft.Json.JsonProperty("instance_name")] public string InstanceName { get; set; } = string.Empty;

        [Newtonsoft.Json.JsonProperty("server_version")] public string ServerVersion { get; set; } = string.Empty;

        [Newtonsoft.Json.JsonProperty("api_version")] public string ApiVersion { get; set; } = string.Empty;

        [Newtonsoft.Json.JsonProperty("build_sha")] public string? BuildSha { get; set; }

        [Newtonsoft.Json.JsonProperty("compatibility")] public IList<CompatibilityEntry> Compatibility { get; set; } =
            new List<CompatibilityEntry>();
    }

    /// <summary>
    /// Real <see cref="HttpClient"/>-backed implementation.
    /// </summary>
    public sealed class PlayarrApiClient : IPlayarrApiClient
    {
        public const string ClientPlatformHeader = "X-Playarr-Client-Platform";
        public const string ClientVersionHeader = "X-Playarr-Client-Version";

        private readonly ApiClientConfiguration _configuration;
        private readonly HttpClient _http;
        private readonly AccessTokenCoordinator? _tokens;

        public PlayarrApiClient(
            ApiClientConfiguration configuration,
            ITokenStore? tokenStore = null,
            IKnownServerGroupStore? serverGroupStore = null,
            HttpClient? httpClient = null,
            Func<DateTimeOffset>? clock = null)
        {
            _configuration = configuration ?? throw new ArgumentNullException(nameof(configuration));
            _http = httpClient ?? new HttpClient();
            _tokens = tokenStore is null
                ? null
                : new AccessTokenCoordinator(configuration, tokenStore, serverGroupStore, _http, clock);
        }

        public Uri BaseUrl => _configuration.BaseUrl;

        public Task<VersionEnvelope> GetVersionAsync(CancellationToken cancellationToken = default) =>
            GetAsync<VersionEnvelope>("/api/system/version", null, authenticated: false, cancellationToken);

        public Task<CatalogPage> BrowseCatalogAsync(
            WorkKind? kind = null,
            string? genre = null,
            string? sort = null,
            int? limit = null,
            int? offset = null,
            CancellationToken cancellationToken = default,
            bool availableOnly = false,
            string? order = null)
        {
            var query = new Dictionary<string, string>();
            if (availableOnly) query["available_only"] = "true";
            if (!string.IsNullOrEmpty(order)) query["order"] = order!;
            if (kind is { } workKind && workKind != WorkKind.Unknown)
            {
                query["kind"] = WireNameFor(workKind);
            }

            if (!string.IsNullOrEmpty(genre)) query["genre"] = genre!;
            if (!string.IsNullOrEmpty(sort)) query["sort"] = sort!;
            if (limit is { } l) query["limit"] = l.ToString(CultureInfo.InvariantCulture);
            if (offset is { } o) query["offset"] = o.ToString(CultureInfo.InvariantCulture);

            return GetAsync<CatalogPage>("/api/v1/catalog", query, authenticated: true, cancellationToken);
        }

        public Task<IList<Work>> SearchCatalogAsync(
            string query,
            int? limit = null,
            CancellationToken cancellationToken = default)
        {
            var parameters = new Dictionary<string, string> { ["q"] = query };
            if (limit is { } l) parameters["limit"] = l.ToString(CultureInfo.InvariantCulture);

            return GetAsync<IList<Work>>(
                "/api/v1/catalog/search", parameters, authenticated: true, cancellationToken);
        }

        public Task<WorkDetail> GetWorkAsync(Guid id, CancellationToken cancellationToken = default) =>
            GetAsync<WorkDetail>($"/api/v1/catalog/{id:D}", null, authenticated: true, cancellationToken);

        public Task<IList<Work>> GetSimilarWorksAsync(
            Guid id, int? limit = null, CancellationToken cancellationToken = default)
        {
            var query = new Dictionary<string, string>();
            if (limit is { } l) query["limit"] = l.ToString(CultureInfo.InvariantCulture);

            return GetAsync<IList<Work>>(
                $"/api/v1/catalog/{id:D}/similar", query, authenticated: true, cancellationToken);
        }

        /// <summary><c>GET /api/v1/home/rails</c>: the caller's ordered, non-empty Home rails.</summary>
        public Task<HomeRailsResponse> GetHomeRailsAsync(CancellationToken cancellationToken = default) =>
            GetAsync<HomeRailsResponse>("/api/v1/home/rails", null, authenticated: true, cancellationToken);

        /// <summary><c>GET /api/v1/home/rails/preferences</c>: Settings > Customise Home.</summary>
        public Task<RailPreferencesResponse> GetRailPreferencesAsync(CancellationToken cancellationToken = default) =>
            GetAsync<RailPreferencesResponse>("/api/v1/home/rails/preferences", null, authenticated: true, cancellationToken);

        /// <summary><c>PUT /api/v1/home/rails/preferences</c> with the full order and the hidden set.</summary>
        public Task SaveRailPreferencesAsync(IEnumerable<RailPreferenceEntry> rails, CancellationToken cancellationToken = default)
        {
            var list = rails.ToList();
            var json = Newtonsoft.Json.JsonConvert.SerializeObject(new
            {
                order = list.Select(r => r.Id),
                hidden = list.Where(r => r.Hidden).Select(r => r.Id),
            });
            return SendNoBodyAsync(HttpMethod.Put, "/api/v1/home/rails/preferences", json, cancellationToken);
        }

        /// <summary><c>DELETE /api/v1/home/rails/preferences</c>: back to the admin's default rails.</summary>
        public Task ResetRailPreferencesAsync(CancellationToken cancellationToken = default) =>
            SendNoBodyAsync(HttpMethod.Delete, "/api/v1/home/rails/preferences", null!, cancellationToken);

        public Task<IList<MediaChapter>> GetMediaChaptersAsync(Guid mediaFileId, CancellationToken cancellationToken = default) =>
            GetAsync<IList<MediaChapter>>($"/api/v1/media/{mediaFileId:D}/chapters", null, authenticated: true, cancellationToken);

        public Task<ResumePlan> GetResumePlanAsync(Guid seriesWorkId, CancellationToken cancellationToken = default) =>
            GetAsync<ResumePlan>($"/api/v1/catalog/{seriesWorkId:D}/resume-plan", null, authenticated: true, cancellationToken);

        public Task RecordResumeChoiceAsync(Guid seriesWorkId, ResumeOption option, CancellationToken cancellationToken = default) =>
            SendNoBodyAsync(HttpMethod.Post, $"/api/v1/catalog/{seriesWorkId:D}/resume-plan/choice",
                "{\"kind\":\"" + option.Kind + "\",\"episode_id\":\"" + option.EpisodeId.ToString("D") + "\"}", cancellationToken);

        public Task ClearResumeChoicesAsync(Guid seriesWorkId, CancellationToken cancellationToken = default) =>
            SendNoBodyAsync(HttpMethod.Delete, $"/api/v1/catalog/{seriesWorkId:D}/resume-plan/choices", null!, cancellationToken);

        public Task<WorkCredits> GetWorkCreditsAsync(Guid workId, CancellationToken cancellationToken = default) =>
            GetAsync<WorkCredits>($"/api/v1/catalog/{workId:D}/credits", null, authenticated: true, cancellationToken);

        public Task<byte[]> GetPersonArtworkAsync(Guid personId, int width, CancellationToken cancellationToken = default) =>
            FetchArtworkAsync($"/api/v1/artwork/person/{personId:D}", width, null, cancellationToken);

        public Task<MediaPlaybackOptions> GetMediaPlaybackOptionsAsync(Guid mediaFileId, CancellationToken cancellationToken = default) =>
            GetAsync<MediaPlaybackOptions>($"/api/v1/media/{mediaFileId:D}/playback-options", null, authenticated: true, cancellationToken);

        public Task SaveMediaPlaybackPreferencesAsync(Guid mediaFileId, MediaPlaybackPreferences preferences, CancellationToken cancellationToken = default) =>
            SendNoBodyAsync(new HttpMethod("PATCH"), $"/api/v1/media/{mediaFileId:D}/playback-options", Newtonsoft.Json.JsonConvert.SerializeObject(preferences), cancellationToken);

        public async Task<byte[]> GetMediaThumbnailAsync(Guid mediaFileId, long positionMs, CancellationToken cancellationToken = default)
        {
            var query = new Dictionary<string, string> { ["position_ms"] = positionMs.ToString(CultureInfo.InvariantCulture) };
            try
            {
                return await SendBytesOnceAsync($"/api/v1/media/{mediaFileId:D}/thumbnail", query, false, cancellationToken).ConfigureAwait(false);
            }
            catch (ApiException error) when (error.Kind == ApiErrorKind.Unauthorized && _tokens != null)
            {
                return await SendBytesOnceAsync($"/api/v1/media/{mediaFileId:D}/thumbnail", query, true, cancellationToken).ConfigureAwait(false);
            }
        }

        public Task<byte[]> GetEpisodeArtworkAsync(
            Guid seriesId, Guid episodeId, ImageKind kind, int width, string? version = null, CancellationToken cancellationToken = default) =>
            FetchArtworkAsync($"/api/v1/artwork/episode/{seriesId:D}/{episodeId:D}/{kind.ToString().ToLowerInvariant()}", width, version, cancellationToken);

        public Task<byte[]> GetWorkArtworkAsync(
            Guid id, ImageKind kind, int width, string? version = null, CancellationToken cancellationToken = default) =>
            FetchArtworkAsync($"/api/v1/artwork/work/{id:D}/{kind.ToString().ToLowerInvariant()}", width, version, cancellationToken);

        private async Task<byte[]> FetchArtworkAsync(string path, int width, string? version, CancellationToken cancellationToken)
        {
            var query = new Dictionary<string, string> { ["w"] = width.ToString(CultureInfo.InvariantCulture) };
            if (version != null)
            {
                query["v"] = version;
            }

            try
            {
                return await SendBytesOnceAsync(path, query, false, cancellationToken).ConfigureAwait(false);
            }
            catch (ApiException error) when (error.Kind == ApiErrorKind.Unauthorized && _tokens != null)
            {
                return await SendBytesOnceAsync(path, query, true, cancellationToken).ConfigureAwait(false);
            }
        }

        private async Task<byte[]> SendBytesOnceAsync(
            string path, IDictionary<string, string> query, bool forceRefresh, CancellationToken cancellationToken)
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, BuildUri(path, query));
            request.Headers.TryAddWithoutValidation(ClientPlatformHeader, _configuration.ClientPlatform.WireName());
            request.Headers.TryAddWithoutValidation(ClientVersionHeader, _configuration.ClientVersion);
            if (_tokens != null)
            {
                var token = await _tokens.GetAccessTokenAsync(forceRefresh, cancellationToken).ConfigureAwait(false);
                request.Headers.TryAddWithoutValidation("Authorization", $"Bearer {token}");
            }

            HttpResponseMessage response;
            try
            {
                response = await _http.SendAsync(request, cancellationToken).ConfigureAwait(false);
            }
            catch (Exception transport) when (transport is HttpRequestException or OperationCanceledException
                                              && !cancellationToken.IsCancellationRequested)
            {
                throw new ApiException(ApiErrorKind.Transport, "the request could not be sent", innerException: transport);
            }

            using (response)
            {
                if (!response.IsSuccessStatusCode)
                {
                    throw ApiException.ForStatus(response.StatusCode, null);
                }

                return await response.Content.ReadAsByteArrayAsync().ConfigureAwait(false);
            }
        }

        /// <summary><c>GET /api/v1/calendar</c> for a day range, series grouped per day like the web.</summary>
        public Task<CalendarResponse> GetCalendarAsync(DateTime start, DateTime end, CancellationToken cancellationToken = default) =>
            GetAsync<CalendarResponse>(
                "/api/v1/calendar",
                new Dictionary<string, string>
                {
                    ["start"] = start.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                    ["end"] = end.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                    ["group"] = "series_day",
                },
                authenticated: true,
                cancellationToken);

        public Task<IList<WorkKind>> ListCatalogKindsAsync(CancellationToken cancellationToken = default) =>
            GetAsync<IList<WorkKind>>("/api/v1/catalog/kinds", null, authenticated: true, cancellationToken);

        public Task<IList<AvailableProfile>> ListProfilesAsync(CancellationToken cancellationToken = default) =>
            GetAsync<IList<AvailableProfile>>(
                "/api/v1/users/profiles", null, authenticated: true, cancellationToken);

        public Task<IList<WatchProgress>> ListWatchProgressAsync(CancellationToken cancellationToken = default) =>
            GetAsync<IList<WatchProgress>>(
                "/api/v1/playback/progress", null, authenticated: true, cancellationToken);

        public Task<WatchProgress> GetWatchProgressAsync(Guid mediaFileId, CancellationToken cancellationToken = default) =>
            GetAsync<WatchProgress>(
                $"/api/v1/playback/{mediaFileId:D}/progress", null, authenticated: true, cancellationToken);

        public Task<ProfileAvatarSettingResponse> GetProfileAvatarAsync(CancellationToken cancellationToken = default) =>
            GetAsync<ProfileAvatarSettingResponse>("/api/v1/users/me/profile-avatar", null, authenticated: true, cancellationToken);
        public Task<DownloadOptionsResponse> GetDownloadOptionsAsync(Guid mediaFileId, CancellationToken cancellationToken = default) =>
            GetAsync<DownloadOptionsResponse>($"/api/v1/media/{mediaFileId:D}/download-options", null, authenticated: true, cancellationToken);

        public Task<DownloadTicket> CreateDownloadAsync(Guid mediaFileId, string qualityId, CancellationToken cancellationToken = default) =>
            SendAsync<DownloadTicket>(HttpMethod.Post, "/api/v1/downloads",
                "{\"media_file_id\":\"" + mediaFileId.ToString("D") + "\",\"quality_id\":" + Newtonsoft.Json.JsonConvert.ToString(qualityId) + "}", cancellationToken);

        public Task<DownloadTicket> GetDownloadAsync(Guid id, CancellationToken cancellationToken = default) =>
            GetAsync<DownloadTicket>($"/api/v1/downloads/{id:D}", null, authenticated: true, cancellationToken);

        public Task CompleteDownloadAsync(Guid id, CancellationToken cancellationToken = default) =>
            SendNoBodyAsync(HttpMethod.Post, $"/api/v1/downloads/{id:D}/complete", null!, cancellationToken);

        public Task CancelDownloadAsync(Guid id, CancellationToken cancellationToken = default) =>
            SendNoBodyAsync(HttpMethod.Delete, $"/api/v1/downloads/{id:D}", null!, cancellationToken);

        public async Task<HttpResponseMessage> OpenDownloadFileAsync(Guid id, long from, CancellationToken cancellationToken = default)
        {
            async Task<HttpResponseMessage> Once(bool forceRefresh)
            {
                var request = new HttpRequestMessage(HttpMethod.Get, BuildUri($"/api/v1/downloads/{id:D}/file", null));
                request.Headers.TryAddWithoutValidation(ClientPlatformHeader, _configuration.ClientPlatform.WireName());
                request.Headers.TryAddWithoutValidation(ClientVersionHeader, _configuration.ClientVersion);
                if (from > 0)
                {
                    request.Headers.Range = new System.Net.Http.Headers.RangeHeaderValue(from, null);
                }

                if (_tokens != null)
                {
                    var token = await _tokens.GetAccessTokenAsync(forceRefresh, cancellationToken).ConfigureAwait(false);
                    request.Headers.TryAddWithoutValidation("Authorization", $"Bearer {token}");
                }

                try
                {
                    return await _http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken).ConfigureAwait(false);
                }
                catch (Exception transport) when (transport is HttpRequestException or OperationCanceledException
                                                  && !cancellationToken.IsCancellationRequested)
                {
                    throw new ApiException(ApiErrorKind.Transport, "the request could not be sent", innerException: transport);
                }
            }

            var response = await Once(false).ConfigureAwait(false);
            if (response.StatusCode == HttpStatusCode.Unauthorized && _tokens != null)
            {
                response.Dispose();
                response = await Once(true).ConfigureAwait(false);
            }

            if (!response.IsSuccessStatusCode)
            {
                var payload = await response.Content.ReadAsStringAsync().ConfigureAwait(false);
                var status = response.StatusCode;
                response.Dispose();
                throw ApiException.ForStatus(status, JsonCoding.Deserialize<ApiErrorBody>(payload));
            }

            return response;
        }

        public Task<ProfilePinSettingResponse> GetProfilePinSettingAsync(CancellationToken cancellationToken = default) =>
            GetAsync<ProfilePinSettingResponse>("/api/v1/users/me/profile-pin", null, authenticated: true, cancellationToken);

        /// <summary><c>PATCH /api/v1/users/me/profile-pin</c>: a four-digit PIN, or null to remove the lock.</summary>
        public Task SetProfilePinAsync(string? pin, CancellationToken cancellationToken = default) =>
            SendNoBodyAsync(new HttpMethod("PATCH"), "/api/v1/users/me/profile-pin",
                pin == null ? "{\"pin\":null}" : "{\"pin\":\"" + pin + "\"}", cancellationToken);

        /// <summary><c>PUT /api/v1/users/me/profile-avatar</c> with one of the shared preset ids.</summary>
        public Task SetProfileAvatarPresetAsync(string preset, CancellationToken cancellationToken = default) =>
            SendNoBodyAsync(HttpMethod.Put, "/api/v1/users/me/profile-avatar", "{\"preference\":{\"kind\":\"preset\",\"value\":\"" + preset + "\"}}", cancellationToken);

        public Task<WatchlistResponse> GetWatchlistAsync(CancellationToken cancellationToken = default) =>
            GetAsync<WatchlistResponse>("/api/v1/watchlist", null, authenticated: true, cancellationToken);

        public Task AddToWatchlistAsync(Work work, CancellationToken cancellationToken = default) =>
            SendNoBodyAsync(HttpMethod.Post, "/api/v1/watchlist", WatchlistSnapshot.Json(work), cancellationToken);

        public Task AddToPlaylistAsync(Guid playlistId, Guid workId, CancellationToken cancellationToken = default) =>
            SendNoBodyAsync(HttpMethod.Post, $"/api/v1/playlists/{playlistId:D}/items", "{\"work_id\":\"" + workId.ToString("D") + "\"}", cancellationToken);

        // ---- Settings > Invite a friend, Phone remote and Your data ----

        public async Task<UserInviteRequest?> GetMyUserInviteRequestAsync(CancellationToken cancellationToken = default) =>
            Decode<UserInviteRequest>(await SendTextAsync(HttpMethod.Get, "/api/v1/users/me/user-invite-request", null, cancellationToken).ConfigureAwait(false), allowNull: true);

        public async Task<UserInviteRequest> CreateUserInviteRequestAsync(string? message, CancellationToken cancellationToken = default) =>
            Decode<UserInviteRequest>(await SendTextAsync(HttpMethod.Post, "/api/v1/users/me/user-invite-request",
                JsonCoding.Serialize(new { message = string.IsNullOrWhiteSpace(message) ? null : message!.Trim() }), cancellationToken).ConfigureAwait(false))!;

        public async Task<UserInvite> GenerateApprovedUserInviteAsync(CancellationToken cancellationToken = default) =>
            Decode<UserInvite>(await SendTextAsync(HttpMethod.Post, "/api/v1/users/me/user-invite-request/generate", "{}", cancellationToken).ConfigureAwait(false))!;

        public async Task<PeerAddressBundle> GetPeerAddressBundleAsync(CancellationToken cancellationToken = default) =>
            Decode<PeerAddressBundle>(await SendTextAsync(HttpMethod.Get, "/api/v1/admin/peer-groups/self/address-bundle", null, cancellationToken).ConfigureAwait(false))!;

        public Task RegisterRemoteTargetAsync(string name, string platform, IEnumerable<string> capabilities, CancellationToken cancellationToken = default) =>
            SendTextAsync(HttpMethod.Put, "/api/v1/remote/target", JsonCoding.Serialize(new { name, platform, capabilities = capabilities.ToArray() }), cancellationToken);

        public Task UnregisterRemoteTargetAsync(CancellationToken cancellationToken = default) =>
            SendTextAsync(HttpMethod.Delete, "/api/v1/remote/target", null, cancellationToken);

        public async Task<IList<RemoteTarget>> ListRemoteTargetsAsync(CancellationToken cancellationToken = default) =>
            Decode<List<RemoteTarget>>(await SendTextAsync(HttpMethod.Get, "/api/v1/remote/targets", null, cancellationToken).ConfigureAwait(false))!;

        public async Task<IList<RemotePairing>> ListRemotePairingsAsync(CancellationToken cancellationToken = default) =>
            Decode<List<RemotePairing>>(await SendTextAsync(HttpMethod.Get, "/api/v1/remote/pairings", null, cancellationToken).ConfigureAwait(false))!;

        public async Task<RemotePairing> RequestRemotePairingAsync(Guid targetDeviceId, string controllerName, CancellationToken cancellationToken = default) =>
            Decode<RemotePairing>(await SendTextAsync(HttpMethod.Post, "/api/v1/remote/pairings",
                JsonCoding.Serialize(new { target_device_id = targetDeviceId, controller_name = controllerName }), cancellationToken).ConfigureAwait(false))!;

        public async Task<RemotePairing> GetRemotePairingAsync(Guid id, CancellationToken cancellationToken = default) =>
            Decode<RemotePairing>(await SendTextAsync(HttpMethod.Get, $"/api/v1/remote/pairings/{id:D}", null, cancellationToken).ConfigureAwait(false))!;

        public async Task<RemotePairing> ApproveRemotePairingAsync(Guid id, CancellationToken cancellationToken = default) =>
            Decode<RemotePairing>(await SendTextAsync(HttpMethod.Post, $"/api/v1/remote/pairings/{id:D}/approve", "{}", cancellationToken).ConfigureAwait(false))!;

        public Task DenyRemotePairingAsync(Guid id, CancellationToken cancellationToken = default) =>
            SendTextAsync(HttpMethod.Post, $"/api/v1/remote/pairings/{id:D}/deny", "{}", cancellationToken);

        public Task RenameRemotePairingAsync(Guid id, string name, CancellationToken cancellationToken = default) =>
            SendTextAsync(new HttpMethod("PATCH"), $"/api/v1/remote/pairings/{id:D}", JsonCoding.Serialize(new { name }), cancellationToken);

        public Task RevokeRemotePairingAsync(Guid id, CancellationToken cancellationToken = default) =>
            SendTextAsync(HttpMethod.Delete, $"/api/v1/remote/pairings/{id:D}", null, cancellationToken);

        public async Task<RemoteCommandAccepted> SendRemoteCommandAsync(Guid pairingId, string kind, string payloadJson, CancellationToken cancellationToken = default) =>
            Decode<RemoteCommandAccepted>(await SendTextAsync(HttpMethod.Post, $"/api/v1/remote/pairings/{pairingId:D}/commands",
                "{\"kind\":" + Newtonsoft.Json.JsonConvert.ToString(kind) + ",\"payload\":" + payloadJson + "}", cancellationToken).ConfigureAwait(false))!;

        public async Task<RemoteCommandStatus> GetRemoteCommandStatusAsync(Guid commandId, CancellationToken cancellationToken = default) =>
            Decode<RemoteCommandStatus>(await SendTextAsync(HttpMethod.Get, $"/api/v1/remote/commands/{commandId:D}", null, cancellationToken).ConfigureAwait(false))!;

        public async Task<RemoteInbox> PollRemoteInboxAsync(long after, int waitSeconds, CancellationToken cancellationToken = default) =>
            Decode<RemoteInbox>(await SendTextAsync(HttpMethod.Get, $"/api/v1/remote/inbox?after={Math.Max(0, after)}&wait={waitSeconds}", null, cancellationToken).ConfigureAwait(false))!;

        public Task AckRemoteEventAsync(Guid eventId, string status, string? detail, CancellationToken cancellationToken = default) =>
            SendTextAsync(HttpMethod.Post, $"/api/v1/remote/events/{eventId:D}/ack", JsonCoding.Serialize(new { status, detail }), cancellationToken);

        public async Task<UserDataExportJob> StartUserDataExportAsync(CancellationToken cancellationToken = default) =>
            Decode<UserDataExportJob>(await SendTextAsync(HttpMethod.Post, "/api/v1/users/me/data-exports", null, cancellationToken).ConfigureAwait(false))!;

        public async Task<UserDataExportJob> GetUserDataExportAsync(string id, CancellationToken cancellationToken = default) =>
            Decode<UserDataExportJob>(await SendTextAsync(HttpMethod.Get, $"/api/v1/users/me/data-exports/{Uri.EscapeDataString(id)}", null, cancellationToken).ConfigureAwait(false))!;

        public async Task<UserDataTransferLink> CreateUserDataTransferLinkAsync(string exportId, CancellationToken cancellationToken = default) =>
            Decode<UserDataTransferLink>(await SendTextAsync(HttpMethod.Post, $"/api/v1/users/me/data-exports/{Uri.EscapeDataString(exportId)}/transfer-link", null, cancellationToken).ConfigureAwait(false))!;

        public async Task<UserDataImportSession> CreateUserDataImportSessionAsync(CancellationToken cancellationToken = default) =>
            Decode<UserDataImportSession>(await SendTextAsync(HttpMethod.Post, "/api/v1/users/me/data-import-sessions", null, cancellationToken).ConfigureAwait(false))!;

        public async Task<UserDataImportSession> GetUserDataImportSessionAsync(string id, CancellationToken cancellationToken = default) =>
            Decode<UserDataImportSession>(await SendTextAsync(HttpMethod.Get, $"/api/v1/users/me/data-import-sessions/{Uri.EscapeDataString(id)}", null, cancellationToken).ConfigureAwait(false))!;

        public Task DeleteUserDataImportSessionAsync(string id, CancellationToken cancellationToken = default) =>
            SendTextAsync(HttpMethod.Delete, $"/api/v1/users/me/data-import-sessions/{Uri.EscapeDataString(id)}", null, cancellationToken);

        public async Task<UserDataImportPreview> PreviewUserDataImportSessionAsync(string id, bool includePreferences, string progressConflicts, CancellationToken cancellationToken = default) =>
            Decode<UserDataImportPreview>(await SendTextAsync(HttpMethod.Post,
                $"/api/v1/users/me/data-import-sessions/{Uri.EscapeDataString(id)}/preview?{ImportQuery(includePreferences, progressConflicts)}", null, cancellationToken).ConfigureAwait(false))!;

        public async Task<UserDataImportResult> ApplyUserDataImportSessionAsync(string id, string packageSha256, bool includePreferences, string progressConflicts, CancellationToken cancellationToken = default) =>
            Decode<UserDataImportResult>(await SendTextAsync(HttpMethod.Post,
                $"/api/v1/users/me/data-import-sessions/{Uri.EscapeDataString(id)}/apply?{ImportQuery(includePreferences, progressConflicts)}&package_sha256={Uri.EscapeDataString(packageSha256)}", null, cancellationToken).ConfigureAwait(false))!;

        /// <summary>The web's import query: <c>include_preferences</c> only when on, <c>progress_conflicts</c> always.</summary>
        private static string ImportQuery(bool includePreferences, string progressConflicts) =>
            (includePreferences ? "include_preferences=true&" : string.Empty) + "progress_conflicts=" + Uri.EscapeDataString(progressConflicts);

        private static T? Decode<T>(string payload, bool allowNull = false) where T : class
        {
            if (allowNull && (payload.Length == 0 || payload.Trim() == "null"))
            {
                return null;
            }

            try
            {
                return JsonCoding.Deserialize<T>(payload)
                    ?? throw new ApiException(ApiErrorKind.Decoding, $"unreadable {typeof(T).Name} response");
            }
            catch (Newtonsoft.Json.JsonException decoding)
            {
                throw new ApiException(ApiErrorKind.Decoding, $"the server's {typeof(T).Name} response did not match this build", innerException: decoding);
            }
        }

        /// <summary>An authenticated request (one forced token refresh on 401) that returns the response text; empty for 204.</summary>
        private async Task<string> SendTextAsync(HttpMethod method, string path, string? json, CancellationToken cancellationToken)
        {
            try
            {
                return await SendEmptyOnceAsync(method, path, false, cancellationToken, json).ConfigureAwait(false);
            }
            catch (ApiException error) when (error.Kind == ApiErrorKind.Unauthorized && _tokens != null)
            {
                return await SendEmptyOnceAsync(method, path, true, cancellationToken, json).ConfigureAwait(false);
            }
        }

        private async Task SendNoBodyAsync(HttpMethod method, string path, string json, CancellationToken cancellationToken)
        {
            try
            {
                await SendEmptyOnceAsync(method, path, false, cancellationToken, json).ConfigureAwait(false);
            }
            catch (ApiException error) when (error.Kind == ApiErrorKind.Unauthorized && _tokens != null)
            {
                await SendEmptyOnceAsync(method, path, true, cancellationToken, json).ConfigureAwait(false);
            }
        }

        public async Task RemoveFromWatchlistAsync(string titleKey, CancellationToken cancellationToken = default)
        {
            try
            {
                await SendEmptyOnceAsync(HttpMethod.Delete, "/api/v1/watchlist/" + Uri.EscapeDataString(titleKey), false, cancellationToken).ConfigureAwait(false);
            }
            catch (ApiException error) when (error.Kind == ApiErrorKind.Unauthorized && _tokens != null)
            {
                await SendEmptyOnceAsync(HttpMethod.Delete, "/api/v1/watchlist/" + Uri.EscapeDataString(titleKey), true, cancellationToken).ConfigureAwait(false);
            }
        }

        public Task<IList<RequestView>> ListRequestsAsync(CancellationToken cancellationToken = default) =>
            GetAsync<IList<RequestView>>("/api/v1/requests", null, authenticated: true, cancellationToken);

        public Task<IList<PlaylistInfo>> ListPlaylistsAsync(CancellationToken cancellationToken = default) =>
            GetAsync<IList<PlaylistInfo>>("/api/v1/playlists", null, authenticated: true, cancellationToken);

        public Task<IList<PlaylistItem>> ListPlaylistItemsAsync(Guid playlistId, CancellationToken cancellationToken = default) =>
            GetAsync<IList<PlaylistItem>>($"/api/v1/playlists/{playlistId:D}/items", null, authenticated: true, cancellationToken);

        /// <summary>A request whose success carries no body (204), such as removing a watchlist entry.</summary>
        private async Task<string> SendEmptyOnceAsync(HttpMethod method, string path, bool forceRefresh, CancellationToken cancellationToken, string? json = null)
        {
            using var request = new HttpRequestMessage(method, BuildUri(path, null));
            if (json != null)
            {
                request.Content = new StringContent(json, Encoding.UTF8, "application/json");
            }

            request.Headers.TryAddWithoutValidation(ClientPlatformHeader, _configuration.ClientPlatform.WireName());
            request.Headers.TryAddWithoutValidation(ClientVersionHeader, _configuration.ClientVersion);
            if (_tokens != null)
            {
                var token = await _tokens.GetAccessTokenAsync(forceRefresh, cancellationToken).ConfigureAwait(false);
                request.Headers.TryAddWithoutValidation("Authorization", $"Bearer {token}");
            }

            HttpResponseMessage response;
            try
            {
                response = await _http.SendAsync(request, cancellationToken).ConfigureAwait(false);
            }
            catch (Exception transport) when (transport is HttpRequestException or OperationCanceledException
                                              && !cancellationToken.IsCancellationRequested)
            {
                throw new ApiException(ApiErrorKind.Transport, "the request could not be sent", innerException: transport);
            }

            using (response)
            {
                if (!response.IsSuccessStatusCode)
                {
                    var payload = await response.Content.ReadAsStringAsync().ConfigureAwait(false);
                    throw ApiException.ForStatus(response.StatusCode, JsonCoding.Deserialize<ApiErrorBody>(payload));
                }

                return await response.Content.ReadAsStringAsync().ConfigureAwait(false);
            }
        }

        public Task<WatchProgress> UpdateWatchProgressAsync(
            Guid mediaFileId,
            UpdateWatchProgressRequest body,
            CancellationToken cancellationToken = default) =>
            SendAsync<WatchProgress>(
                HttpMethod.Put,
                $"/api/v1/playback/{mediaFileId:D}/progress",
                JsonCoding.Serialize(body),
                cancellationToken);

        public Task<PlaybackInfoResponse> GetPlaybackInfoAsync(
            Guid mediaFileId,
            XboxPlaybackProfile profile,
            CancellationToken cancellationToken = default,
            DeviceCaps? caps = null)
        {
            var query = new Dictionary<string, string>();
            foreach (var pair in caps == null ? profile.ToQueryParameters() : profile.ToQueryParameters(caps))
            {
                query[pair.Key] = pair.Value;
            }

            return GetAsync<PlaybackInfoResponse>(
                $"/api/v1/playback/{mediaFileId:D}", query, authenticated: true, cancellationToken);
        }

        public async Task<IDictionary<string, string>> GetPlaybackRequestHeadersAsync(
            CancellationToken cancellationToken = default)
        {
            if (_tokens is null)
            {
                return new Dictionary<string, string>();
            }

            var token = await _tokens.GetAccessTokenAsync(false, cancellationToken).ConfigureAwait(false);
            return new Dictionary<string, string> { ["Authorization"] = $"Bearer {token}" };
        }

        public Uri? ResolveUrl(string path) =>
            Uri.TryCreate(_configuration.BaseUrl, path, out var resolved) ? resolved : null;

        private static string WireNameFor(WorkKind kind) => kind switch
        {
            WorkKind.Movie => "movie",
            WorkKind.Series => "series",
            WorkKind.Site => "site",
            WorkKind.Artist => "artist",
            WorkKind.Author => "author",
            _ => throw new ArgumentOutOfRangeException(nameof(kind), kind, "not a filterable catalog kind"),
        };

        private async Task<T> GetAsync<T>(
            string path,
            IDictionary<string, string>? query,
            bool authenticated,
            CancellationToken cancellationToken)
            where T : class
        {
            try
            {
                return await SendOnceAsync<T>(
                    HttpMethod.Get, path, query, null, authenticated, false, cancellationToken)
                    .ConfigureAwait(false);
            }
            catch (ApiException error) when (
                error.Kind == ApiErrorKind.Unauthorized && authenticated && _tokens != null)
            {
                // One forced refresh, then one retry. A second 401 is a real
                // authorization failure, not a stale token.
                return await SendOnceAsync<T>(
                    HttpMethod.Get, path, query, null, true, true, cancellationToken)
                    .ConfigureAwait(false);
            }
        }

        private async Task<T> SendAsync<T>(
            HttpMethod method,
            string path,
            string? body,
            CancellationToken cancellationToken)
            where T : class
        {
            try
            {
                return await SendOnceAsync<T>(method, path, null, body, true, false, cancellationToken)
                    .ConfigureAwait(false);
            }
            catch (ApiException error) when (error.Kind == ApiErrorKind.Unauthorized && _tokens != null)
            {
                return await SendOnceAsync<T>(method, path, null, body, true, true, cancellationToken)
                    .ConfigureAwait(false);
            }
        }

        private async Task<T> SendOnceAsync<T>(
            HttpMethod method,
            string path,
            IDictionary<string, string>? query,
            string? body,
            bool authenticated,
            bool forceRefresh,
            CancellationToken cancellationToken)
            where T : class
        {
            using var request = new HttpRequestMessage(method, BuildUri(path, query));
            request.Headers.TryAddWithoutValidation("Accept", "application/json");
            request.Headers.TryAddWithoutValidation(
                ClientPlatformHeader, _configuration.ClientPlatform.WireName());
            request.Headers.TryAddWithoutValidation(ClientVersionHeader, _configuration.ClientVersion);

            if (body != null)
            {
                request.Content = new StringContent(body, Encoding.UTF8, "application/json");
            }

            if (authenticated && _tokens != null)
            {
                var token = await _tokens
                    .GetAccessTokenAsync(forceRefresh, cancellationToken)
                    .ConfigureAwait(false);
                request.Headers.TryAddWithoutValidation("Authorization", $"Bearer {token}");
            }

            HttpResponseMessage response;
            try
            {
                response = await _http.SendAsync(request, cancellationToken).ConfigureAwait(false);
            }
            catch (Exception transport) when (transport is HttpRequestException or OperationCanceledException
                                              && !cancellationToken.IsCancellationRequested)
            {
                throw new ApiException(
                    ApiErrorKind.Transport, "the request could not be sent", innerException: transport);
            }

            using (response)
            {
                var payload = await response.Content.ReadAsStringAsync().ConfigureAwait(false);

                if (!response.IsSuccessStatusCode)
                {
                    throw ApiException.ForStatus(
                        response.StatusCode, JsonCoding.Deserialize<ApiErrorBody>(payload));
                }

                try
                {
                    return JsonCoding.Deserialize<T>(payload)
                        ?? throw new ApiException(
                            ApiErrorKind.Decoding, $"unreadable {typeof(T).Name} response");
                }
                catch (Newtonsoft.Json.JsonException decoding)
                {
                    throw new ApiException(
                        ApiErrorKind.Decoding,
                        $"the server's {typeof(T).Name} response did not match this build",
                        response.StatusCode,
                        innerException: decoding);
                }
            }
        }

        /// <summary>
        /// Appends to the base URL's path rather than replacing it, so an
        /// operator serving Playarr behind a reverse-proxy prefix keeps
        /// working.
        /// </summary>
        private Uri BuildUri(string path, IDictionary<string, string>? query)
        {
            var builder = new UriBuilder(_configuration.BaseUrl);
            // A path may carry its own ready-escaped query ("...?after=0&wait=25").
            var queryAt = path.IndexOf('?');
            var ownQuery = queryAt < 0 ? string.Empty : path.Substring(queryAt + 1);
            if (queryAt >= 0)
            {
                path = path.Substring(0, queryAt);
            }

            builder.Path = builder.Path.TrimEnd('/') + path;
            builder.Query = ownQuery;

            if (query is { Count: > 0 })
            {
                var parts = new List<string>();
                foreach (var pair in query)
                {
                    parts.Add($"{Uri.EscapeDataString(pair.Key)}={Uri.EscapeDataString(pair.Value)}");
                }

                builder.Query = string.Join("&", parts);
            }

            return builder.Uri;
        }
    }
}
