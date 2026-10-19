# Windows runner only: bring the Previewer window to the foreground so ArkUI gets a window focus event (real D-pad focus needs it).
# Prints what it found so the run log shows whether the window existed and held the foreground afterwards.
Add-Type @"
using System; using System.Runtime.InteropServices; using System.Text;
public class Fg {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern void keybd_event(byte k, byte s, uint f, UIntPtr e);
}
"@
function Title($h) { $b = New-Object System.Text.StringBuilder 256; [void][Fg]::GetWindowText($h, $b, 256); $b.ToString() }
$procs = @(Get-Process -Name Previewer -ErrorAction SilentlyContinue)
Write-Output ("focus_window: Previewer processes " + $procs.Count)
foreach ($p in $procs) {
  Write-Output ("focus_window: pid " + $p.Id + " handle " + $p.MainWindowHandle + " title '" + $p.MainWindowTitle + "'")
  if ($p.MainWindowHandle -ne [IntPtr]::Zero) {
    [Fg]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero); [Fg]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero) # an Alt tap lets SetForegroundWindow through
    [void][Fg]::ShowWindow($p.MainWindowHandle, 5)
    Write-Output ("focus_window: SetForegroundWindow " + [Fg]::SetForegroundWindow($p.MainWindowHandle))
  }
}
Start-Sleep -Seconds 1
Write-Output ("focus_window: foreground now '" + (Title ([Fg]::GetForegroundWindow())) + "'")
