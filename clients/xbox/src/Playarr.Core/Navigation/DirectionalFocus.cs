using System;

namespace Playarr.Core.Navigation
{
    /// <summary>A screen-space rectangle used for directional focus selection.</summary>
    public readonly struct FocusRect
    {
        public FocusRect(double left, double top, double width, double height)
        {
            Left = left;
            Top = top;
            Width = width;
            Height = height;
        }

        public double Left { get; }
        public double Top { get; }
        public double Width { get; }
        public double Height { get; }
        public double Right => Left + Width;
        public double Bottom => Top + Height;
        public double CentreX => Left + Width / 2;
        public double CentreY => Top + Height / 2;
    }

    /// <summary>Web-compatible geometric scoring for a directional focus target.</summary>
    public static class DirectionalFocus
    {
        /// <summary>Returns the web focus score, or null when the target is outside its forward cone.</summary>
        public static double? Score(FocusRect source, FocusRect candidate, bool left)
        {
            var primary = left ? source.CentreX - candidate.CentreX : candidate.CentreX - source.CentreX;
            if (primary <= 2)
            {
                return null;
            }

            var overlap = Math.Max(0, Math.Min(source.Bottom, candidate.Bottom) - Math.Max(source.Top, candidate.Top));
            var lateral = Math.Abs(candidate.CentreY - source.CentreY);
            if (overlap <= 0 && lateral > primary * 0.85 + Math.Min(source.Height, candidate.Height) * 0.2)
            {
                return null;
            }

            return primary + lateral * 4 - Math.Min(overlap, 180) * 0.55;
        }

        /// <summary>Returns the index with the lowest valid score, or -1 when no candidate is in the forward cone.</summary>
        public static int Best(FocusRect source, FocusRect[] candidates, bool left)
        {
            var bestIndex = -1;
            var bestScore = double.PositiveInfinity;
            for (var index = 0; index < candidates.Length; index++)
            {
                var score = Score(source, candidates[index], left);
                if (score.HasValue && score.Value < bestScore)
                {
                    bestScore = score.Value;
                    bestIndex = index;
                }
            }

            return bestIndex;
        }
    }
}
