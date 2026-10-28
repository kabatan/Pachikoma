# Restore the exact original bytes. Compatible with Windows PowerShell 5.1.
$ErrorActionPreference = 'Stop'
$releaseRepo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..'))
function Get-ReleaseHash([string]$Path) {
  $stream = [IO.File]::OpenRead($Path)
  $sha = [Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-', '').ToLowerInvariant() }
  finally { $stream.Dispose(); $sha.Dispose() }
}
$releaseManifest = Get-Content -LiteralPath (Join-Path $releaseRepo 'release-parts.json') -Raw | ConvertFrom-Json
foreach ($file in $releaseManifest.files) {
  $target = Join-Path $releaseRepo $file.path
  if ((Test-Path -LiteralPath $target) -and (Get-Item -LiteralPath $target).Length -eq $file.bytes) {
    if ((Get-ReleaseHash $target) -eq $file.sha256) { continue }
  }
  Write-Host ('Preparing original file: ' + $file.path)
  $temp = $target + '.joining-' + [Guid]::NewGuid().ToString('N')
  try {
    $output = [IO.File]::Open($temp, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write)
    try {
      foreach ($part in $file.parts) {
        $inputPath = Join-Path $releaseRepo $part.path
        if ((Get-Item -LiteralPath $inputPath).Length -ne $part.bytes) { throw ('Incomplete release part: ' + $part.path) }
        $inputStream = [IO.File]::OpenRead($inputPath)
        try { $inputStream.CopyTo($output) } finally { $inputStream.Dispose() }
      }
    } finally { $output.Dispose() }
    if ((Get-Item -LiteralPath $temp).Length -ne $file.bytes -or (Get-ReleaseHash $temp) -ne $file.sha256) { throw ('Release file checksum mismatch: ' + $file.path) }
    if (Test-Path -LiteralPath $target) { [IO.File]::Delete($target) }
    [IO.File]::Move($temp, $target)
  } finally { if (Test-Path -LiteralPath $temp) { [IO.File]::Delete($temp) } }
}
