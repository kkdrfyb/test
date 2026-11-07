<#
    Build-AddIn.ps1
    ------------------------------------------------------------------
    Packages the VBA module and the Ribbon definition into an Excel
    add-in (.xlam) with a custom "My Tools" ribbon tab.

    Requirements:
      * Microsoft Excel installed (used through COM to host the VBA project)
      * Excel option enabled: File > Options > Trust Center >
        Trust Center Settings > Macro Settings >
        "Trust access to the VBA project object model"

    Usage:
      powershell -ExecutionPolicy Bypass -File build\Build-AddIn.ps1
      powershell -ExecutionPolicy Bypass -File build\Build-AddIn.ps1 -Install
#>

[CmdletBinding()]
param(
    [string]$SrcDir    = (Join-Path $PSScriptRoot '..\src'),
    [string]$BasName   = 'FileLink.bas',
    [string]$UiName    = 'customUI.xml',
    [string]$OutDir    = (Join-Path $PSScriptRoot '..\dist'),
    [string]$AddInName = 'MyTools.xlam',
    [switch]$Install
)

$ErrorActionPreference = 'Stop'

function Write-Step([string]$Message) {
    Write-Host "[build] $Message" -ForegroundColor Cyan
}

function Read-TextFile([string]$Path) {
    $reader = New-Object System.IO.StreamReader($Path, [System.Text.Encoding]::UTF8, $true)
    try   { return $reader.ReadToEnd() }
    finally { $reader.Close() }
}

function Release-Com([object]$Object) {
    if ($Object -ne $null) {
        try { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($Object) } catch { }
    }
}

# ---------------------------------------------------------------- inputs
$basPath = Join-Path $SrcDir $BasName
$uiPath  = Join-Path $SrcDir $UiName

if (-not (Test-Path $basPath)) { throw "Source module not found: $basPath" }
if (-not (Test-Path $uiPath))  { throw "Ribbon definition not found: $uiPath" }

if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Path $OutDir -Force | Out-Null }
$finalPath = Join-Path $OutDir $AddInName
$stagePath = Join-Path ([System.IO.Path]::GetTempPath()) 'MyTools.stage.xlam'

# The output stays locked while Excel has the add-in loaded; fall back to a new file name.
if (Test-Path $finalPath) {
    $locked = $false
    try {
        $probe = [System.IO.File]::Open($finalPath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
        $probe.Close()
        $probe.Dispose()
    } catch {
        $locked = $true
    }
    if ($locked) {
        $stem   = [System.IO.Path]::GetFileNameWithoutExtension($AddInName)
        $ext    = [System.IO.Path]::GetExtension($AddInName)
        $finalPath = Join-Path $OutDir ($stem + '.new' + $ext)
        Write-Host "[build] $AddInName is still loaded in Excel. Writing to $([System.IO.Path]::GetFileName($finalPath)) instead." -ForegroundColor Yellow
    }
}

Write-Step "Source module : $basPath"
Write-Step "Ribbon XML    : $uiPath"
Write-Step "Output add-in : $finalPath"

# ---------------------------------------------------------------- ribbon xml
$uiText = (Read-TextFile $uiPath).TrimStart([char]0xFEFF)
try   { [void][xml]$uiText }
catch { throw "customUI.xml is not valid XML: $($_.Exception.Message)" }
Write-Step 'Ribbon XML validated.'

# ---------------------------------------------------------------- vba source
$basText = (Read-TextFile $basPath).TrimStart([char]0xFEFF)
$basText = $basText -replace "`r`n", "`n"
$basText = $basText -replace "`r", "`n"
$basText = $basText -replace "`n", "`r`n"

$lines = @($basText -split "`r`n")
while ($lines.Count -gt 0 -and $lines[0] -match '^\s*(Attribute\s+VB_|VERSION\b)') {
    if ($lines.Count -eq 1) { $lines = @() }
    else                    { $lines = $lines[1..($lines.Count - 1)] }
}
if ($lines.Count -eq 0) { throw "No code found in $basPath" }
$code = ($lines -join "`r`n")
Write-Step ('Prepared VBA source: {0} lines' -f $lines.Count)

# ---------------------------------------------------------------- excel com
Write-Step 'Starting Excel and creating the add-in...'
$excel = $null
$wb    = $null
try {
    try   { $excel = New-Object -ComObject Excel.Application }
    catch { throw "Microsoft Excel is not available through COM. Install Excel or build the add-in manually (see README.md)." }

    $excel.Visible       = $false
    $excel.DisplayAlerts = $false

    $wb     = $excel.Workbooks.Add()
    $vbproj = $null
    try   { $vbproj = $wb.VBProject }
    catch { throw "Cannot access the VBA project. Enable 'Trust access to the VBA project object model' (File > Options > Trust Center > Trust Center Settings > Macro Settings) and run this script again." }

    $comp = $vbproj.VBComponents.Add(1)      # vbext_ct_StdModule
    $comp.Name = 'modFileLink'
    $comp.CodeModule.AddFromString($code)
    Write-Step ('VBA module inserted: {0} lines' -f $comp.CodeModule.CountOfLines)

    if (Test-Path $stagePath) { Remove-Item $stagePath -Force }
    $wb.IsAddIn = $true
    $wb.SaveAs($stagePath, 55)               # xlOpenXMLAddIn
    Write-Step "Staged workbook saved."
}
finally {
    if ($wb -ne $null)    { try { $wb.Close($false) } catch { } }
    if ($excel -ne $null) { try { $excel.Quit() }     catch { } }
    Release-Com $wb
    Release-Com $excel
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
}

# ---------------------------------------------------------------- zip injection
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

function Read-ZipEntry([System.IO.Compression.ZipArchiveEntry]$Entry) {
    $stream = $Entry.Open()
    $reader = New-Object System.IO.StreamReader($stream, (New-Object System.Text.UTF8Encoding($false)), $true)
    try   { return $reader.ReadToEnd() }
    finally { $reader.Close() }
}

function Write-ZipEntry([System.IO.Compression.ZipArchive]$Archive, [string]$Name, [string]$Text) {
    $entry = $Archive.CreateEntry($Name, [System.IO.Compression.CompressionLevel]::Optimal)
    $bytes = (New-Object System.Text.UTF8Encoding($false)).GetBytes($Text)
    $s = $entry.Open()
    try   { $s.Write($bytes, 0, $bytes.Length) }
    finally { $s.Close() }
}

$ctOverride  = '<Override PartName="/customUI/customUI.xml" ContentType="application/xml"/>'
$uiRelation  = '<Relationship Id="rIdCustomUI" Type="http://schemas.microsoft.com/office/2006/relationships/ui/extensibility" Target="customUI/customUI.xml"/>'

Write-Step 'Injecting Ribbon definition into the package...'
$srcZip = $null; $dstZip = $null; $fs = $null
$contentTypes = $null
$relationships = $null
try {
    $srcZip = [System.IO.Compression.ZipFile]::OpenRead($stagePath)
    $fs     = [System.IO.File]::Open($finalPath, [System.IO.FileMode]::Create, [System.IO.FileAccess]::ReadWrite)
    $dstZip = New-Object System.IO.Compression.ZipArchive($fs, [System.IO.Compression.ZipArchiveMode]::Create)

    foreach ($entry in $srcZip.Entries) {
        switch ($entry.FullName) {
            '[Content_Types].xml' { $contentTypes   = Read-ZipEntry $entry }
            '_rels/.rels'         { $relationships  = Read-ZipEntry $entry }
            'customUI/customUI.xml' { }
            default {
                $newEntry = $dstZip.CreateEntry($entry.FullName, [System.IO.Compression.CompressionLevel]::Optimal)
                $src = $entry.Open()
                $dst = $newEntry.Open()
                try   { $src.CopyTo($dst) }
                finally { $dst.Close(); $src.Close() }
            }
        }
    }

    if ($contentTypes -eq $null)  { throw 'Staged package does not contain [Content_Types].xml' }
    if ($relationships -eq $null) { throw 'Staged package does not contain _rels/.rels' }

    if ($contentTypes -notmatch 'customUI/customUI\.xml') {
        $contentTypes = $contentTypes -replace '</Types>', ('  ' + $ctOverride + '</Types>')
    }
    if ($relationships -notmatch 'ui/extensibility') {
        $relationships = $relationships -replace '</Relationships>', ('  ' + $uiRelation + '</Relationships>')
    }

    Write-ZipEntry $dstZip '[Content_Types].xml'    $contentTypes
    Write-ZipEntry $dstZip '_rels/.rels'            $relationships
    Write-ZipEntry $dstZip 'customUI/customUI.xml'  $uiText
}
finally {
    if ($dstZip -ne $null) { $dstZip.Dispose() }
    if ($fs -ne $null)     { $fs.Dispose() }
    if ($srcZip -ne $null) { $srcZip.Dispose() }
}

if (Test-Path $stagePath) { Remove-Item $stagePath -Force }

# ---------------------------------------------------------------- verification
Write-Step 'Verifying package structure...'
$checkZip = $null
try {
    $checkZip = [System.IO.Compression.ZipFile]::OpenRead($finalPath)
    $names = @($checkZip.Entries | ForEach-Object { $_.FullName })
    foreach ($required in @('[Content_Types].xml', '_rels/.rels', 'xl/vbaProject.bin', 'customUI/customUI.xml')) {
        if ($names -notcontains $required) { throw "Missing part in package: $required" }
    }
    if ((Read-ZipEntry $checkZip.GetEntry('[Content_Types].xml')) -notmatch 'customUI/customUI\.xml') {
        throw 'Content type override for customUI is missing.'
    }
    if ((Read-ZipEntry $checkZip.GetEntry('_rels/.rels')) -notmatch 'ui/extensibility') {
        throw 'Relationship for customUI is missing.'
    }
    if ((Read-ZipEntry $checkZip.GetEntry('customUI/customUI.xml')) -notmatch 'tabMyTools') {
        throw 'Ribbon definition does not contain the expected tab id (tabMyTools).'
    }
}
finally { if ($checkZip -ne $null) { $checkZip.Dispose() } }
Write-Step 'Package structure OK.'

Write-Step 'Verifying VBA callbacks in the add-in...'
$excel2 = $null
$wb2    = $null
try {
    $excel2 = New-Object -ComObject Excel.Application
    $excel2.Visible       = $false
    $excel2.DisplayAlerts = $false
    $wb2 = $excel2.Workbooks.Open($finalPath)
    $comp2 = $wb2.VBProject.VBComponents.Item('modFileLink')
    $body = $comp2.CodeModule.Lines(1, $comp2.CodeModule.CountOfLines)
    foreach ($proc in @('Ribbon_UpdateSelected', 'Ribbon_LinkTailRows')) {
        if ($body -notmatch $proc) { throw "Callback not found in module: $proc" }
    }
    Write-Step ('Callbacks OK. Module lines: {0}' -f $comp2.CodeModule.CountOfLines)
}
catch {
    Write-Host ('[build] Warning: VBA verification skipped: {0}' -f $_.Exception.Message) -ForegroundColor Yellow
}
finally {
    if ($wb2 -ne $null)    { try { $wb2.Close($false) } catch { } }
    if ($excel2 -ne $null) { try { $excel2.Quit() }     catch { } }
    Release-Com $wb2
    Release-Com $excel2
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
}

# ---------------------------------------------------------------- install
if ($Install) {
    $addinsDir = Join-Path $env:APPDATA 'Microsoft\AddIns'
    if (-not (Test-Path $addinsDir)) { New-Item -ItemType Directory -Path $addinsDir -Force | Out-Null }
    Copy-Item $finalPath (Join-Path $addinsDir $AddInName) -Force
    Write-Step "Copied to $addinsDir"
}

Write-Host ''
Write-Host ('[build] Done: {0} ({1} bytes)' -f $finalPath, (Get-Item $finalPath).Length) -ForegroundColor Green
Write-Host '[build] Enable it in Excel: File > Options > Add-Ins > Manage "Excel Add-ins" > Go > Browse > select MyTools.xlam' -ForegroundColor Green
