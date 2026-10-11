namespace Playarr.Tizen.Logic;

/// <summary>The library's A-Z rail: '#' for titles that do not start with a letter.</summary>
public static class Alphabet
{
    public static readonly IReadOnlyList<char> Letters = new[] { '#' }.Concat(Enumerable.Range('A', 26).Select(c => (char)c)).ToArray();

    public static char LetterOf(string? sortTitle)
    {
        var t = sortTitle?.TrimStart() ?? "";
        if (t.Length == 0) return '#';
        var c = char.ToUpperInvariant(t[0]);
        return c is >= 'A' and <= 'Z' ? c : '#';
    }

    /// <summary>Index of the first title with this letter, or -1.</summary>
    public static int FirstIndexOf(IReadOnlyList<string> sortedTitles, char letter)
    {
        for (var i = 0; i < sortedTitles.Count; i++) if (LetterOf(sortedTitles[i]) == letter) return i;
        return -1;
    }
}
