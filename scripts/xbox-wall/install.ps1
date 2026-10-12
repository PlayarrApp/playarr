# Register the unsigned CI MSIX as a loose layout (Developer Mode), as the wall VM does. Usage: install.ps1 <dir with the msix and dependency-*.appx>
param([Parameter(Mandatory)][string]$Dir)
$ErrorActionPreference = 'Stop'
New-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock' -Name AllowDevelopmentWithoutDevLicense -Value 1 -PropertyType DWord -Force | Out-Null
foreach ($dep in Get-ChildItem $Dir -Filter '*dependency-*') {
  $f = Join-Path $env:RUNNER_TEMP ($dep.Name -replace '^.*dependency-', 'dep-')
  Copy-Item $dep.FullName $f -Force
  try { Add-AppxPackage -Path $f -ErrorAction Stop } catch { "dependency $($dep.Name): $($_.Exception.Message.Split([char]10)[0])" }
}
$msix = Get-ChildItem $Dir -Filter '*unsigned*' | Select-Object -First 1
$stage = Join-Path $env:RUNNER_TEMP 'xbox-stage'; $app = Join-Path $env:RUNNER_TEMP 'xbox-app'
Remove-Item $stage, $app -Recurse -Force -ErrorAction SilentlyContinue
Copy-Item $msix.FullName (Join-Path $env:RUNNER_TEMP 'app.zip') -Force
Expand-Archive (Join-Path $env:RUNNER_TEMP 'app.zip') $stage -Force
Remove-Item "$stage\AppxSignature.p7x", "$stage\AppxBlockMap.xml", "$stage\[[]Content_Types[]].xml", "$stage\AppxMetadata" -Recurse -Force -ErrorAction SilentlyContinue
$m = "$stage\AppxManifest.xml"; (Get-Content $m -Raw) -replace 'Publisher="CN=Playarr[^"]*"', 'Publisher="CN=Playarr"' | Set-Content $m -NoNewline -Encoding UTF8
robocopy $stage $app /MIR /NFL /NDL /NJH /NJS | Out-Null
Add-AppxPackage -Register "$app\AppxManifest.xml" -ForceApplicationShutdown -ForceUpdateFromAnyVersion
Get-AppxPackage Playarr.PlayarrXbox | Select-Object Name, Version | Format-List | Out-String
exit 0   # robocopy leaves exit code 1 (files copied), which pwsh would report as failure
