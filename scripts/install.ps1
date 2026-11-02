# One-command install for dsh-cognition-engine (Windows).
#
# Usage:
#   powershell -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/1720198650/dsh-cognition-engine/main/scripts/install.ps1 | iex"
#
# Or with options:
#   .\install.ps1 -Dest D:\plugins\dsh-cognition-engine -Profile desktop

param(
    [string]$Dest = "$env:USERPROFILE\dsh-plugins\dsh-cognition-engine",
    [string]$Profile = "desktop",
    [string]$Repo = "https://github.com/1720198650/dsh-cognition-engine.git"
)

$ErrorActionPreference = 'Stop'

function Find-Git {
    foreach ($candidate in @("$env:ProgramFiles\Git\cmd\git.exe", "${env:ProgramFiles(x86)}\Git\cmd\git.exe", "git")) {
        try {
            & $candidate --version | Out-Null
            return $candidate
        } catch {
            continue
        }
    }
    throw "git not found. Install Git for Windows first: https://git-scm.com/download/win"
}

$git = Find-Git

if (Test-Path (Join-Path $Dest ".git")) {
    Write-Host "[1/4] Updating existing checkout: $Dest"
    & $git -C $Dest pull --ff-only
} else {
    Write-Host "[1/4] Cloning into: $Dest"
    New-Item -ItemType Directory -Force -Path (Split-Path $Dest -Parent) | Out-Null
    & $git clone --depth 1 $Repo $Dest
}

Write-Host "[2/4] Installing dependencies"
Push-Location $Dest
try {
    # 网络抖动会让首次安装失败，重试三次再放弃
    $installed = $false
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        npm install --no-audit --no-fund
        if ($LASTEXITCODE -eq 0) { $installed = $true; break }
        Write-Host "  install failed (attempt $attempt/3), retrying in 3s..." -ForegroundColor Yellow
        Start-Sleep -Seconds 3
    }
    if (-not $installed) { throw "npm install failed after 3 attempts" }
} finally {
    Pop-Location
}

Write-Host "[3/4] Building"
Push-Location $Dest
try {
    npm run build
} finally {
    Pop-Location
}

Write-Host "[4/4] Registering with DSH (profile: $Profile)"
$dsh = Get-Command dsh -ErrorAction SilentlyContinue
if ($null -eq $dsh) {
    Write-Host ""
    Write-Host "dsh CLI not found on PATH. Register manually:" -ForegroundColor Yellow
    Write-Host "    dsh plugin --profile $Profile add `"$Dest`""
} else {
    & dsh plugin --profile $Profile add $Dest
}

Write-Host ""
Write-Host "Done. Installed from: $Dest" -ForegroundColor Green
Write-Host "If the panel does not appear, quit and restart DSH once."
