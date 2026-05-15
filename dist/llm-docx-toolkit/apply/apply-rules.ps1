param(
    [string]$Root = "targets",
    [string]$ReportPath = "targets\format_report.csv",
    [switch]$SkipHtml,
    [switch]$SkipValidate
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$wdFormatXMLDocument = 12
$wdStyleTitle = -63
$wdStyleHeading1 = -2
$wdWithInTable = 12
$msoAutomationSecurityForceDisable = 3

$script:RevisionTag = ([char]0xC218).ToString() + ([char]0xC815).ToString()
$script:WidgetKoTag = ([char]0xC704).ToString() + ([char]0xC82F).ToString()

function Get-CleanRangeText {
    param([Parameter(Mandatory = $true)]$Range)
    return (($Range.Text -replace "[`r`a]+$", "").Trim())
}

function Get-DocTitleFromPath {
    param([Parameter(Mandatory = $true)][string]$Path)
    $base = [IO.Path]::GetFileNameWithoutExtension($Path)
    $base = $base -replace ("^\d+" + [regex]::Escape($script:RevisionTag) + "_"), ''
    $parts = $base -split '_'
    if ($parts.Count -ge 1) { return $parts[-1].Trim() }
    return $base.Trim()
}

function Set-BuiltInTitle {
    param(
        [Parameter(Mandatory = $true)]$Document,
        [Parameter(Mandatory = $true)][string]$Title
    )
    if (-not $Title) { return }
    try {
        $props = $Document.BuiltInDocumentProperties
        $prop = $props.Item("Title")
        $prop.Value = $Title
    } catch {
        # Some locked Office builds block document properties. Formatting can continue.
    }
}

function Set-ParagraphStyleByRule {
    param(
        [Parameter(Mandatory = $true)]$Document,
        [Parameter(Mandatory = $true)][string]$Title
    )
    $stats = [ordered]@{
        TitleStyled = 0
        HeadingsStyled = 0
        MarkersHidden = 0
    }
    $sawFirstBodyParagraph = $false
    foreach ($p in @($Document.Paragraphs)) {
        $text = Get-CleanRangeText $p.Range
        if (-not $text) { continue }
        $inTable = $false
        try { $inTable = [bool]$p.Range.Information($wdWithInTable) } catch {}
        if ($inTable) { continue }
        $markerRe = "^\s*(?:Widget|" + [regex]::Escape($script:WidgetKoTag) + ")\s*:"
        if ($text -match $markerRe) {
            try { $p.Range.Font.Hidden = $true; $stats.MarkersHidden++ } catch {}
            continue
        }
        if (-not $sawFirstBodyParagraph) {
            $sawFirstBodyParagraph = $true
            if ($text -notmatch '^\s*\d+(?:\.\d+){0,5}[\.\)]?\s+\S') {
                try {
                    $p.Range.Style = $Document.Styles.Item($wdStyleTitle)
                    $stats.TitleStyled++
                } catch {}
                continue
            }
        }
        # Dotted numbering is the strongest section signal in docs/llm-input-rules.md.
        # Apply Heading N only to short, non-list paragraphs to avoid turning body lists
        # into sections.
        if ($text.Length -le 220 -and $text -match '^\s*(?<num>\d+(?:\.\d+){0,5})[\.\)]?\s+\S') {
            $isList = $false
            try { $isList = ($p.Range.ListFormat.ListType -ne 0) } catch {}
            if ($isList) { continue }
            $num = $Matches["num"]
            $level = ($num -split '\.').Count
            if ($level -lt 1) { $level = 1 }
            if ($level -gt 6) { $level = 6 }
            try {
                $p.Range.Style = $Document.Styles.Item($wdStyleHeading1 - ($level - 1))
                $stats.HeadingsStyled++
            } catch {}
        }
    }
    return [pscustomobject]$stats
}

function Normalize-TableHeaders {
    param([Parameter(Mandatory = $true)]$Document)
    $stats = [ordered]@{
        TablesSeen = 0
        HeaderRowsPlain = 0
        HeaderTextsCleaned = 0
        NestedTables = 0
    }
    foreach ($table in @($Document.Tables)) {
        $stats.TablesSeen++
        try {
            if ($table.Rows.Count -lt 1) { continue }
            $header = $table.Rows.Item(1)
            $header.Range.Font.Bold = 0
            $stats.HeaderRowsPlain++
            foreach ($cell in @($header.Cells)) {
                $raw = Get-CleanRangeText $cell.Range
                $clean = ($raw -replace '^\s*\*\*(.*?)\*\*\s*$', '$1') `
                              -replace '^\s*__(.*?)__\s*$', '$1'
                $clean = $clean.Trim()
                if ($clean -ne $raw) {
                    $r = $cell.Range
                    $r.End = $r.End - 1
                    $r.Text = $clean
                    $stats.HeaderTextsCleaned++
                }
                try { $cell.Range.Font.Bold = 0 } catch {}
            }
        } catch {}
    }
    foreach ($table in @($Document.Tables)) {
        foreach ($cell in @($table.Range.Cells)) {
            try {
                if ($cell.Tables.Count -gt 1) { $stats.NestedTables++ }
            } catch {}
        }
    }
    return [pscustomobject]$stats
}

function Convert-FloatingPicturesToInline {
    param([Parameter(Mandatory = $true)]$Document)
    $stats = [ordered]@{
        FloatingShapes = 0
        ShapesInlined = 0
        ShapeInlineFailures = 0
    }
    for ($i = $Document.Shapes.Count; $i -ge 1; $i--) {
        try {
            $shape = $Document.Shapes.Item($i)
            $stats.FloatingShapes++
            try {
                [void]$shape.ConvertToInlineShape()
                $stats.ShapesInlined++
            } catch {
                $stats.ShapeInlineFailures++
            }
        } catch {}
    }
    return [pscustomobject]$stats
}

function Format-Docx {
    param(
        [Parameter(Mandatory = $true)]$Word,
        [Parameter(Mandatory = $true)][string]$Path
    )
    $doc = $null
    $title = Get-DocTitleFromPath $Path
    try {
        $doc = $Word.Documents.Open($Path, $false, $false, $false)
        Set-BuiltInTitle -Document $doc -Title $title
        $pStats = Set-ParagraphStyleByRule -Document $doc -Title $title
        $tStats = Normalize-TableHeaders -Document $doc
        $sStats = Convert-FloatingPicturesToInline -Document $doc
        $doc.Save()
        return [pscustomobject]@{
            Status = "ok"
            Path = $Path
            OutputPath = $Path
            ConvertedFromHtml = $false
            TitleStyled = $pStats.TitleStyled
            HeadingsStyled = $pStats.HeadingsStyled
            MarkersHidden = $pStats.MarkersHidden
            TablesSeen = $tStats.TablesSeen
            HeaderRowsPlain = $tStats.HeaderRowsPlain
            HeaderTextsCleaned = $tStats.HeaderTextsCleaned
            FloatingShapes = $sStats.FloatingShapes
            ShapesInlined = $sStats.ShapesInlined
            ShapeInlineFailures = $sStats.ShapeInlineFailures
            NestedTables = $tStats.NestedTables
            Warning = if ($tStats.NestedTables -gt 0) { "nested tables detected" } else { "" }
        }
    } catch {
        return [pscustomobject]@{
            Status = "error"
            Path = $Path
            OutputPath = $Path
            ConvertedFromHtml = $false
            TitleStyled = 0
            HeadingsStyled = 0
            MarkersHidden = 0
            TablesSeen = 0
            HeaderRowsPlain = 0
            HeaderTextsCleaned = 0
            FloatingShapes = 0
            ShapesInlined = 0
            ShapeInlineFailures = 0
            NestedTables = 0
            Warning = $_.Exception.Message
        }
    } finally {
        if ($doc -ne $null) {
            try { $doc.Close($false) } catch {}
        }
    }
}

function Convert-HtmlToDocx {
    param(
        [Parameter(Mandatory = $true)]$Word,
        [Parameter(Mandatory = $true)][string]$Path
    )
    $doc = $null
    $out = [IO.Path]::ChangeExtension($Path, ".docx")
    try {
        $doc = $Word.Documents.Open($Path, $false, $false, $false)
        $doc.SaveAs2($out, $wdFormatXMLDocument)
        return $out
    } finally {
        if ($doc -ne $null) {
            try { $doc.Close($false) } catch {}
        }
    }
}

function Invoke-Validator {
    param(
        [Parameter(Mandatory = $true)][string]$ValidatorExe,
        [Parameter(Mandatory = $true)][string]$DocxPath
    )
    # Run the offline schema validator on each formatted .docx. Returns the
    # exit code so the caller can record schema_valid / not in the CSV.
    try {
        & $ValidatorExe $DocxPath 2>&1 | Out-Null
        return $LASTEXITCODE
    } catch {
        return -1
    }
}

# ── main ─────────────────────────────────────────────────────────────

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootPath = (Resolve-Path (Join-Path $scriptDir $Root)).Path
$reportFullPath = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath(
    (Join-Path $scriptDir $ReportPath)
)

# Locate the validator binary shipped alongside this script. The release bundle
# puts the toolkit binary at ../bin/mxwp-validator-win32.exe relative to apply/.
$validatorExe = $null
if (-not $SkipValidate) {
    $candidates = @(
        (Join-Path $scriptDir "..\bin\mxwp-validator-win32.exe"),
        (Join-Path $scriptDir "..\bin\mxwp-validator.exe"),
        (Join-Path $scriptDir "bin\mxwp-validator-win32.exe")
    )
    foreach ($c in $candidates) {
        if (Test-Path -LiteralPath $c) {
            $validatorExe = (Resolve-Path $c).Path
            break
        }
    }
    if (-not $validatorExe) {
        Write-Host "[!] mxwp-validator.exe not found — skipping schema validation."
    }
}

$revisionFileRe = "^\d+" + [regex]::Escape($script:RevisionTag) + "_"
$targets = Get-ChildItem -Path $rootPath -Recurse -File |
    Where-Object { $_.Name -match $revisionFileRe -and $_.FullName -notmatch '\\Examples\\docx\\|\\Examples\\CAE\\' } |
    Sort-Object FullName

# Fall back to "every .docx / .html in the targets root" when no revision-tagged
# file is found — that's the common case for non-organisational uploads.
if ($targets.Count -eq 0) {
    $targets = Get-ChildItem -Path $rootPath -Recurse -File |
        Where-Object { $_.Extension -ieq ".docx" -or ($_.Extension -ieq ".html" -and -not $SkipHtml) } |
        Sort-Object FullName
}

if ($targets.Count -eq 0) {
    Write-Host "[!] No .docx / .html found under '$rootPath'. Place files there and re-run."
    return
}

Write-Host ("Found {0} file(s) to process under '{1}'." -f $targets.Count, $rootPath)

$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
try { $word.AutomationSecurity = $msoAutomationSecurityForceDisable } catch {}

$results = New-Object System.Collections.Generic.List[object]
$docxToFormat = New-Object System.Collections.Generic.List[string]

try {
    foreach ($f in $targets) {
        if ($f.Extension -ieq ".docx") {
            $docxToFormat.Add($f.FullName)
        } elseif (-not $SkipHtml -and $f.Extension -ieq ".html") {
            try {
                $out = Convert-HtmlToDocx -Word $word -Path $f.FullName
                $docxToFormat.Add($out)
                $results.Add([pscustomobject]@{
                    Status = "converted"
                    Path = $f.FullName
                    OutputPath = $out
                    ConvertedFromHtml = $true
                    TitleStyled = 0
                    HeadingsStyled = 0
                    MarkersHidden = 0
                    TablesSeen = 0
                    HeaderRowsPlain = 0
                    HeaderTextsCleaned = 0
                    FloatingShapes = 0
                    ShapesInlined = 0
                    ShapeInlineFailures = 0
                    NestedTables = 0
                    Warning = ""
                })
            } catch {
                $results.Add([pscustomobject]@{
                    Status = "convert_error"
                    Path = $f.FullName
                    OutputPath = [IO.Path]::ChangeExtension($f.FullName, ".docx")
                    ConvertedFromHtml = $true
                    TitleStyled = 0
                    HeadingsStyled = 0
                    MarkersHidden = 0
                    TablesSeen = 0
                    HeaderRowsPlain = 0
                    HeaderTextsCleaned = 0
                    FloatingShapes = 0
                    ShapesInlined = 0
                    ShapeInlineFailures = 0
                    NestedTables = 0
                    Warning = $_.Exception.Message
                })
            }
        }
    }
    foreach ($path in ($docxToFormat | Sort-Object -Unique)) {
        $r = Format-Docx -Word $word -Path $path
        # Schema validation hook — runs the offline validator if available.
        $schemaValid = ""
        if ($validatorExe -and $r.Status -eq "ok") {
            $exit = Invoke-Validator -ValidatorExe $validatorExe -DocxPath $path
            $schemaValid = switch ($exit) {
                0 { "yes" }
                1 { "no (schema violation)" }
                2 { "no (parse crashed)" }
                default { "skipped" }
            }
        }
        # Append the validation column.
        $r | Add-Member -NotePropertyName "SchemaValid" -NotePropertyValue $schemaValid -Force
        $results.Add($r)
    }
} finally {
    try { $word.Quit() } catch {}
    [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($word)
}

$results | Export-Csv -Path $reportFullPath -NoTypeInformation -Encoding UTF8
$results | Group-Object Status | Select-Object Name, Count | Format-Table -AutoSize
Write-Host "Report: $reportFullPath"
