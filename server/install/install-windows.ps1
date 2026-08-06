# install-windows.ps1 -- register Verso's backend as a Windows Service behind IIS + ARR
# (platform-pivot 31). Run once, elevated, on the server that will hold the store.
#
# WHAT THIS DOES, and what it deliberately does NOT do:
#   - registers node.exe running server/index.js as an auto-starting Windows Service
#   - creates the data folder and locks it down to the service account
#   - writes an IIS web.config that reverse-proxies to it, INCLUDING the WebSocket upgrade
#   - it does NOT install Node, IIS, ARR or a TLS certificate. Those are the site's to provide,
#     and a script that silently pulls software onto a governed server is not welcome there.
#
# NOTHING HERE REACHES THE INTERNET. No downloads, no telemetry, no update check.
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$DataDir,       # local disk only -- never a UNC path
  [string]$ServiceName = "VersoServer",
  [string]$NodeExe     = "C:\Program Files\nodejs\node.exe",
  [int]$Port           = 4790,
  [string]$SiteName    = "Verso"
)
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$repo = Split-Path -Parent (Split-Path -Parent $here)

# --- refusals, before anything is changed -----------------------------------
# SQLite over SMB corrupts silently under oplocks. A store on a network share is the one
# configuration that loses the doc-of-record without an error, so this refuses rather than warns.
if ($DataDir -match '^\\\\' -or $DataDir -match '^[A-Za-z]+://') {
  throw "DataDir must be on a local disk. SQLite corrupts silently on SMB/network shares."
}
if (-not (Test-Path $NodeExe)) { throw "Node was not found at $NodeExe. Install Node 22.5+ first, or pass -NodeExe." }
$v = & $NodeExe --version
if ([version]($v.TrimStart('v')) -lt [version]"22.5.0") { throw "Verso needs Node 22.5 or newer (node:sqlite). Found $v." }

Write-Host "Verso install: node $v, data $DataDir, port $Port"

# --- the data folder ---------------------------------------------------------
New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
# The service account is the ONLY writer. The app process being the sole writer is what makes
# SQLite/WAL safe here, so anything that widens this is a correctness change, not a convenience.
icacls $DataDir /inheritance:r /grant:r "NT AUTHORITY\NETWORK SERVICE:(OI)(CI)F" "BUILTIN\Administrators:(OI)(CI)F" | Out-Null

# --- the config file (secrets live HERE, never in source) --------------------
$cfg = Join-Path $repo "server\verso-server.config.json"
if (-not (Test-Path $cfg)) {
  @{ mode = "server"; host = "127.0.0.1"; port = $Port; dataDir = $DataDir;
     logFile = (Join-Path $DataDir "verso-server.log") } |
    ConvertTo-Json -Depth 5 | Set-Content -Path $cfg -Encoding UTF8
  Write-Host "Wrote $cfg -- put OIDC client id/secret in this file, never in source."
}

# --- the service -------------------------------------------------------------
# Bound to loopback: IIS is the only thing that talks to it, so the Node port is never exposed
# to the network even if a firewall rule is missed.
$bin = "`"$NodeExe`" `"$(Join-Path $repo 'server\index.js')`""
if (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) {
  Write-Host "Service $ServiceName exists; updating."
  sc.exe config $ServiceName binPath= $bin start= auto | Out-Null
} else {
  New-Service -Name $ServiceName -BinaryPathName $bin -DisplayName "Verso authoring server" -StartupType Automatic | Out-Null
}
sc.exe failure $ServiceName reset= 86400 actions= restart/5000/restart/15000/restart/60000 | Out-Null
Start-Service $ServiceName

# --- IIS + ARR ---------------------------------------------------------------
# BOTH pipes must proxy: the wss:// upgrade AND the long-poll fallback. Proxying only the
# long-poll leaves collaboration working but slow and no one knows why; proxying only wss://
# breaks every client whose network blocks it.
$webConfig = @"
<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <system.webServer>
    <webSocket enabled="true" />
    <rewrite>
      <rules>
        <rule name="Verso API" stopProcessing="true">
          <match url="^(api|auth|sync)(/.*)?$" />
          <action type="Rewrite" url="http://127.0.0.1:$Port/{R:0}" />
        </rule>
      </rules>
    </rewrite>
    <httpProtocol>
      <customHeaders>
        <remove name="X-Powered-By" />
      </customHeaders>
    </httpProtocol>
  </system.webServer>
</configuration>
"@
$webConfigPath = Join-Path $repo "web.config"
Set-Content -Path $webConfigPath -Value $webConfig -Encoding UTF8
Write-Host "Wrote $webConfigPath -- point the IIS site '$SiteName' at $repo and bind HTTPS."

Write-Host ""
Write-Host "Done. Remaining, by hand and on purpose:"
Write-Host "  1. Bind a TLS certificate to the IIS site. Verso never terminates TLS itself."
Write-Host "  2. Turn on BitLocker for the volume holding $DataDir."
Write-Host "  3. Open the site and complete first run (it creates the break-glass admin)."
Write-Host "  4. Check https://<host>/api/health?deep=1 returns level 'ok'."
