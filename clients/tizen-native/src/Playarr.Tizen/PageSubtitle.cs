using Playarr.Tizen.Logic;
using Tizen.NUI;
using Tizen.NUI.BaseComponents;

namespace Playarr.Tizen;

/// <summary>Web page header: the title with a 1 px divider and the subtitle beside it (not below, not brand-coloured); the clock follows the subtitle.</summary>
internal sealed class PageSubtitle
{
    private const float TitleX = 226.6f, TitleSize = 33.6f, TitleSpacing = -1.51f, DividerGap = 23f, TextGap = 24f, ClockGap = 27f, MaxTextWidth = 640f;
    private readonly AppEnv _env;
    private readonly View _parent;
    private readonly PlayarrTheme _t;
    private float _dividerX;
    private readonly View _divider;
    private TextLabel? _label;

    public PageSubtitle(AppEnv env, View parent, string title)
    {
        _env = env; _parent = parent; _t = env.Theme;
        _dividerX = TitleX + Ui.TextWidth(title, TitleSize, 700, TitleSpacing) + DividerGap;
        _divider = Ui.Box(0, 72f, 1, 18, new Rgba(_t.Ink.R, _t.Ink.G, _t.Ink.B, 0.22f));
        _divider.Show(false);
        parent.Add(_divider);
    }

    public void Set(string text, string? title = null)
    {
        if (title is not null) _dividerX = TitleX + Ui.TextWidth(title, TitleSize, 700, TitleSpacing) + DividerGap;
        _divider.PositionX = _dividerX;
        _label?.Dispose(); _label = null;
        _divider.Show(text.Length > 0);
        if (text.Length == 0) { _env.SetClockX(0); return; }
        var x = _dividerX + 1 + TextGap;
        _label = Ui.Text(text, x, 72f, 10.56f, 700, _t.InkSoft, MaxTextWidth, 18, upper: true, spacing: 0.85f);
        _parent.Add(_label);
        _env.SetClockX(x + Math.Min(MaxTextWidth, Ui.TextWidth(text.ToUpperInvariant(), 10.56f, 700, 0.85f)) + ClockGap);
    }
}
