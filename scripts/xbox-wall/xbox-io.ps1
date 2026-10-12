# XBOX_IO for GitHub-hosted Windows runners (the contract is in scripts/parity/xbox/driver.mjs): key, click, rclick, move, shot, read,
# write, restart. Pointer coordinates are 1920x1080 and are scaled to the real display; shots are resized to 1920x1080.
param([Parameter(Position = 0)][string]$Cmd, [Parameter(Position = 1)][string]$A, [Parameter(Position = 2)][string]$B)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type @"
using System; using System.Runtime.InteropServices;
public class Win {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(int f, int x, int y, int d, IntPtr e);
  [DllImport("user32.dll")] public static extern void keybd_event(byte k, byte s, int f, IntPtr e);
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)] public struct DM {
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string n; public short a, b, size, extra; public int fields, x, y, orient, fixedOut;
    public short color, duplex, yres, tt, collate; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string form;
    public short logPixels; public int bits, w, h, flags, freq, icm, icmIntent, media, dither, r1, r2, pw, ph; }
  [DllImport("user32.dll")] public static extern bool EnumDisplaySettings(string d, int m, ref DM dm);
  [DllImport("user32.dll")] public static extern int ChangeDisplaySettings(ref DM dm, int f);
  public static int Res(int w, int h) { var dm = new DM(); dm.size = (short)Marshal.SizeOf(dm); EnumDisplaySettings(null, -1, ref dm);
    if (dm.w == w && dm.h == h) return 0; dm.w = w; dm.h = h; dm.fields = 0x80000 | 0x100000; return ChangeDisplaySettings(ref dm, 1); }
}
"@
[Win]::SetProcessDPIAware() | Out-Null
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
function Pkg { Get-AppxPackage Playarr.PlayarrXbox | Select-Object -First 1 }
function State { Join-Path $env:LOCALAPPDATA "Packages\$((Pkg).PackageFamilyName)\LocalState" }
function PointerTo([double]$x, [double]$y) { [Win]::SetCursorPos([int]($x * $screen.Width / 1920), [int]($y * $screen.Height / 1080)) | Out-Null; Start-Sleep -Milliseconds 100 }
function Tap($down, $up) { [Win]::mouse_event($down, 0, 0, 0, [IntPtr]::Zero); Start-Sleep -Milliseconds 80; [Win]::mouse_event($up, 0, 0, 0, [IntPtr]::Zero) }
function Chord([byte[]]$codes, [int]$flags = 0) {
  foreach ($c in $codes) { [Win]::keybd_event($c, 0, $flags, [IntPtr]::Zero) }
  Start-Sleep -Milliseconds 80
  [array]::Reverse($codes)
  foreach ($c in $codes) { [Win]::keybd_event($c, 0, $flags -bor 2, [IntPtr]::Zero) }
}
switch ($Cmd) {
  'key' {
    switch ($A) {
      'up' { Chord @(0x26) 1 } 'down' { Chord @(0x28) 1 } 'left' { Chord @(0x25) 1 } 'right' { Chord @(0x27) 1 }
      'ret' { Chord @(0x0D) } 'esc' { Chord @(0x1B) } 'shift+f10' { Chord @(0x10, 0x79) }
      default { throw "unknown key $A" }
    }
  }
  'move' { PointerTo $A $B }
  'click' { PointerTo $A $B; Tap 2 4 }
  'rclick' { PointerTo $A $B; Tap 8 16 }
  'shot' {
    $bmp = New-Object System.Drawing.Bitmap $screen.Width, $screen.Height
    [System.Drawing.Graphics]::FromImage($bmp).CopyFromScreen($screen.Location, [System.Drawing.Point]::Empty, $screen.Size)
    $out = New-Object System.Drawing.Bitmap 1920, 1080
    $g = [System.Drawing.Graphics]::FromImage($out); $g.InterpolationMode = 'HighQualityBicubic'; $g.DrawImage($bmp, 0, 0, 1920, 1080)
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent ([IO.Path]::GetFullPath($A))) | Out-Null
    if ($B) {
      # Page background strip at the top right: near-black in dark, near-white in light; anything else is the wrong theme or a non-app screen.
      $sum = 0.0; $n = 0
      for ($x = 1100; $x -lt 1800; $x += 10) { for ($y = 0; $y -lt 8; $y += 2) { $c = $out.GetPixel($x, $y); $sum += (0.299 * $c.R + 0.587 * $c.G + 0.114 * $c.B) / 255; $n++ } }
      $mean = $sum / $n
      if (($B -eq 'dark' -and $mean -ge 0.2) -or ($B -eq 'light' -and $mean -le 0.9)) { Write-Error "luminance guard: $B run but top strip mean is $([math]::Round($mean, 2))"; exit 4 }
    }
    $out.Save([IO.Path]::GetFullPath($A), [System.Drawing.Imaging.ImageFormat]::Png)
  }
  'read' { Get-Content (Join-Path (State) 'parity.json') -Raw -Encoding UTF8 }
  'write' { Set-Content -NoNewline -Path (Join-Path (State) $A) -Value $B }
  'res' { "set 1920x1080: $([Win]::Res(1920, 1080)); display now $($screen.Width)x$($screen.Height)" }
  'restart' {
    [Win]::Res(1920, 1080) | Out-Null
    $screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    Get-Process Playarr.Xbox -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Sleep 2
    Remove-Item (Join-Path (State) 'parity.json') -ErrorAction SilentlyContinue
    Start-Process "shell:AppsFolder\$((Pkg).PackageFamilyName)!App"
    Start-Sleep 12
    Chord @(0x5B, 0x10, 0x0D)   # Win+Shift+Enter: UWP full screen
    Start-Sleep 8
  }
  default { throw "usage: xbox-io.ps1 key|click|rclick|move|shot|read|write|restart" }
}
