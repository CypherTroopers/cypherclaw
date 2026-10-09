# CypherClaw installer for Windows x64.
# Usage: iwr -useb https://github.com/CypherTroopers/cypherclaw/releases/latest/download/install.ps1 | iex
[CmdletBinding(PositionalBinding = $false)]
param(
    [string]$Version = "latest",
    [string]$Prefix,
    [string]$ReleaseDir,
    [switch]$NoOnboard,
    [switch]$DryRun,
    [switch]$Help
)

$ErrorActionPreference = "Stop"
$repository = "CypherTroopers/cypherclaw"
$nodeVersion = "24.21.0"
$stagingDirectory = $null

if ($Help) {
    @"
Usage: install.ps1 [options]
  -Version <release-tag>  Install an immutable CypherClaw release (default: latest)
  -Prefix <path>          Private install directory (default: ~/.cypherclaw)
  -ReleaseDir <path>      Install verified release files from a local directory
  -NoOnboard             Install without starting interactive setup
  -DryRun                Describe the installation without making changes
  -Help                  Show this help
"@ | Write-Output
    return
}

if ([System.Environment]::OSVersion.Platform -ne [System.PlatformID]::Win32NT) {
    throw "Use install.sh on macOS, Linux, or WSL2. This installer supports native Windows x64."
}
if ([string]::IsNullOrWhiteSpace($env:USERPROFILE)) {
    throw "USERPROFILE is unavailable. Run from your user account."
}
if ([string]::IsNullOrWhiteSpace($Prefix)) {
    $Prefix = Join-Path $env:USERPROFILE ".cypherclaw"
}
$architecture = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
if ($architecture -ne "AMD64") {
    throw "This release supports Windows x64. The detected architecture is $architecture."
}
if ($Version -ne "latest" -and $Version -cnotmatch '^cypherclaw-v[0-9]+\.[0-9]+\.[0-9]+-[0-9a-f]{12}$') {
    throw "Use a complete CypherClaw release tag, such as cypherclaw-v2026.9.9-0123456789ab."
}
$Prefix = [System.IO.Path]::GetFullPath($Prefix)
$prefixRoot = [System.IO.Path]::GetPathRoot($Prefix)
if ($Prefix.TrimEnd('\', '/') -eq $prefixRoot.TrimEnd('\', '/') -or $Prefix.TrimEnd('\', '/') -eq $env:USERPROFILE.TrimEnd('\', '/')) {
    throw "Choose a private subdirectory for -Prefix."
}
if ($ReleaseDir) {
    $ReleaseDir = (Resolve-Path -LiteralPath $ReleaseDir).Path
    if (-not (Test-Path -LiteralPath $ReleaseDir -PathType Container)) {
        throw "Release directory does not exist: $ReleaseDir"
    }
}
if ($DryRun) {
    $source = if ($ReleaseDir) { $ReleaseDir } else { "https://github.com/$repository/releases/$Version" }
    Write-Host "CypherClaw source: $source"
    Write-Host "Private install directory: $Prefix"
    Write-Host "Verify release checksums, provision private Node $nodeVersion, and install the prebuilt package."
    if (-not $NoOnboard) {
        Write-Host "Then start the existing interactive setup with the cypherclaw profile."
    }
    return
}

function Save-CypherClawDownload {
    param([string]$Uri, [string]$Destination)
    if (-not $Uri.StartsWith("https://")) { throw "Release downloads require HTTPS." }
    $request = [System.Net.WebRequest]::CreateHttp($Uri)
    $request.Timeout = 300000
    $request.ReadWriteTimeout = 300000
    $response = $null
    $responseStream = $null
    $outputStream = $null
    try {
        $response = $request.GetResponse()
        if ($response.ResponseUri.Scheme -ne "https") { throw "Release downloads require HTTPS redirects." }
        $responseStream = $response.GetResponseStream()
        $outputStream = [System.IO.File]::Create($Destination)
        $responseStream.CopyTo($outputStream)
    } finally {
        if ($outputStream) { $outputStream.Dispose() }
        if ($responseStream) { $responseStream.Dispose() }
        if ($response) { $response.Dispose() }
        $request.Abort()
    }
}

try {
    if (-not $ReleaseDir -and $Version -eq "latest") {
        # Resolve once: every asset must come from the same immutable release.
        $request = [System.Net.WebRequest]::CreateHttp("https://github.com/$repository/releases/latest")
        $request.Timeout = 300000
        $request.ReadWriteTimeout = 300000
        $response = $null
        try {
            $response = $request.GetResponse()
            $resolvedUrl = $response.ResponseUri.AbsoluteUri
            $releaseUrlPrefix = "https://github.com/$repository/releases/tag/"
            if (-not $resolvedUrl.StartsWith($releaseUrlPrefix, [System.StringComparison]::Ordinal)) {
                throw "GitHub did not return a CypherClaw release tag."
            }
            $Version = $resolvedUrl.Substring($releaseUrlPrefix.Length)
            if ($Version -cnotmatch '^cypherclaw-v[0-9]+\.[0-9]+\.[0-9]+-[0-9a-f]{12}$') {
                throw "The latest release does not have a valid CypherClaw tag."
            }
        } finally {
            if ($response) { $response.Dispose() }
            $request.Abort()
        }
    }
    $stagingDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ("cypherclaw-install-" + [guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Path $stagingDirectory | Out-Null

    function Get-CypherClawAsset {
        param([string]$File)
        $destination = Join-Path $stagingDirectory $File
        if ($ReleaseDir) {
            $source = Join-Path $ReleaseDir $File
            $item = Get-Item -LiteralPath $source
            if ($item.PSIsContainer -or ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint)) {
                throw "Release asset is not a regular file: $File"
            }
            Copy-Item -LiteralPath $source -Destination $destination
        } else {
            Save-CypherClawDownload -Uri "https://github.com/$repository/releases/download/$Version/$File" -Destination $destination
        }
    }

    Get-CypherClawAsset "SHA256SUMS"
    $checksums = Get-Content -LiteralPath (Join-Path $stagingDirectory "SHA256SUMS")
    foreach ($asset in @("cypherclaw-release.json", "install-node.ps1", "install-runtime.mjs", "cypherclaw-contract.mjs", "cypherclaw.tgz")) {
        Get-CypherClawAsset $asset
        $checksumPattern = '^(?<hash>[0-9a-fA-F]{64})\s+\*?' + [regex]::Escape($asset) + '$'
        $expected = @($checksums | ForEach-Object {
            if ($_ -match $checksumPattern) { $Matches["hash"] }
        })
        if ($expected.Count -ne 1 -or (Get-FileHash -LiteralPath (Join-Path $stagingDirectory $asset) -Algorithm SHA256).Hash -ne $expected[0]) {
            throw "SHA-256 verification failed for $asset."
        }
    }

    Write-Host "Installing CypherClaw from $(if ($ReleaseDir) { $ReleaseDir } else { $Version })"
    $nodeDirectory = Join-Path $Prefix "tools\node"
    $powershell = (Get-Process -Id $PID).Path
    & $powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $stagingDirectory "install-node.ps1") -NodeOnly -NodePrefix $nodeDirectory -NodeVersion $nodeVersion
    if ($LASTEXITCODE -ne 0) { throw "Private Node provisioning failed with exit code $LASTEXITCODE." }
    $node = Join-Path $nodeDirectory "node.exe"
    if (-not (Test-Path -LiteralPath $node -PathType Leaf)) { throw "Private Node is unavailable at $node." }
    $privateNodeVersion = & $node --version
    if ($LASTEXITCODE -ne 0 -or $privateNodeVersion -ne "v$nodeVersion") { throw "Private Node must be exactly $nodeVersion for this release." }
    $runtimeArguments = @((Join-Path $stagingDirectory "install-runtime.mjs"), "--release-dir", $stagingDirectory, "--prefix", $Prefix)
    if ($Version -ne "latest") { $runtimeArguments += @("--release-tag", $Version) }
    if ($NoOnboard) { $runtimeArguments += "--no-onboard" }
    & $node @runtimeArguments
    if ($LASTEXITCODE -ne 0) { throw "CypherClaw installation failed with exit code $LASTEXITCODE." }
} finally {
    if ($stagingDirectory -and (Test-Path -LiteralPath $stagingDirectory)) {
        Remove-Item -LiteralPath $stagingDirectory -Recurse -Force
    }
}
