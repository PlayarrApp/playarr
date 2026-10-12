using Playarr.Tizen.Logic;
using Tizen.NUI.BaseComponents;

namespace Playarr.Tizen;

/// <summary>A routed screen inside the shell.</summary>
internal interface IPage
{
    View Root { get; }
    /// <summary>Route in web terms ("/", "/movies", ...), used by the debug mirror and the parity driver.</summary>
    string Route { get; }
    /// <summary>Accessible label of the focused item (the same text the web exposes), or null.</summary>
    string? FocusedLabel { get; }
    /// <summary>Home only: where focus sits as (rail number, card number in it); the parity suite compares this rather than the label.</summary>
    (int Rail, int Index)? FocusPosition => null;
    /// <summary>Handles a remote key; false when focus would leave the page to the left (the shell then focuses the nav).</summary>
    bool OnKey(RemoteKey key);
    /// <summary>True for pages that own the whole screen (the player): the shell hides its rail and background.</summary>
    /// <summary>False while the page is still loading its first content; the shell holds remote keys until it is ready.</summary>
    bool IsReady => true;
    bool Fullscreen => false;
    /// <summary>True for pages drawn without the nav rail (profile picker), as web.</summary>
    bool HideChrome => Fullscreen;
    /// <summary>Screen y of the focused item's centre; the nav rail is entered at the item closest to it.</summary>
    float FocusCentreY { get; }
    /// <summary>Opaque focus state kept while another page is on top, handed back when this route is reopened with Back.</summary>
    object? SaveState() => null;
    void RestoreState(object state) { }
}
