using Playarr.Tizen.Logic;
using Tizen.NUI;
using Tizen.NUI.BaseComponents;

namespace Playarr.Tizen;

/// <summary>The Cast rail of a detail page (web .tv-cast-track): round headshots with initials as the fallback. Measured at 1920x1080.</summary>
internal sealed class PeopleRail
{
    private const float RailX = 881.6f, Pitch = 176.9f, Circle = 103.7f;
    public View Row { get; } = new();
    public float Scroll { get; private set; }
    public float HeadingY { get; }
    public int Count { get; }

    public PeopleRail(AppEnv env, View stack, IReadOnlyList<CastMember> cast, float headingY, FocusSet focus, Func<float> stackY, Action<PeopleRail>? focused = null)
    {
        var t = env.Theme; HeadingY = headingY; Count = cast.Count;
        stack.Add(Ui.Text("Cast", RailX, headingY, 17.664f, 700, t.Ink, 400, 26.496f, spacing: -0.53f));
        stack.Add(Ui.Text(cast.Count == 1 ? "1 person" : $"{cast.Count} people", RailX, headingY + 30.5f, 9.984f, 400, t.InkMuted, 400, 14.976f));
        Row.PositionY = headingY + 80.7f; Row.Size = new Size(9000, 200);
        stack.Add(Row);
        for (var i = 0; i < cast.Count; i++)
        {
            var c = cast[i]; var idx = i; var x = RailX + i * Pitch;
            var box = new View { PositionX = x, Size = new Size(152.8f, 190) };
            var disc = Ui.Box(24.2f, 0, Circle, Circle, t.SurfaceSoft, Circle / 2);
            disc.ClippingMode = ClippingModeType.ClipChildren;
            disc.Add(Ui.Text(c.Initials, 0, 31, 28, 600, t.InkSoft, Circle, 42, HorizontalAlignment.Center));
            if (c.HasHeadshot) env.Images.Apply(disc, $"/api/v1/artwork/person/{c.PersonId}?w=240", Circle, Circle);
            box.Add(disc);
            var name = Ui.Text(c.Name, 0, Circle + 17, 11.52f, 700, t.Ink, 152.8f, 17.28f, HorizontalAlignment.Center, spacing: -0.17f);
            box.Add(name);
            if (c.Subtitle is { } sub) box.Add(Ui.Text(sub, 0, Circle + 37, 8.832f, 400, t.InkMuted, 152.8f, 13.248f, HorizontalAlignment.Center));
            Row.Add(box);
            focus.Items.Add(new Focusable
            {
                Rect = () => new Box(x + 24.2f - Scroll, headingY + 80.7f + stackY(), Circle, Circle),
                Label = (c.Name + (c.Subtitle is null ? "" : ", " + c.Subtitle)).ToLowerInvariant(),
                Style = f => { disc.Scale = f ? new Vector3(1.04f, 1.04f, 1) : new Vector3(1, 1, 1); disc.PositionY = f ? -6 : 0; },
                Focused = () => { Reveal(idx); focused?.Invoke(this); },
            });
        }
    }

    private void Reveal(int index)
    {
        var visible = TizenClient.DesignWidth - RailX;
        var right = (index + 1) * Pitch - 25f;
        if (right - Scroll > visible) Scroll = right - visible;
        if (index * Pitch < Scroll) Scroll = index * Pitch;
        Row.PositionX = -Scroll;
    }
}
