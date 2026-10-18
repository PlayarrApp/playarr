namespace Playarr.Tizen.Logic;

/// <summary>What the app does with a remote press, independent of the Tizen key name.</summary>
public enum RemoteKey { None, Up, Down, Left, Right, Select, SelectLong, Back, PlayPause, Play, Pause, Stop, FastForward, Rewind }

public enum TextFieldEditingContext { None, SearchQuery, PlaylistName }

public enum TextFieldKeyAction { PassThrough, Remote, SearchEnter, Submit }

public readonly record struct TextFieldKeyRoute(TextFieldKeyAction Action, RemoteKey? RemoteKey = null);

/// <summary>Tracks consumed key-downs so their releases stay consumed even when handling changed focus.</summary>
public sealed class ConsumedKeyReleaseTracker
{
    private readonly Dictionary<string, bool> _pending = new(StringComparer.Ordinal);

    public void Mark(string name, bool finishSelect) => _pending[name] = finishSelect;
    public bool TryConsume(string name, out bool finishSelect) => _pending.Remove(name, out finishSelect);
    public void Clear() => _pending.Clear();
}

public static class RemoteKeys
{
    /// <summary>Routes editing keys before NUI dispatches them to a TextField.</summary>
    public static TextFieldKeyRoute ForEditingTextField(string? name, TextFieldEditingContext context)
    {
        if (context == TextFieldEditingContext.None) return new(TextFieldKeyAction.PassThrough);
        if (name is "Return" or "KP_Enter")
            return new(context == TextFieldEditingContext.PlaylistName ? TextFieldKeyAction.Submit : TextFieldKeyAction.SearchEnter);

        var remote = name switch
        {
            "Up" => RemoteKey.Up,
            "Down" => RemoteKey.Down,
            "XF86Select" => RemoteKey.Select,
            "Escape" or "XF86Back" or "XF86Exit" => RemoteKey.Back,
            _ => (RemoteKey?)null,
        };
        return remote is { } key
            ? new(TextFieldKeyAction.Remote, key)
            : new(TextFieldKeyAction.PassThrough);
    }

    /// <summary>Maps a NUI <c>Key.KeyPressedName</c> (TV remote or the emulator's keyboard) to a <see cref="RemoteKey"/>.</summary>
    public static RemoteKey FromName(string? name) => name switch
    {
        "Up" => RemoteKey.Up,
        "Down" => RemoteKey.Down,
        "Left" => RemoteKey.Left,
        "Right" => RemoteKey.Right,
        "Return" or "KP_Enter" or "XF86Select" => RemoteKey.Select,
        // Same set as web's isBackKey for Tizen: Escape, Backspace, XF86Back (10009), XF86Exit.
        "Escape" or "BackSpace" or "XF86Back" or "XF86Exit" => RemoteKey.Back,
        "XF86AudioPlay" => RemoteKey.Play,
        "XF86AudioPause" => RemoteKey.Pause,
        "XF86AudioStop" => RemoteKey.Stop,
        "XF86AudioNext" or "XF86AudioForward" => RemoteKey.FastForward,
        "XF86AudioPrev" or "XF86AudioRewind" => RemoteKey.Rewind,
        "space" => RemoteKey.PlayPause,
        _ => RemoteKey.None,
    };
}
