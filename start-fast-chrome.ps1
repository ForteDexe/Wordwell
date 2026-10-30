[CmdletBinding()]
param([switch]$ShowCommand)

$ErrorActionPreference = 'Stop'
$candidates = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
)
$chromePath = $candidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
if (-not $chromePath) { throw 'Google Chrome was not found in its usual installation folders.' }

# Startup-only switches: reuse the normal Chrome profile and installed extension.
# They are not persisted in Chrome settings, Windows settings, or a shortcut.
$chromeArguments = @('--force-high-performance-gpu', '--use-webgpu-power-preference=force-high-performance')
if ($ShowCommand) {
    Write-Output ('"{0}" {1}' -f $chromePath, ($chromeArguments -join ' '))
    return
}
if (Get-Process -Name chrome -ErrorAction SilentlyContinue) {
    throw 'Chrome is still running. Save your work and exit Chrome completely, including background Chrome processes, then run this script again. Startup GPU switches do not apply to an already-running browser.'
}
Start-Process -FilePath $chromePath -ArgumentList $chromeArguments
Write-Output 'Chrome started with the high-performance GPU preference. Open Local English and verify Engine details > adapter > vendor. Close Chrome and reopen it normally to return to its default GPU selection.'
