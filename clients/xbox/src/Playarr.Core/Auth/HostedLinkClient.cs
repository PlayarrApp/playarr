using System;
using System.Collections.Generic;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json;
using Playarr.Core.Models;
using Playarr.Core.Networking;

namespace Playarr.Core.Auth
{
    /// <summary>The server the phone picked, delivered to the device once the viewer approves the link.</summary>
    public sealed class HostedLinkClaim
    {
        [JsonProperty("server_url")] public string ServerUrl { get; set; } = string.Empty;

        [JsonProperty("server_device_code")] public string ServerDeviceCode { get; set; } = string.Empty;

        [JsonProperty("server_urls")] public List<string> ServerUrls { get; set; } = new List<string>();
    }

    public enum HostedLinkStatus
    {
        Pending,
        Approved,
        Expired,
        Failed,
    }

    public sealed class HostedLinkPoll
    {
        public HostedLinkStatus Status { get; set; }

        public HostedLinkClaim? Claim { get; set; }
    }

    /// <summary>
    /// First contact through the hosted link service (<c>/api/link/code</c>): the device shows a QR for a code,
    /// the viewer's phone approves it against whichever server they choose, and the claim delivers that server's
    /// address and device code. No server address is ever typed on the device. Mirrors the web's
    /// <c>hostedDeviceLink.ts</c> and Android's <c>HostedDeviceLinkClient</c>.
    /// </summary>
    public sealed class HostedLinkClient
    {
        public const string DefaultOrigin = "https://playarr.app";

        private readonly HttpClient _http;
        private readonly string _origin;

        public HostedLinkClient(HttpClient? httpClient = null, string origin = DefaultOrigin)
        {
            _http = httpClient ?? new HttpClient();
            _origin = origin.TrimEnd('/');
        }

        public async Task<DeviceCodeResponse> RequestCodeAsync(ClientPlatform platform, CancellationToken cancellationToken = default)
        {
            var body = JsonCoding.Serialize(new DeviceCodeRequest { ClientPlatform = platform });
            using var request = new HttpRequestMessage(HttpMethod.Post, _origin + "/api/link/code")
            {
                Content = new StringContent(body, Encoding.UTF8, "application/json"),
            };
            using var response = await _http.SendAsync(request, cancellationToken).ConfigureAwait(false);
            var payload = await response.Content.ReadAsStringAsync().ConfigureAwait(false);
            if (!response.IsSuccessStatusCode)
            {
                throw new HttpRequestException($"link code request failed with HTTP {(int)response.StatusCode}");
            }

            return JsonCoding.Deserialize<DeviceCodeResponse>(payload)
                ?? throw new HttpRequestException("the link service returned an unreadable code");
        }

        /// <summary>One poll: 202 pending, 200 approved with the claim, 404 expired, anything else a transient failure.</summary>
        public async Task<HostedLinkPoll> PollAsync(string deviceCode, CancellationToken cancellationToken = default)
        {
            try
            {
                using var response = await _http
                    .GetAsync(_origin + "/api/link/code/" + Uri.EscapeDataString(deviceCode), cancellationToken)
                    .ConfigureAwait(false);
                switch ((int)response.StatusCode)
                {
                    case 200:
                        var claim = JsonCoding.Deserialize<HostedLinkClaim>(
                            await response.Content.ReadAsStringAsync().ConfigureAwait(false));
                        return claim != null && claim.ServerUrl.Length > 0 && claim.ServerDeviceCode.Length > 0
                            ? new HostedLinkPoll { Status = HostedLinkStatus.Approved, Claim = claim }
                            : new HostedLinkPoll { Status = HostedLinkStatus.Failed };
                    case 202:
                        return new HostedLinkPoll { Status = HostedLinkStatus.Pending };
                    case 404:
                        return new HostedLinkPoll { Status = HostedLinkStatus.Expired };
                    default:
                        return new HostedLinkPoll { Status = HostedLinkStatus.Failed };
                }
            }
            catch (Exception error) when (error is HttpRequestException || (error is OperationCanceledException && !cancellationToken.IsCancellationRequested))
            {
                return new HostedLinkPoll { Status = HostedLinkStatus.Failed };
            }
        }
    }
}
