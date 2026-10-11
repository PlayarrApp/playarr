using System;
using System.Threading;
using System.Threading.Tasks;
using Windows.Security.Credentials;
using Playarr.Core.Auth;
using Playarr.Core.Models;
using Playarr.Core.Networking;

namespace Playarr.Xbox.Services
{
    /// <summary>
    /// The real Windows <see cref="ITokenStore"/>, backed by
    /// <see cref="PasswordVault"/>. Playarr.Core only ships
    /// <c>InMemoryTokenStore</c> (see <c>Auth/ITokenStore.cs</c>'s remarks
    /// on why: that assembly can't reference <c>Windows.Security.Credentials</c>
    /// and needs an in-memory substitute for its own tests) -- this is the
    /// application head's real implementation.
    /// </summary>
    /// <remarks>
    /// One console, one signed-in account at a time, so there is one
    /// stored <see cref="StoredAuthSession"/> under the one resource,
    /// not keyed per server or per profile. Each write adds a new entry
    /// and then removes the older ones (see <c>UserNamePrefix</c>).
    /// </remarks>
    public sealed class PasswordVaultTokenStore : ITokenStore
    {
        private const string ResourceName = "Playarr";

        // Entries are named "session.<ticks>.<guid>" (the older single "session" entry counts as ticks 0). A new session is added first and
        // the older entries are removed afterwards, so a crash between the two steps leaves the old and the new pair and never none;
        // reading takes the newest.
        private const string UserNamePrefix = "session";

        public Task<StoredAuthSession?> GetSessionAsync(CancellationToken cancellationToken = default)
        {
            var vault = new PasswordVault();
            PasswordCredential? newest = null;
            long newestTicks = -1;
            foreach (var credential in Entries(vault))
            {
                var ticks = TicksOf(credential.UserName);
                if (ticks > newestTicks)
                {
                    newest = credential;
                    newestTicks = ticks;
                }
            }

            if (newest is null)
            {
                // "Never paired yet" / "signed out" is the common case, not an error.
                return Task.FromResult<StoredAuthSession?>(null);
            }

            newest.RetrievePassword();
            var session = JsonCoding.Deserialize<StoredAuthSession>(newest.Password);
            return Task.FromResult(session);
        }

        public Task StoreSessionAsync(StoredAuthSession session, CancellationToken cancellationToken = default)
        {
            if (session is null)
            {
                throw new ArgumentNullException(nameof(session));
            }

            var vault = new PasswordVault();
            var older = Entries(vault);
            var userName = UserNamePrefix + "." + DateTime.UtcNow.Ticks + "." + Guid.NewGuid().ToString("N");
            vault.Add(new PasswordCredential(ResourceName, userName, JsonCoding.Serialize(session)));

            // `older` was listed before the add, so the entry just written is never removed
            foreach (var credential in older)
            {
                Remove(vault, credential);
            }

            return Task.CompletedTask;
        }

        public Task ClearSessionAsync(CancellationToken cancellationToken = default)
        {
            var vault = new PasswordVault();
            foreach (var credential in Entries(vault))
            {
                Remove(vault, credential);
            }

            return Task.CompletedTask;
        }

        private static System.Collections.Generic.List<PasswordCredential> Entries(PasswordVault vault)
        {
            var found = new System.Collections.Generic.List<PasswordCredential>();
            try
            {
                foreach (var credential in vault.FindAllByResource(ResourceName))
                {
                    if (credential.UserName.StartsWith(UserNamePrefix, StringComparison.Ordinal))
                    {
                        found.Add(credential);
                    }
                }
            }
            catch (Exception)
            {
                // FindAllByResource throws (ERROR_NOT_FOUND) when nothing is stored for the resource.
            }

            return found;
        }

        private static long TicksOf(string userName)
        {
            var parts = userName.Split('.');
            return parts.Length > 1 && long.TryParse(parts[1], out var ticks) ? ticks : 0;
        }

        private static void Remove(PasswordVault vault, PasswordCredential credential)
        {
            try
            {
                vault.Remove(credential);
            }
            catch (Exception)
            {
                // Already gone -- fine.
            }
        }
    }
}
