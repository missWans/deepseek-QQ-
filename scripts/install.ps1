# 一键把 plugin/ 注入 DeskLLMPet 的 resources/app.asar
# 用法：powershell -ExecutionPolicy Bypass -File scripts/install.ps1 -App "E:\DeskLLMPet"
param(
  [Parameter(Mandatory = $true)][string]$App,
  [string]$Plugin = (Join-Path $PSScriptRoot '..\plugin'),
  [int]$Port = 0
)

$ErrorActionPreference = 'Stop'
$App = (Resolve-Path $App).Path
$asar = Join-Path $App 'resources\app.asar'
if (!(Test-Path $asar)) { throw "找不到 $asar" }
if (Get-Process DeskLLMPet -ErrorAction SilentlyContinue) { throw '请先完全退出 DeskLLMPet 再安装' }

$work = Join-Path $env:TEMP ('qq-bridge-asar-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work -Force | Out-Null

Write-Host "[1/4] 备份 app.asar"
Copy-Item $asar (Join-Path $App ("resources\app.asar.bak-" + (Get-Date -Format 'yyyyMMdd-HHmmss')))

Write-Host "[2/4] 解包"
& npx --yes @electron/asar extract $asar (Join-Path $work 'extract')

Write-Host "[3/4] 写入插件"
$dst = Join-Path $work 'extract\src\plugins\qq-bridge'
if (Test-Path $dst) { Remove-Item $dst -Recurse -Force }
Copy-Item (Resolve-Path $Plugin).Path $dst -Recurse

Write-Host "[4/4] 重新打包并替换"
& npx --yes @electron/asar pack (Join-Path $work 'extract') (Join-Path $work 'app.asar.new')
Copy-Item (Join-Path $work 'app.asar.new') $asar -Force

Remove-Item $work -Recurse -Force
Write-Host '完成：重新打开 DeskLLMPet，右键菜单里会出现「QQ 接入向导」。'
