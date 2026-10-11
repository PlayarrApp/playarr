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
}
"@
[Win]::SetProcessDPIAware() | Out-Null
$screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
function Pkg { Get-AppxPackage Playarr.PlayarrXbox | Select-Object -First 1 }
function State { Join-Path $env:LOCALAPPDATA "Packages\$((Pkg).PackageFamilyName)\LocalState" }
function Move($x, $y) { [Win]::SetCursorPos([int]($x * $screen.Width / 1920), [int]($y * $screen.Height / 1080)) | Out-Null; Start-Sleep -Milliseconds 100 }
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
  'move' { Move $A $B }
  'click' { Move $A $B; Tap 2 4 }
  'rclick' { Move $A $B; Tap 8 16 }
  'shot' {
    $bmp = New-Object System.Drawing.Bitmap $screen.Width, $screen.Height
    [System.Drawing.Graphics]::FromImage($bmp).CopyFromScreen($screen.Location, [System.Drawing.Point]::Empty, $screen.Size)
    $out = New-Object System.Drawing.Bitmap 1920, 1080
    $g = [System.Drawing.Graphics]::FromImage($out); $g.InterpolationMode = 'HighQualityBicubic'; $g.DrawImage($bmp, 0, 0, 1920, 1080)
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent ([IO.Path]::GetFullPath($A))) | Out-Null
    $out.Save([IO.Path]::GetFullPath($A), [System.Drawing.Imaging.ImageFormat]::Png)
  }
  'read' { Get-Content (Join-Path (State) 'parity.json') -Raw }
  'write' { Set-Content -NoNewline -Path (Join-Path (State) $A) -Value $B }
  'restart' {
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
