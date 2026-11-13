@echo off
rem ===========================================================================
rem  Amber Terminal - starter for Windows. Double-click to start.
rem   1. Node.js 22.13+ and Git: uses installed ones, otherwise downloads portable
rem      copies into .runtime next to this file (no admin rights needed).
rem   2. Checks the git repo below for a newer version and installs it
rem      (fast-forward only: local changes are never overwritten, data\ is never touched).
rem   3. Starts the terminal in its own app window (Edge/Chrome app mode).
rem  Copied alone into an empty folder, it first downloads the app (git clone)
rem  into .\amber-terminal.
rem  Per-machine overrides: launcher.cfg next to this file, or data\launcher.cfg
rem  (kept across updates, wins over launcher.cfg):
rem    REPO_URL=...   BRANCH=...   APP_WINDOW=0 (browser tab)   UPDATE_CHECK_HOURS=24
rem    EXIT_ON_CLOSE=0 (keep running when the window is closed)
rem  Already running from this folder: just opens the window again.
rem ===========================================================================
setlocal
rem --- default config --------------------------------------------------------
set "AMBER_REPO_URL=http://192.168.0.25:4000/home/amber-terminal.git"
set "AMBER_BRANCH=master"
set "AMBER_APP_WINDOW=1"
rem ---------------------------------------------------------------------------
set "AMBER_SELF=%~f0"
rem One block: cmd reads it completely before running it, so an update that
rem rewrites this file while it runs can't break it.
(
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$t=[IO.File]::ReadAllText($env:AMBER_SELF); $m='#'+'=PS=#'; & ([ScriptBlock]::Create($t.Substring($t.IndexOf($m)+$m.Length)))"
  if errorlevel 1 (echo. & echo   Amber Terminal did not start, see the messages above. & pause & exit /b 1)
  exit /b 0
)
#=PS=#
# ---- PowerShell part (Windows PowerShell 5.1+), run by the block above ----
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$Base = Split-Path -Parent $env:AMBER_SELF
$Runtime = Join-Path $Base '.runtime'
$MinNode = [version]'22.13.0'
$arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') { 'arm64' } else { 'x64' }
function Say($m) { Write-Host "  $m" }
function Fail($m) { Write-Host ''; Write-Host "  ERROR: $m" -ForegroundColor Red; exit 1 }
function Read-Cfg($file) {
  $c = @{}
  if (Test-Path $file) {
    foreach ($l in Get-Content $file) {
      if ($l -match '^\s*([A-Za-z_]\w*)\s*=\s*(.*?)\s*$' -and $l.Trim() -notlike '#*') { $c[$Matches[1].ToUpper()] = $Matches[2].Trim('"', "'") }
    }
  }
  $c
}
function Get-NodeVersion($exe) {
  try { $v = & $exe -v 2>$null; if ($v -match '^v(\d+\.\d+\.\d+)') { return [version]$Matches[1] } } catch { }
  $null
}
# Download a zip (checking SHA-256 when known) and unpack it into $dest, dropping a single top folder.
function Get-Zip($url, $dest, $sha256) {
  New-Item -ItemType Directory -Force $Runtime | Out-Null
  $zip = Join-Path $Runtime ('download-' + [IO.Path]::GetFileName($url))
  Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $zip
  if ($sha256 -and (Get-FileHash -Algorithm SHA256 $zip).Hash -ne $sha256.ToUpper()) { Remove-Item $zip -Force; Fail "Checksum mismatch for $url" }
  $tmp = "$dest.new"
  if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
  New-Item -ItemType Directory -Force $tmp | Out-Null
  $tar = Join-Path $env:SystemRoot 'System32\tar.exe'
  if (Test-Path $tar) { & $tar -xf $zip -C $tmp; if ($LASTEXITCODE) { Fail "Could not unpack $zip" } }
  else { Expand-Archive -Path $zip -DestinationPath $tmp -Force }
  Remove-Item $zip -Force
  $items = @(Get-ChildItem $tmp)
  $src = if ($items.Count -eq 1 -and $items[0].PSIsContainer) { $items[0].FullName } else { $tmp }
  if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
  Move-Item $src $dest
  if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
}

Write-Host ''
Write-Host '  AMBER TERMINAL - starter' -ForegroundColor Yellow
$baseCfg = Read-Cfg (Join-Path $Base 'launcher.cfg')
if ($baseCfg.REPO_URL) { $env:AMBER_REPO_URL = $baseCfg.REPO_URL }
if ($baseCfg.BRANCH) { $env:AMBER_BRANCH = $baseCfg.BRANCH }

# ---- 0. Already running from this folder? Then just open the window (no update, no downloads) ----
# Health check on the terminal's ports; only a copy whose folder matches counts.
function Find-Running($dir) {
  $first = if ($env:PORT) { [int]$env:PORT } else { 3787 }
  $want = [IO.Path]::GetFullPath($dir).TrimEnd('\').ToLower()
  for ($p = $first; $p -lt $first + 21; $p++) {
    $tcp = New-Object Net.Sockets.TcpClient
    try {
      $ar = $tcp.BeginConnect('127.0.0.1', $p, $null, $null)
      if (-not ($ar.AsyncWaitHandle.WaitOne(300) -and $tcp.Connected)) { continue }
    } catch { continue } finally { $tcp.Close() }
    try {
      $rq = [Net.HttpWebRequest]::Create("http://127.0.0.1:$p/api/health")
      $rq.Proxy = $null; $rq.Timeout = 4000
      $rs = $rq.GetResponse()
      $h = (New-Object IO.StreamReader($rs.GetResponseStream())).ReadToEnd() | ConvertFrom-Json
      $rs.Close()
      if ($h.app -eq 'amber-terminal' -and [IO.Path]::GetFullPath($h.root).TrimEnd('\').ToLower() -eq $want) { return $p }
    } catch { }
  }
  $null
}
$known = @($Base, (Join-Path $Base 'amber-terminal')) | Where-Object { Test-Path (Join-Path $_ 'server.js') } | Select-Object -First 1
if ($known) {
  $port = Find-Running $known
  if ($port) {
    $qn = @((Join-Path $Runtime 'node\node.exe'), (Get-Command node.exe -ErrorAction SilentlyContinue).Source) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
    if ($qn) {
      Say "Already running on port $port - opening the window (updates are installed on the next fresh start)."
      Set-Location $known
      $cfg = Read-Cfg (Join-Path $known 'data\launcher.cfg')
      if ($cfg.APP_WINDOW) { $env:AMBER_APP_WINDOW = $cfg.APP_WINDOW }
      if ($cfg.EXIT_ON_CLOSE) { $env:AMBER_EXIT_ON_CLOSE = $cfg.EXIT_ON_CLOSE }
      $env:PORT = "$port"
      & $qn scripts\launch.js
      Start-Sleep -Seconds 2
      exit 0
    }
  }
}

# ---- 1. Node.js ----
$node = $null
$portableNode = Join-Path $Runtime 'node\node.exe'
foreach ($cand in @($portableNode, (Get-Command node.exe -ErrorAction SilentlyContinue).Source)) {
  if ($cand -and (Test-Path $cand) -and (Get-NodeVersion $cand) -ge $MinNode) { $node = $cand; break }
}
if (-not $node) {
  Say "Node.js $MinNode or newer not found: downloading a portable copy (about 30 MB) ..."
  $rel = Invoke-RestMethod -UseBasicParsing 'https://nodejs.org/dist/index.json' | Where-Object { $_.lts -and ($_.files -contains "win-$arch-zip") } | Select-Object -First 1
  if (-not $rel) { Fail 'Could not find a Node.js LTS download for this PC.' }
  $v = $rel.version
  $name = "node-$v-win-$arch.zip"
  $sums = Invoke-RestMethod -UseBasicParsing "https://nodejs.org/dist/$v/SHASUMS256.txt"
  $line = ($sums -split "`n") | Where-Object { $_ -match ('\s' + [regex]::Escape($name) + '\s*$') } | Select-Object -First 1
  $sha = if ($line) { ($line -split '\s+')[0] } else { $null }
  Get-Zip "https://nodejs.org/dist/$v/$name" (Join-Path $Runtime 'node') $sha
  $node = $portableNode
  if ((Get-NodeVersion $node) -lt $MinNode) { Fail 'The downloaded Node.js does not run.' }
}
Say ("Node.js  v{0}  {1}" -f (Get-NodeVersion $node), $node)

# ---- 2. Git ----
$git = $null
$portableGit = Join-Path $Runtime 'git\cmd\git.exe'
foreach ($cand in @($portableGit, (Get-Command git.exe -ErrorAction SilentlyContinue).Source)) {
  if ($cand -and (Test-Path $cand)) { $git = $cand; break }
}
if (-not $git) {
  Say 'Git not found: downloading portable MinGit (about 40 MB) ...'
  $rel = Invoke-RestMethod -UseBasicParsing -Headers @{ 'User-Agent' = 'amber-terminal-starter' } 'https://api.github.com/repos/git-for-windows/git/releases/latest'
  $pats = @('^MinGit-[\d.]+(\.windows\.\d+)?-64-bit\.zip$')
  if ($arch -eq 'arm64') { $pats = @('^MinGit-[\d.]+(\.windows\.\d+)?-arm64\.zip$') + $pats }
  $asset = $null
  foreach ($p in $pats) { $asset = $rel.assets | Where-Object { $_.name -match $p } | Select-Object -First 1; if ($asset) { break } }
  if (-not $asset) { Fail 'Could not find MinGit in the latest Git for Windows release.' }
  $sha = if ("$($asset.digest)" -match '^sha256:([0-9a-fA-F]{64})$') { $Matches[1] } else { $null }
  Get-Zip $asset.browser_download_url (Join-Path $Runtime 'git') $sha
  $git = $portableGit
}
Say "Git      $git"
$env:PATH = (Split-Path $node) + ';' + (Split-Path $git) + ';' + $env:PATH
$env:AMBER_GIT = $git

# ---- 3. The app: next to this file, or install it into .\amber-terminal ----
$App = $Base
if (-not (Test-Path (Join-Path $App 'server.js'))) {
  $App = Join-Path $Base 'amber-terminal'
  if (-not (Test-Path (Join-Path $App 'server.js'))) {
    $url = $env:AMBER_REPO_URL
    $branch = $env:AMBER_BRANCH
    if (-not $url) { Fail 'No app next to start.bat and no repo to install from. Set AMBER_REPO_URL at the top of start.bat (or REPO_URL= in launcher.cfg next to it).' }
    Say "Installing Amber Terminal from $url ($branch) ..."
    & $git clone --quiet --branch $branch $url $App
    if ($LASTEXITCODE) { Fail 'git clone failed (repo URL, network or access rights?).' }
  }
}
Set-Location $App
$cfg = Read-Cfg (Join-Path $App 'data\launcher.cfg')
if ($cfg.APP_WINDOW) { $env:AMBER_APP_WINDOW = $cfg.APP_WINDOW }
if ($cfg.EXIT_ON_CLOSE) { $env:AMBER_EXIT_ON_CLOSE = $cfg.EXIT_ON_CLOSE }

# ---- 4. Update (never blocks the start) ----
& $node scripts\update.js --apply

# ---- 5. Start ----
& $node scripts\launch.js
if ($LASTEXITCODE) { Fail 'The server did not start (see data\server.log).' }
Start-Sleep -Seconds 4
exit 0
