@echo off
rem ===========================================================================
rem  Amber Terminal - starter for Windows. Double-click to start.
rem   1. Node.js 22.13+: uses an installed one (also the .runtime one folder up),
rem      otherwise downloads a portable copy into .runtime next to this file
rem      (no admin rights needed).
rem   2. Asks the repo below (GitHub or Gitea) for a newer version, installs it as a ZIP
rem      (no git needed; data\ is never touched). A git checkout updates by git.
rem   3. Starts the terminal in its own app window (Edge/Chrome app mode).
rem  Copied alone into an empty folder, it first downloads the app (ZIP from the
rem  repo server) into .\amber-terminal.
rem  Per-machine overrides: launcher.cfg next to this file, or data\launcher.cfg
rem  (kept across updates, wins over launcher.cfg):
rem    REPO_URL=...   BRANCH=...   APP_WINDOW=0 (browser tab)   UPDATE_CHECK_HOURS=24
rem    EXIT_ON_CLOSE=0 (keep running when the window is closed)
rem  Already running from this folder: checks for an update, then opens the window again.
rem ===========================================================================
setlocal
rem --- default config --------------------------------------------------------
set "AMBER_REPO_URL=https://github.com/hoermto/kamiterm.git"
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
# Node.js candidates: the portable one next to this file, the one in .runtime one folder up (the app's own
# start.bat after an install from a lone start.bat), then the installed one.
$parentDir = Split-Path -Parent $Base
$NodeCands = @((Join-Path $Runtime 'node\node.exe'), $(if ($parentDir) { Join-Path $parentDir '.runtime\node\node.exe' }), (Get-Command node.exe -ErrorAction SilentlyContinue).Source)
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
# Download the branch as a ZIP from the repo server (GitHub, Gitea/Forgejo: <repo>/archive/<branch>.zip) and copy it
# over $dest. data\, .runtime\ and .git\ in $dest are kept; nothing else is deleted.
function Install-Zip($url, $branch, $dest) {
  $web = ($url.Trim() -replace '/+$', '') -replace '\.git$', ''
  $tmp = Join-Path $Runtime 'app-download'
  try { Get-Zip "$web/archive/$branch.zip" $tmp $null }
  catch { Fail "Download failed: $($_.Exception.Message) (repo URL, network or access rights?)" }
  if (-not (Test-Path (Join-Path $tmp 'server.js'))) { Fail "The download from $web is not an Amber Terminal archive." }
  New-Item -ItemType Directory -Force $dest | Out-Null
  Get-ChildItem -Force $tmp | Where-Object { @('data', '.runtime', '.git') -notcontains $_.Name } | ForEach-Object { Copy-Item $_.FullName $dest -Recurse -Force }
  Remove-Item $tmp -Recurse -Force
}

Write-Host ''
Write-Host '  AMBER TERMINAL - starter' -ForegroundColor Yellow
$baseCfg = Read-Cfg (Join-Path $Base 'launcher.cfg')
if ($baseCfg.REPO_URL) { $env:AMBER_REPO_URL = $baseCfg.REPO_URL }
if ($baseCfg.BRANCH) { $env:AMBER_BRANCH = $baseCfg.BRANCH }

# ---- 0. Already running from this folder? Check for an update (installing it restarts the server), then open the window ----
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
  if ($port -and -not (Test-Path (Join-Path $known '.git')) -and -not (Test-Path (Join-Path $known 'data\installed.json'))) {
    # ZIP copy with unknown version: needs the one-time refresh below, which needs the server stopped.
    $qn = $NodeCands | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
    if ($qn) { Say "Running on port $port - stopping it to refresh this copy."; $env:PORT = "$port"; Push-Location $known; & $qn scripts\stop.js; Pop-Location }
    $port = $null
  }
  if ($port) {
    $qn = $NodeCands | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
    if ($qn) {
      Say "Already running on port $port - checking for updates, then opening the window."
      Set-Location $known
      $cfg = Read-Cfg (Join-Path $known 'data\launcher.cfg')
      if ($cfg.APP_WINDOW) { $env:AMBER_APP_WINDOW = $cfg.APP_WINDOW }
      if ($cfg.EXIT_ON_CLOSE) { $env:AMBER_EXIT_ON_CLOSE = $cfg.EXIT_ON_CLOSE }
      $env:PORT = "$port"
      # An update stops the running server and installs; launch.js then starts the new version on the same port.
      $qg = Join-Path $Runtime 'git\cmd\git.exe'
      if (Test-Path $qg) { $env:PATH = (Split-Path $qg) + ';' + $env:PATH; $env:AMBER_GIT = $qg }
      & $qn scripts\update.js --apply
      & $qn scripts\launch.js
      Start-Sleep -Seconds 2
      exit 0
    }
  }
}

# ---- 1. Node.js ----
$node = $null
$portableNode = Join-Path $Runtime 'node\node.exe'
foreach ($cand in $NodeCands) {
  if ($cand -and (Test-Path $cand) -and (Get-NodeVersion $cand) -ge $MinNode) { $node = $cand; break }
}
if (-not $node) {
  Say "Node.js $MinNode or newer not found: downloading a portable copy (about 30 MB) ..."
  # Windows PowerShell 5.1 passes a JSON array down the pipe as ONE object: assign first, then filter,
  # or the 'version' becomes every version joined with spaces (bad URL, HTTP 400).
  $all = @(Invoke-RestMethod -UseBasicParsing 'https://nodejs.org/dist/index.json')
  $rel = $all | ForEach-Object { $_ } | Where-Object { $_.lts -and ($_.files -contains "win-$arch-zip") -and [version]($_.version.TrimStart('v')) -ge $MinNode } | Select-Object -First 1
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

# ---- 2. The app: next to this file, or install it into .\amber-terminal ----
# Installed as a ZIP from the repo server (no git needed); start.bat stays next to the folder.
$App = $Base
if (-not (Test-Path (Join-Path $App 'server.js'))) {
  $App = Join-Path $Base 'amber-terminal'
  if (-not (Test-Path (Join-Path $App 'server.js'))) {
    $url = $env:AMBER_REPO_URL
    $branch = $env:AMBER_BRANCH
    if (-not $url) { Fail 'No app next to start.bat and no repo to install from. Set AMBER_REPO_URL at the top of start.bat (or REPO_URL= in launcher.cfg next to it).' }
    Say "Installing Amber Terminal from $url ($branch) ..."
    Install-Zip $url $branch $App
  }
} elseif (-not (Test-Path (Join-Path $App '.git')) -and -not (Test-Path (Join-Path $App 'data\installed.json'))) {
  # A ZIP copy whose version is not recorded (downloaded by hand, or installed by an older starter): its own
  # updater may be too old to update without git, so refresh it once here; from then on it updates itself.
  $c0 = Read-Cfg (Join-Path $App 'data\launcher.cfg')
  $url = if ($c0.REPO_URL) { $c0.REPO_URL } else { $env:AMBER_REPO_URL }
  $branch = if ($c0.BRANCH) { $c0.BRANCH } else { $env:AMBER_BRANCH }
  if ($url) {
    Say "Version of this copy unknown (ZIP download): getting the current one from $url ($branch) ..."
    Install-Zip $url $branch $App
  }
}
$env:PATH = (Split-Path $node) + ';' + $env:PATH

# ---- 3. Git: only for a git checkout (development copy), which updates by git fetch ----
if (Test-Path (Join-Path $App '.git')) {
  $git = @((Join-Path $Runtime 'git\cmd\git.exe'), (Get-Command git.exe -ErrorAction SilentlyContinue).Source) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
  if ($git) { Say "Git      $git (git checkout)"; $env:PATH = (Split-Path $git) + ';' + $env:PATH; $env:AMBER_GIT = $git }
  else { Say 'Git checkout, but git is not installed: no update check.' }
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
