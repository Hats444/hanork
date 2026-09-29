# Script para gerar APK Hanork Panel (Windows)
# Requer: Git, JDK 17+, Android SDK (via Android Studio ou cmdline-tools)
#
# Uso: powershell -ExecutionPolicy Bypass -File scripts/build-apk.ps1

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Panel = Join-Path $Root "hanork_panel"
$Tools = Join-Path $Root ".tools"
$FlutterDir = Join-Path $Tools "flutter"

function Ensure-Flutter {
    if (Get-Command flutter -ErrorAction SilentlyContinue) {
        return (Get-Command flutter).Source
    }
    if (-not (Test-Path "$FlutterDir\bin\flutter.bat")) {
        Write-Host "[*] Baixando Flutter SDK (stable)..."
        New-Item -ItemType Directory -Force -Path $Tools | Out-Null
        if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
            throw "Git nao encontrado. Instale Git ou Flutter manualmente."
        }
        git clone https://github.com/flutter/flutter.git -b stable --depth 1 $FlutterDir
    }
    return "$FlutterDir\bin\flutter.bat"
}

$flutter = Ensure-Flutter
$env:Path = "$(Split-Path $flutter);$env:Path"

Push-Location $Panel
try {
    if (-not (Test-Path "android")) {
        Write-Host "[*] Criando projeto Android..."
        & $flutter create . --org com.hanork --project-name hanork_panel --platforms=android
    }

    Write-Host "[*] flutter pub get..."
    & $flutter pub get

    Write-Host "[*] flutter doctor (verifique Android SDK)..."
    & $flutter doctor -v

    Write-Host "[*] Gerando APK release..."
    & $flutter build apk --release

    $apk = Join-Path $Panel "build\app\outputs\flutter-apk\app-release.apk"
    $out = Join-Path $Panel "hanork-panel-release.apk"
    if (Test-Path $apk) {
        Copy-Item $apk $out -Force
        Write-Host ""
        Write-Host "APK pronto:" -ForegroundColor Green
        Write-Host $out
    } else {
        throw "APK nao gerado. Instale Android Studio ou SDK e aceite licencas: flutter doctor --android-licenses"
    }
} finally {
    Pop-Location
}
