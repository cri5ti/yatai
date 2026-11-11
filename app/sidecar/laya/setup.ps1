# Sets up the Laya decision-model helper that sorts emails (see design/plugins.md, "Emails").
# A Python 3.12 virtual environment in %LOCALAPPDATA%\yatai\laya with CPU-only PyTorch and laya.
# Re-run to update. The model checkpoints download on first use (Hugging Face cache).
#   powershell -ExecutionPolicy Bypass -File app\sidecar\laya\setup.ps1
$ErrorActionPreference = 'Stop'
$dir = Join-Path $env:LOCALAPPDATA 'yatai\laya'
New-Item -ItemType Directory -Force $dir | Out-Null

$uv = (Get-Command uv -ErrorAction SilentlyContinue).Source
if (-not $uv) {
  Write-Host 'uv not found: installing it for this user (pip install --user uv)'
  python -m pip install --user --quiet uv
  $uv = (python -c "import sysconfig,os;print(os.path.join(sysconfig.get_path('scripts', f'{os.name}_user'),'uv.exe'))").Trim()
}
& $uv venv --python 3.12 --allow-existing (Join-Path $dir '.venv')
$py = Join-Path $dir '.venv\Scripts\python.exe'
& $uv pip install --python $py --index-url https://download.pytorch.org/whl/cpu torch
& $uv pip install --python $py laya
& $py -c "import laya, torch; print('laya', getattr(laya, '__version__', '?'), '| torch', torch.__version__)"
Write-Host "Ready: $py"
