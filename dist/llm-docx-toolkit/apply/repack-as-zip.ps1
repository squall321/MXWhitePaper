# repack-as-zip.ps1 — bundle the current toolkit folder into a
# timestamped .zip for sharing with a teammate.
#
# Run from inside the unpacked toolkit folder:
#     .\apply\repack-as-zip.ps1
#
# Output: <folder-name>-YYYYMMDD-HHmm.zip in the parent directory,
# with SHA-256 printed so the receiver can verify.

[CmdletBinding()]
param(
    # Where to write the zip. Default: parent of the toolkit folder.
    [string]$OutDir = (Resolve-Path "..").Path,
    # Optional explicit variant override (lite|full). Auto-detected from
    # the folder name otherwise.
    [ValidateSet("auto", "lite", "full")]
    [string]$Variant = "auto"
)

$ErrorActionPreference = "Stop"

# 1. Locate the toolkit root. Script lives in <root>/apply/, so the root
# is one level up.
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ToolkitRoot = (Resolve-Path (Join-Path $ScriptDir "..")).Path
$FolderName = Split-Path -Leaf $ToolkitRoot

Write-Host "[repack] source : $ToolkitRoot"

# 2. Variant resolution — folder name usually includes lite/full.
if ($Variant -eq "auto") {
    if ($FolderName -match "full") {
        $Variant = "full"
    } else {
        $Variant = "lite"
    }
}
Write-Host "[repack] variant: $Variant"

# 3. Output filename. Keep folder + variant in the name so several zips
# can sit in the same dir without clobbering.
$Timestamp = Get-Date -Format "yyyyMMdd-HHmm"
$ZipName = "$FolderName-$Timestamp.zip"
$ZipPath = Join-Path $OutDir $ZipName
if (Test-Path $ZipPath) {
    Remove-Item $ZipPath -Force
}

# 4. Build a temp staging folder that excludes caches. Compress-Archive
# in PowerShell doesn't support per-item filtering directly, so we copy
# what we want first.
$Staging = Join-Path ([System.IO.Path]::GetTempPath()) ("mxwp-repack-" + [System.Guid]::NewGuid().ToString("N").Substring(0,8))
$StagedRoot = Join-Path $Staging $FolderName
New-Item -ItemType Directory -Path $StagedRoot | Out-Null

Write-Host "[repack] staging: $Staging"
$ExcludePatterns = @("__pycache__", ".pytest_cache", "_build", "_release")
robocopy $ToolkitRoot $StagedRoot /E /XD $ExcludePatterns /NFL /NDL /NJH /NJS /NP | Out-Null
# robocopy exit codes 0-7 are success (8+ are errors)
if ($LASTEXITCODE -ge 8) {
    throw "robocopy failed with exit code $LASTEXITCODE"
}

# 5. Compress.
Write-Host "[repack] compressing..."
Compress-Archive -Path $StagedRoot -DestinationPath $ZipPath -CompressionLevel Optimal

# 6. Cleanup staging.
Remove-Item $Staging -Recurse -Force

# 7. Verify + print SHA so the receiver can confirm integrity.
$SizeMB = [math]::Round((Get-Item $ZipPath).Length / 1MB, 1)
$Sha = (Get-FileHash -Algorithm SHA256 $ZipPath).Hash.ToLower()

Write-Host ""
Write-Host "[OK] repacked"
Write-Host "  file   : $ZipPath"
Write-Host "  size   : $SizeMB MB"
Write-Host "  sha256 : $Sha"
Write-Host ""
Write-Host "Send the .zip + this sha to your teammate. They can verify with:"
Write-Host "  PowerShell> (Get-FileHash -Algorithm SHA256 $ZipName).Hash.ToLower()"
