namespace Playarr.Tizen.Logic;

/// <summary>Web languageDisplayName: the facet's own name, else the English name of the ISO code, else the code in capitals.</summary>
public static class LanguageNames
{
    private static readonly Dictionary<string, string> Known = new(StringComparer.OrdinalIgnoreCase)
    {
        ["ar"] = "Arabic", ["bg"] = "Bulgarian", ["bn"] = "Bengali", ["ca"] = "Catalan", ["cs"] = "Czech", ["da"] = "Danish", ["de"] = "German",
        ["el"] = "Greek", ["en"] = "English", ["es"] = "Spanish", ["et"] = "Estonian", ["fa"] = "Persian", ["fi"] = "Finnish", ["fr"] = "French",
        ["he"] = "Hebrew", ["hi"] = "Hindi", ["hr"] = "Croatian", ["hu"] = "Hungarian", ["id"] = "Indonesian", ["is"] = "Icelandic", ["it"] = "Italian",
        ["ja"] = "Japanese", ["jav"] = "Javanese", ["ko"] = "Korean", ["lt"] = "Lithuanian", ["lv"] = "Latvian", ["ms"] = "Malay", ["nl"] = "Dutch",
        ["no"] = "Norwegian", ["pl"] = "Polish", ["pt"] = "Portuguese", ["ro"] = "Romanian", ["ru"] = "Russian", ["sk"] = "Slovak", ["sl"] = "Slovenian",
        ["sr"] = "Serbian", ["sv"] = "Swedish", ["ta"] = "Tamil", ["te"] = "Telugu", ["th"] = "Thai", ["tl"] = "Tagalog", ["tr"] = "Turkish",
        ["uk"] = "Ukrainian", ["ur"] = "Urdu", ["vi"] = "Vietnamese", ["zh"] = "Chinese", ["zho"] = "Chinese", ["eng"] = "English", ["fra"] = "French",
        ["deu"] = "German", ["spa"] = "Spanish", ["ita"] = "Italian", ["jpn"] = "Japanese", ["kor"] = "Korean", ["por"] = "Portuguese", ["rus"] = "Russian",
    };

    public static string Display(string code, string? name) =>
        !string.IsNullOrWhiteSpace(name) ? name! : Known.TryGetValue(code, out var n) ? n : code.ToUpperInvariant();
}
