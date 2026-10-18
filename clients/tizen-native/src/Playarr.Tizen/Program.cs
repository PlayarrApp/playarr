using HostedLinkClient = Playarr.Tizen.Logic.HostedLinkClient;
using System.Runtime.InteropServices;
using Playarr.Core.Auth;
using Playarr.Core.Models;
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
        SynchronizationContextHolder.Ui = SynchronizationContext.Current;
        var window = Window.Default;
        Ui.RegisterFonts();
        var data = global::Tizen.Applications.Application.Current.DirectoryInfo.Data;
        var store = new FileSessionStore(data);
        if (store.GetSessionAsync().GetAwaiter().GetResult() is null) StartSignIn(window, store);
        else ShowShell(window, store);
    }

    private global::Tizen.NUI.Timer? _longPress;
    private bool _longFired;

    /// <summary>Select fires on release; held for 0.8 s it becomes SelectLong (web's long-press actions).</summary>
    private void HandleSelect(Key.StateType state)
    {
        if (state == Key.StateType.Down)
        {
            if (_longPress is not null) return; // key repeat
            _longFired = false;
            _longPress = new global::Tizen.NUI.Timer(800);
            _longPress.Tick += (_, _) => { _longFired = true; _longPress = null; _shell?.OnKey(RemoteKey.SelectLong); return false; };
            _longPress.Start();
        }
        else if (state == Key.StateType.Up)
        {
            _longPress?.Stop(); _longPress = null;
            if (!_longFired) _shell?.OnKey(RemoteKey.Select);
        }
    }

    private Shell? _shell;
    private AppEnv? _env;
    private ReturnTypeEventHandler<object, Window.KeyEventArgs, bool>? _keyIntercept;
    private readonly ConsumedKeyReleaseTracker _consumedKeysToRelease = new();

    private void ShowShell(Window window, FileSessionStore store, string route = "/")
    {
        _env ??= AppEnv.Create(store);
        var env = _env;
        if (env is null) return;
        env.Theme = PlayarrTheme.ByName(store.Theme());
        if (_shell is not null) { (_shell.Page as SearchScreen)?.OnRemoved(); (_shell.Page as PlaylistsScreen)?.OnRemoved(); window.Remove(_shell); _shell.Dispose(); }
        var shell = _shell = new Shell(env, Exit);
        window.Add(shell);
        shell.Navigate(route);
        _ = env.LoadProfileNameAsync(shell.SetProfileName).ContinueWith(_ => { if (env.CurrentAvatar is { } a) SynchronizationContextHolder.Post(() => shell.SetAvatar(a)); });
        env.SignOut = () =>
        {
            store.ClearSessionAsync().GetAwaiter().GetResult();
            if (_keyIntercept is not null) window.InterceptKeyEvent -= _keyIntercept;
            _consumedKeysToRelease.Clear();
            if (_shell is not null) { (_shell.Page as SearchScreen)?.OnRemoved(); (_shell.Page as PlaylistsScreen)?.OnRemoved(); window.Remove(_shell); _shell.Dispose(); _shell = null; }
            _env = null;
            StartSignIn(window, store);
        };
        env.SetTheme = name =>
        {
            store.SaveTheme(name);
            ShowShell(window, store, shell.Route);
        };
#if PLAYARR_DEBUG
        _debug ??= new DebugMirror(() => _shell!, () => _env!);
        _debug.Start();
#endif
        if (_keyIntercept is not null) window.InterceptKeyEvent -= _keyIntercept;
        _keyIntercept = (_, e) =>
        {
            var activeShell = _shell;
            var name = e.Key.KeyPressedName;
            if (e.Key.State == Key.StateType.Up && _consumedKeysToRelease.TryConsume(name, out var finishSelect))
            {
                if (finishSelect) HandleSelect(e.Key.State);
                else if ((name is "Return" or "KP_Enter") && activeShell?.Page is SearchScreen search)
                    search.HandleQueryEnterRelease();
                return true;
            }
            if (activeShell is null) return false;
            var editingContext = activeShell.EditingTextFieldContext;
            if (editingContext != TextFieldEditingContext.None)
            {
                var route = RemoteKeys.ForEditingTextField(name, editingContext);
                if (route.Action == TextFieldKeyAction.PassThrough) return false;
                if (e.Key.State == Key.StateType.Down)
                {
                    var select = route.Action == TextFieldKeyAction.Remote && route.RemoteKey == RemoteKey.Select;
                    _consumedKeysToRelease.Mark(name, select);
                    switch (route.Action)
                    {
                        case TextFieldKeyAction.Remote when route.RemoteKey is { } editingRemoteKey:
                            if (select) HandleSelect(e.Key.State);
                            else activeShell.OnKey(editingRemoteKey);
                            break;
                        case TextFieldKeyAction.SearchEnter when activeShell.Page is SearchScreen search:
                            search.BeginQueryEnter();
                            break;
                        case TextFieldKeyAction.Submit when activeShell.Page is PlaylistsScreen playlists:
                            playlists.SubmitCreateFromName();
                            break;
                    }
                }
                return true;
            }

#if PLAYARR_DEBUG
            if (name == "1" && e.Key.State == Key.StateType.Down)
            {
                _ = DebugPlayFirstAsync(env, activeShell);
                _consumedKeysToRelease.Mark(name, false);
                return true;
            }
#endif
            var key = RemoteKeys.FromName(name);
            if (key == RemoteKey.None) return false;
            if (e.Key.State == Key.StateType.Down)
            {
                var select = key == RemoteKey.Select;
                _consumedKeysToRelease.Mark(name, select);
                if (select) HandleSelect(e.Key.State);
                else activeShell.OnKey(key);
            }
            return true;
        };
        window.InterceptKeyEvent += _keyIntercept;
    }

#if PLAYARR_DEBUG
    private DebugMirror? _debug;
#endif

#if PLAYARR_DEBUG
    private static async Task DebugPlayFirstAsync(AppEnv env, Shell shell)
    {
        var rows = await env.Api.ListWatchProgressAsync();
        var file = rows.FirstOrDefault()?.MediaFileId;
        if (file is { } f) SynchronizationContextHolder.Post(() => shell.Navigate("/player/" + f));
    }
#endif

    private void StartSignIn(Window window, FileSessionStore store)
    {
        var screen = new LoginScreen(PlayarrTheme.Dark);
        window.Add(screen);
        EventHandler<Window.KeyEventArgs>? signInKeys = null;
        signInKeys = (_, e) => { if (e.Key.State == Key.StateType.Down && RemoteKeys.FromName(e.Key.KeyPressedName) == RemoteKey.Back) Exit(); };
        window.KeyEvent += signInKeys;
        var ui = SynchronizationContext.Current;
        var flow = new SignIn(new HostedLinkClient(new HttpClient()), store,
            url => new DeviceFlowClient(url, clientPlatform: ClientPlatform.TizenNative),
            state => ui!.Post(_ =>
            {
                if (state.Stage == SignInStage.SignedIn) { window.Remove(screen); ShowShell(window, store); return; }
                screen.Show(state);
                if (state.Code is { } c) { _expires = c.ExpiresAt; }
            }, null));
        _ = flow.RunAsync(_cts.Token);
        var tick = new global::Tizen.NUI.Timer(1000);
        tick.Tick += (_, _) => { if (_expires is { } e) screen.Tick(e); return true; };
        tick.Start();
    }

    private readonly CancellationTokenSource _cts = new();
    private DateTimeOffset? _expires;

    private static void Main(string[] args)
    {
        // DALI reads the process environment, which Environment.SetEnvironmentVariable does not touch on Linux.
        // -1 asks for no multisampling: the Tizen TV emulator's EGL has no MSAA configs and DALI aborts without this.
        SetEnv("DALI_MULTI_SAMPLING_LEVEL", "-1", 1);
        new Program().Run(args);
    }
}
