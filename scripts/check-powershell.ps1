$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot

foreach ($entryPoint in @("start_web_ui.ps1", "download_mp4.ps1")) {
    $sourcePath = Join-Path $repoRoot $entryPoint
    $tokens = $null
    $parseErrors = $null
    [System.Management.Automation.Language.Parser]::ParseFile($sourcePath, [ref]$tokens, [ref]$parseErrors) | Out-Null
    if ($parseErrors.Count -gt 0) {
        foreach ($parseError in $parseErrors) {
            Write-Error "$entryPoint : $parseError"
        }
        exit 1
    }
}

Write-Host "PowerShell syntax: OK"
