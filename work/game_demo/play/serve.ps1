# Static file server for Windows when Node.js is not installed (PowerShell 5.1 or later, no admin needed).
# Same URL mapping as serve.mjs: /work/..  -> <repo>\work\..   /docs/.. -> <repo>\docs\..   /anim/.. -> <repo>\anim\..
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File serve.ps1 -Port 8800
param([int]$Port = 8800, [switch]$NoOpen)
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$repo = (Resolve-Path -LiteralPath (Join-Path $here '..\..\..')).Path
$work = Join-Path $repo 'work'
& (Join-Path $here 'prepare_release.ps1')
$types = @{
  '.html'='text/html; charset=utf-8'; '.mjs'='text/javascript'; '.js'='text/javascript'; '.json'='application/json'
  '.wav'='audio/wav'; '.ogg'='audio/ogg'; '.mp3'='audio/mpeg'; '.ttf'='font/ttf'; '.woff2'='font/woff2'
  '.png'='image/png'; '.jpg'='image/jpeg'; '.jpeg'='image/jpeg'; '.webp'='image/webp'; '.svg'='image/svg+xml'
  '.wasm'='application/wasm'; '.obj'='text/plain; charset=utf-8'; '.css'='text/css'; '.webm'='video/webm'; '.mp4'='video/mp4'
}
$listener = $null
for ($p = $Port; $p -lt $Port + 20; $p++) {
  $l = New-Object System.Net.HttpListener
  $l.Prefixes.Add("http://127.0.0.1:$p/")
  try { $l.Start(); $listener = $l; $Port = $p; break } catch { $l.Close() }
}
if (-not $listener) { Write-Host 'Could not open a local port (8800-8819 are all busy).'; exit 1 }
$url = "http://127.0.0.1:$Port/game_demo/play/index.html"
Write-Host "Pachikoma is running: $url"
Write-Host 'Close this window to stop.'
if (-not $NoOpen) { Start-Process $url }
while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $res = $ctx.Response
  try {
    $req = $ctx.Request
    $path = [System.Uri]::UnescapeDataString($req.Url.AbsolutePath)
    if ($req.HttpMethod -eq 'POST' -and $path -eq '/api/medal-log') { $res.StatusCode = 204; $res.Close(); continue }
    if ($path.StartsWith('/work/')) { $path = $path.Substring(5) }
    if ($path.StartsWith('/docs/')) { $root = Join-Path $repo 'docs'; $rel = $path.Substring(6) }
    elseif ($path.StartsWith('/anim/')) { $root = $repo; $rel = $path.TrimStart('/') }
    else { $root = $work; $rel = $path.TrimStart('/') }
    $full = [System.IO.Path]::GetFullPath((Join-Path $root ($rel -replace '/', '\')))
    if (-not $full.StartsWith($root + '\', [System.StringComparison]::OrdinalIgnoreCase)) { $res.StatusCode = 403; $res.Close(); continue }
    if (-not [System.IO.File]::Exists($full)) { $res.StatusCode = 404; $res.Close(); continue }
    $bytes = [System.IO.File]::ReadAllBytes($full)
    $ext = [System.IO.Path]::GetExtension($full).ToLowerInvariant()
    if ($types.ContainsKey($ext)) { $res.ContentType = $types[$ext] } else { $res.ContentType = 'application/octet-stream' }
    $res.Headers.Add('Cache-Control', 'no-store')
    $res.ContentLength64 = $bytes.Length
    $res.OutputStream.Write($bytes, 0, $bytes.Length)
    $res.Close()
  } catch {
    try { $res.StatusCode = 500; $res.Close() } catch { }
  }
}
