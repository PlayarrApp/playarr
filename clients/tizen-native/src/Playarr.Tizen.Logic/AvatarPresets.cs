namespace Playarr.Tizen.Logic;

/// <summary>Port of web lib/profileAvatar.ts: the six preset avatars and the default pick from a hash of the user id.</summary>
public static class AvatarPresets
{
    public static readonly IReadOnlyList<string> Ids = new[] { "astronaut", "cat", "dinosaur", "robot", "pirate", "alien" };

    public static string Default(string userId)
    {
        uint hash = 0;
        foreach (var c in userId) hash = unchecked(hash * 31 + c);
        return Ids[(int)(hash % (uint)Ids.Count)];
    }
}
