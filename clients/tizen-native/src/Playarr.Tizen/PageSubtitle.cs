using Playarr.Tizen.Logic;
using Tizen.NUI;
using Tizen.NUI.BaseComponents;

namespace Playarr.Tizen;

/// <summary>Web page header: the title with a 1 px divider and the subtitle beside it (not below, not brand-coloured); the clock follows the subtitle.</summary>
internal sealed class PageSubtitle
{
    private const float TitleX = 226.6f, TitleSize = 33.6f, TitleSpacing = -1.51f, DividerGap = 23f, TextGap = 24f, ClockGap = 25f, MaxTextWidth = 640f, WrappedRuleY = 112f, WrappedTextY = 116f, WrappedClockGap = 16f, ClockLeft = 476.1f, FitMargin = 16f;
    private readonly AppEnv _env;
    private readonly View _parent;
    private readonly PlayarrTheme _t;
    private float _dividerX;
    private readonly View _divider;
    private TextLabel? _label;

    public PageSubtitle(AppEnv env, View parent, string title)
    {
        _env = env; _parent = parent; _t = env.Theme;
        _dividerX = TitleX + Ui.TextWidth(title, TitleSize, 600, TitleSpacing) + DividerGap;
        _divider = Ui.Box(0, 72f, 1, 18, new Rgba(_t.Ink.R, _t.Ink.G, _t.Ink.B, 0.22f));
        _divider.Show(false);
        parent.Add(_divider);
    }

    /// <summary>
    /// <paramref name="wrapped"/> is the web's wrapped header (page-layout.css .is-detail-wrapped): the detail sits under the title and the
    /// divider is a horizontal rule exactly as wide as the wider of the two.
    /// </summary>
    public void Set(string text, string? title = null, bool wrapped = false, bool wrapIfClockBlocks = false)
    {
        if (title is not null) _dividerX = TitleX + Ui.TextWidth(title, TitleSize, 600, TitleSpacing) + DividerGap;
        _label?.Dispose(); _label = null;
        _divider.Show(text.Length > 0);
        if (text.Length == 0) { _env.SetClockX(0); return; }
        // web PageHeader detailFitsInline: on a detail page the detail wraps under the title when it would end within 16 px of the clock's resting place
        if (wrapIfClockBlocks && _dividerX + 1 + TextGap + Math.Min(MaxTextWidth, Ui.TextWidth(text.ToUpperInvariant(), 11.136f, 700, 0.5f)) + FitMargin > ClockLeft) wrapped = true;
        if (wrapped)
        {
            var titleWidth = _dividerX - DividerGap - TitleX;
            var textWidth = Math.Min(MaxTextWidth, Ui.TextWidth(text.ToUpperInvariant(), 11.136f, 700, 0.5f));
            var blockWidth = Math.Max(titleWidth, textWidth);
            _divider.PositionX = TitleX; _divider.PositionY = WrappedRuleY; _divider.Size = new Size(blockWidth, 1);
            _label = Ui.Text(text, TitleX, WrappedTextY, 11.136f, 700, _t.Ink, MaxTextWidth, 18, upper: true, spacing: 0.5f);
            _parent.Add(_label);
            _env.SetClockX(TitleX + blockWidth + WrappedClockGap);
            return;
        }
        _divider.PositionX = _dividerX; _divider.PositionY = 72f; _divider.Size = new Size(1, 18);
        var x = _dividerX + 1 + TextGap;
        _label = Ui.Text(text, x, 71f, 11.136f, 700, _t.Ink, MaxTextWidth, 18, upper: true, spacing: 0.5f);
        _parent.Add(_label);
        _env.SetClockX(x + Math.Min(MaxTextWidth, Ui.TextWidth(text.ToUpperInvariant(), 11.136f, 700, 0.5f)) + ClockGap);
    }
}
