# Analyze Indian Stocks like a Pro — Local Server + Proxy
# This script serves the app AND proxies Yahoo Finance API (bypasses CORS)
param([int]$Port = 8080)

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$hostname = "localhost"
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://${hostname}:${Port}/")
$listener.Start()

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host " Analyze Indian Stocks like a Pro" -ForegroundColor Yellow
Write-Host " Server running at http://${hostname}:${Port}" -ForegroundColor Green
Write-Host " Open this link in your browser!" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "Press Ctrl+C to stop" -ForegroundColor Gray
Write-Host ""

# Start browser
Start-Process "http://${hostname}:${Port}/"

while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $req = $ctx.Request
    $res = $ctx.Response
    $res.Headers.Add('Access-Control-Allow-Origin', '*')
    $res.Headers.Add('Access-Control-Allow-Methods', 'GET, OPTIONS')
    $res.Headers.Add('Access-Control-Allow-Headers', 'Content-Type')

    # Handle preflight
    if ($req.HttpMethod -eq 'OPTIONS') {
        $res.StatusCode = 204
        $res.Close()
        continue
    }

    $path = $req.Url.AbsolutePath

    # ---- PROXY ENDPOINT ----
    if ($path -eq '/proxy') {
        $targetUrl = $req.QueryString['url']
        if (-not $targetUrl) {
            $res.StatusCode = 400
            $msg = [Text.Encoding]::UTF8.GetBytes('{"error":"Missing ?url= parameter"}')
            $res.OutputStream.Write($msg, 0, $msg.Length)
        } else {
            try {
                Write-Host "  [PROXY] $targetUrl" -ForegroundColor DarkGray
                $wc = New-Object System.Net.WebClient
                $wc.Headers.Add('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36')
                $data = $wc.DownloadData($targetUrl)
                $res.ContentType = 'application/json'
                $res.OutputStream.Write($data, 0, $data.Length)
            } catch {
                $res.StatusCode = 502
                $err = @{error = "Proxy fetch failed: $($_.Exception.Message)"} | ConvertTo-Json
                $msg = [Text.Encoding]::UTF8.GetBytes($err)
                $res.OutputStream.Write($msg, 0, $msg.Length)
            }
        }
        $res.Close()
        continue
    }

    # ---- STATIC FILES ----
    if ($path -eq '/' -or $path -eq '') { $path = '/index.html' }
    $file = Join-Path $root $path.TrimStart('/')

    # Block directory traversal
    if ($file -notlike "$root*") {
        $res.StatusCode = 403
        $res.Close()
        continue
    }

    if (Test-Path $file -PathType Leaf) {
        $content = [IO.File]::ReadAllBytes($file)
        $ext = [IO.Path]::GetExtension($file)
        $mimeMap = @{
            '.html' = 'text/html; charset=utf-8'
            '.css'  = 'text/css'
            '.js'   = 'application/javascript'
            '.png'  = 'image/png'
            '.jpg'  = 'image/jpeg'
            '.json' = 'application/json'
            '.svg'  = 'image/svg+xml'
        }
        $res.ContentType = if ($mimeMap.ContainsKey($ext)) { $mimeMap[$ext] } else { 'application/octet-stream' }
        $res.OutputStream.Write($content, 0, $content.Length)
    } else {
        $res.StatusCode = 404
        $msg = [Text.Encoding]::UTF8.GetBytes('404 Not Found')
        $res.OutputStream.Write($msg, 0, $msg.Length)
    }
    $res.Close()
}

$listener.Stop()
