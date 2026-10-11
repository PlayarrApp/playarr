using Newtonsoft.Json.Linq;

namespace Playarr.Tizen.Logic;

public sealed record CastMember(string Id, string PersonId, string Name, string? Subtitle, bool HasHeadshot)
{
    /// <summary>Web personInitials: the first letters of up to two words.</summary>
    public string Initials => Initials_(Name);

    public static string Initials_(string name)
    {
        var words = name.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries);
        return words.Length == 0 ? "?" : string.Concat(words.Take(2).Select(w => char.ToUpperInvariant(w[0])));
    }
}

public static class Credits
{
    /// <summary>GET /api/v1/catalog/{id}/credits: the cast list with character, job or department as the caption (as web).</summary>
    public static IReadOnlyList<CastMember> ParseCast(string json)
    {
        var cast = JObject.Parse(json)["cast"] as JArray;
        if (cast is null) return Array.Empty<CastMember>();
        return cast.Select(c =>
        {
            string? Pick(params string[] keys) => keys.Select(k => c[k]?.ToString()?.Trim()).FirstOrDefault(v => !string.IsNullOrEmpty(v));
            var person = c["person"];
            return new CastMember(c["id"]?.ToString() ?? "", person?["id"]?.ToString() ?? "", person?["name"]?.ToString() ?? "", Pick("character", "job", "department"),
                !string.IsNullOrEmpty(person?["headshot_url"]?.ToString()));
        }).ToList();
    }
}
