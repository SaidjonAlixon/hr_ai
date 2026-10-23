# Ofis PC → VPS reverse tunnel: VPS 127.0.0.1:13443 = Face ID 192.168.3.102:443
# Ishga tushirish: powershell -ExecutionPolicy Bypass -File scripts/hikvision-device-tunnel.ps1
$ErrorActionPreference = "Stop"
$Key = Join-Path $env:USERPROFILE ".ssh\id_ed25519_hr_vps"
$Vps = "root@189.74.99.250"
$LocalDevice = "192.168.3.102:443"
$RemotePort = 13443

Write-Host "Hikvision tunnel: VPS :$RemotePort -> $LocalDevice"
while ($true) {
  try {
    ssh -i $Key -o BatchMode=yes -o ServerAliveInterval=30 -o ExitOnForwardFailure=yes `
      -N -R "127.0.0.1:${RemotePort}:${LocalDevice}" $Vps
  } catch {
    Write-Host "Tunnel uzildi, 5s dan keyin qayta..."
  }
  Start-Sleep -Seconds 5
}
