@echo off
title Analyze Indian Stocks like a Pro
echo ============================================
echo  Analyze Indian Stocks like a Pro
echo ============================================
echo.

:: Check Node.js
where node >nul 2>nul
if %errorlevel%==0 (
    echo [OK] Node.js found - starting server...
    echo.
    echo Open this link in your browser:
    echo   http://localhost:3000
    echo.
    start "" http://localhost:3000
    node "%~dp0server.js"
    goto end
)

:: Check Python
where python >nul 2>nul
if %errorlevel%==0 (
    echo [OK] Python found - starting server on port 8000
    echo.
    echo Open this link in your browser:
    echo   http://localhost:8000
    echo.
    start "" http://localhost:8000
    python -m http.server 8000 --directory "%~dp0"
    goto end
)

:: Fallback: PowerShell .NET server
echo [INFO] Starting PowerShell server on http://localhost:8080
echo Open this link in your browser:
echo   http://localhost:8080
start "" http://localhost:8080
powershell -NoProfile -ExecutionPolicy Bypass -Command "
$root = '%~dp0';
$port = 8080;
$listener = New-Object System.Net.HttpListener;
$listener.Prefixes.Add('http://localhost:' + $port + '/');
$listener.Start();
Write-Host 'Server running at http://localhost:' $port;
while ($listener.IsListening) {
    $ctx = $listener.GetContext();
    $req = $ctx.Request; $res = $ctx.Response;
    $res.Headers.Add('Access-Control-Allow-Origin', '*');
    $path = $req.Url.AbsolutePath;
    if ($path -eq '/' -or $path -eq '') { $path = '/index.html'; }

    # Proxy endpoint
    if ($path -eq '/proxy') {
        $target = $req.QueryString['url'];
        try {
            $wc = New-Object System.Net.WebClient;
            $wc.Headers.Add('User-Agent', 'Mozilla/5.0');
            $data = $wc.DownloadData($target);
            $res.ContentType = 'application/json';
            $res.OutputStream.Write($data, 0, $data.Length);
        } catch {
            $res.StatusCode = 502;
            $err = [Text.Encoding]::UTF8.GetBytes('{\"error\":\"' + $_.Exception.Message + '\"}');
            $res.OutputStream.Write($err, 0, $err.Length);
        }
        $res.Close();
        continue;
    }

    $file = Join-Path $root $path.TrimStart('/');
    if ($file -notlike ($root + '*')) { $res.StatusCode = 403; $res.Close(); continue; }
    if (Test-Path $file -PathType Leaf) {
        $content = [IO.File]::ReadAllBytes($file);
        $ext = [IO.Path]::GetExtension($file);
        $map = @{'.html'='text/html; charset=utf-8';'.css'='text/css';'.js'='application/javascript'};
        $res.ContentType = if ($map.ContainsKey($ext)) { $map[$ext] } else { 'application/octet-stream' };
        $res.OutputStream.Write($content, 0, $content.Length);
    } else { $res.StatusCode = 404; $msg = [Text.Encoding]::UTF8.GetBytes('404'); $res.OutputStream.Write($msg, 0, $msg.Length); }
    $res.Close();
}
"

:end
pause
