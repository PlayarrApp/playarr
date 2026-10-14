using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using Newtonsoft.Json;
using Playarr.Core.Models;

namespace Playarr.Core.Account
{
    /// <summary>The friend-invite link, byte for byte what the web builds (<c>buildInviteUrl</c> in packages/domain).</summary>
    public static class InviteLink
    {
        private const string SignupUrl = "https://playarr.app/signup";

        public static string Build(IEnumerable<PeerAddressEntry> addresses, string inviteToken)
        {
            var json = JsonConvert.SerializeObject(addresses.Select(a => new { peer_node_id = a.PeerNodeId, url = a.Url }), Formatting.None);
            var servers = Convert.ToBase64String(Encoding.UTF8.GetBytes(json)).Replace('+', '-').Replace('/', '_').TrimEnd('=');
            return SignupUrl + "?servers=" + servers + "&invite=" + Uri.EscapeDataString(inviteToken);
        }

        /// <summary>
        /// The web's fallback when the address bundle is admin-only (403) or empty: this client's own address as the single entry,
        /// so the link still goes through the one <c>servers=</c> code path. The web sends an empty peer id here; only the url is ever read.
        /// </summary>
        public static IList<PeerAddressEntry> Fallback(string serverUrl) =>
            new List<PeerAddressEntry> { new PeerAddressEntry { PeerNodeId = Guid.Empty, Url = serverUrl } };
    }
}
