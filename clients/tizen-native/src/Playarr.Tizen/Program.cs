using System.Runtime.InteropServices;
using Playarr.Tizen.Logic;
using Tizen.NUI;
using Tizen.NUI.BaseComponents;

namespace Playarr.Tizen;

internal sealed class Program : NUIApplication
{
    // Opaque window: the TV emulator's EGL offers no alpha-blended surface we need.
    public Program() : base("", WindowMode.Opaque) { }

    [DllImport("libc", EntryPoint = "setenv")]
    private static extern int SetEnv(string name, string value, int overwrite);

    protected override void OnCreate()
    {
        base.OnCreate();
        var window = Window.Default;
        window.BackgroundColor = new Color(0.125f, 0.125f, 0.125f, 1f);
        window.Add(new TextLabel("Playarr")
        {
            PointSize = 48,
            TextColor = Color.White,
            PositionX = 120,
            PositionY = 80,
            WidthResizePolicy = ResizePolicyType.UseNaturalSize,
            HeightResizePolicy = ResizePolicyType.UseNaturalSize,
        });
        window.KeyEvent += (_, e) =>
        {
            if (e.Key.State != Key.StateType.Down) return;
            if (RemoteKeys.FromName(e.Key.KeyPressedName) == RemoteKey.Back) Exit();
        };
    }

    private static void Main(string[] args)
    {
        // DALI reads the process environment, which Environment.SetEnvironmentVariable does not touch on Linux.
        // -1 asks for no multisampling: the Tizen TV emulator's EGL has no MSAA configs and DALI aborts without this.
        SetEnv("DALI_MULTI_SAMPLING_LEVEL", "-1", 1);
        new Program().Run(args);
    }
}
