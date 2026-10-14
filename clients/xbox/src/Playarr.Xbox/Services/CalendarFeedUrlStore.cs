using System;
using System.Collections.Generic;
using System.Security.Cryptography;
using System.Text;
using Windows.Security.Credentials;

namespace Playarr.Xbox.Services
{
    /// <summary>Keeps the private calendar URL in PasswordVault, separated by server and signed-in profile.</summary>
    internal static class CalendarFeedUrlStore
    {
        private const string Resource = "Playarr.CalendarFeed";

        public static string? Load(Uri server, Guid? profileId)
        {
            if (profileId is null) return null;
            var prefix = ScopePrefix(server, profileId.Value) + ".";
            var vault = new PasswordVault();
            var matches = Credentials(vault)
                .FindAll(credential => credential.UserName.StartsWith(prefix, StringComparison.Ordinal));
            matches.Sort((left, right) => Ticks(right.UserName).CompareTo(Ticks(left.UserName)));
            foreach (var credential in matches)
            {
                try
                {
                    credential.RetrievePassword();
                    if (!string.IsNullOrWhiteSpace(credential.Password)) return credential.Password;
                }
                catch (Exception)
                {
                    // If a newer write was interrupted, an older scoped value may still be usable.
                }
            }

            return null;
        }

        public static void Save(Uri server, Guid? profileId, string url)
        {
            if (profileId is null || string.IsNullOrWhiteSpace(url)) return;
            var prefix = ScopePrefix(server, profileId.Value) + ".";
            var vault = new PasswordVault();
            var previous = Credentials(vault)
                .FindAll(credential => credential.UserName.StartsWith(prefix, StringComparison.Ordinal));
            var username = prefix + DateTime.UtcNow.Ticks.ToString(System.Globalization.CultureInfo.InvariantCulture) + "." + Guid.NewGuid().ToString("N");
            vault.Add(new PasswordCredential(Resource, username, url));
            foreach (var credential in previous)
            {
                try { vault.Remove(credential); } catch (Exception) { }
            }
        }

        private static List<PasswordCredential> Credentials(PasswordVault vault)
        {
            try
            {
                return new List<PasswordCredential>(vault.FindAllByResource(Resource));
            }
            catch (Exception)
            {
                return new List<PasswordCredential>();
            }
        }

        private static string ScopePrefix(Uri server, Guid profileId)
        {
            var scope = server.ToString().TrimEnd('/') + "|" + profileId.ToString("D");
            using (var sha = SHA256.Create())
            {
                var digest = sha.ComputeHash(Encoding.UTF8.GetBytes(scope));
                var text = new StringBuilder(digest.Length * 2);
                foreach (var value in digest) text.Append(value.ToString("x2"));
                return "link." + text;
            }
        }

        private static long Ticks(string username)
        {
            var parts = username.Split('.');
            return parts.Length > 2 && long.TryParse(parts[2], out var ticks) ? ticks : 0;
        }
    }
}
