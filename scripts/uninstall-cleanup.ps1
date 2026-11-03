# cognition-engine uninstall cleanup
# Removes the plugin's data files and the AGENTS.md section it added.
# The plugin itself must still be removed through plugin_manager / dsh plugin.

param(
    [string]$Workspace = (Get-Location).Path
)

$ErrorActionPreference = 'Stop'
$pluginRoot = Split-Path -Parent $PSScriptRoot

# 1) data files written by the plugin
$dataFiles = @(
    'cognition-state.json',
    'cognition-state.json.tmp',
    'cognition-state.json.sha256',
    'cognition-state.json.lock',
    'cognition-audit.jsonl',
    'cognition-audit.jsonl.1',
    'tasks.json',
    'tasks.json.tmp',
    'tasks.json.lock',
    'inject-probe.log'
)
foreach ($name in $dataFiles) {
    $path = Join-Path $pluginRoot $name
    if (Test-Path $path) {
        Remove-Item $path -Force
        Write-Host "[removed] $path"
    }
}

# 1b) 自动快照目录
$snapshotDir = Join-Path $pluginRoot '.snapshots'
if (Test-Path $snapshotDir) {
    Remove-Item $snapshotDir -Recurse -Force
    Write-Host "[removed] $snapshotDir"
}

# 2) the AGENTS.md section that points at cognition_context
$agents = Join-Path $Workspace 'AGENTS.md'
if (Test-Path $agents) {
    $text = [System.IO.File]::ReadAllText($agents, [System.Text.Encoding]::UTF8)
    $marker = '## 九、认知引擎'
    $index = $text.IndexOf($marker)
    if ($index -ge 0) {
        $head = $text.Substring(0, $index).TrimEnd()
        # 一并摘掉章节前面的 --- 分隔线，避免留下孤立的分隔符
        if ($head.EndsWith('---')) {
            $head = $head.Substring(0, $head.Length - 3).TrimEnd()
        }
        $trimmed = $head + "`n"
        [System.IO.File]::WriteAllText($agents, $trimmed, (New-Object System.Text.UTF8Encoding($false)))
        Write-Host "[removed] cognition section from $agents"
    } else {
        Write-Host "[skip] no cognition section in $agents"
    }
}

# 3) browser token
Write-Host ''
Write-Host 'Manual step left:' -ForegroundColor Yellow
Write-Host '  In the DSH page console run: localStorage.removeItem("cognition-token")'
Write-Host '  Then remove the bundle: plugin_manager remove_bundle @local/cognition-engine'
