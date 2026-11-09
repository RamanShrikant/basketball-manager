# Optional: fix two pre-existing, stale assertions in the EXISTING test script.
# This changes regression-test expectations only. It does NOT modify gameplay.
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $MyInvocation.MyCommand.Path
$target = Join-Path $repo 'frontend\scripts\bm-regression-check.mjs'
if (-not (Test-Path -LiteralPath $target)) { throw 'Regression script not found.' }
$text = [System.IO.File]::ReadAllText($target)
$changes = 0
$old1 = 'includes("src/pages/TeamHub.jsx", ''path: "/contract-extensions"'', "Team Hub links the Contract Extensions front-office page.");'
$new1 = 'includes("src/components/TeamHubSidebar.jsx", ''path: "/contract-extensions"'', "Team Hub sidebar links the Contract Extensions front-office page.");'
$old2 = 'check("cpu_trade_bank.version12", cpuTradeBank.includes("CPU_TRADE_BANK_VERSION = 12"), "CPU trade bank schema matches the current bounded continuous-market persistence version.");'
$new2 = 'check("cpu_trade_bank.version13", cpuTradeBank.includes("CPU_TRADE_BANK_VERSION = 13"), "CPU trade bank schema matches the current bounded continuous-market persistence version.");'
if ($text.Contains($old1)) { $text = $text.Replace($old1, $new1); $changes++ }
elseif (-not $text.Contains($new1)) { throw 'Could not safely locate contract navigation assertion. No file written.' }
if ($text.Contains($old2)) { $text = $text.Replace($old2, $new2); $changes++ }
elseif (-not $text.Contains($new2)) { throw 'Could not safely locate CPU-bank version assertion. No file written.' }
if ($changes -gt 0) {
  [System.IO.File]::WriteAllText($target, $text, (New-Object System.Text.UTF8Encoding($false)))
}
Write-Host "Updated $changes stale regression assertions only. No gameplay code changed." -ForegroundColor Green
