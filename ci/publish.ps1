[CmdletBinding()]param()
function main() {
  cd $PSScriptRoot
  cd ..

  # Build with the GitHub Pages subpath so asset URLs resolve under /fintool/.
  npx vite build --base=/fintool/ --emptyOutDir
  if ($LASTEXITCODE -ne 0) { throw "vite build failed" }

  $ver = Get-Content .\package.json | ConvertFrom-Json | Select-Object -ExpandProperty version
  $targetRel = "../cawoodm.github.io/fintool"

  if (-not (Test-Path $targetRel)) {
    # Create the subfolder in the github.io repo on first publish.
    New-Item -ItemType Directory -Path $targetRel | Out-Null
  }

  Push-Location $targetRel
  try {
    git pull
    if ($LASTEXITCODE -ne 0) { throw "GIT PULL Failed!" }

    # Wipe the target subfolder (the github.io repo's .git lives one level up,
    # so it's not affected).
    Get-ChildItem -Force | Remove-Item -Recurse -Force -Verbose

    Copy-Item ../../fintool/dist/* -Recurse ./ -Verbose

    git add .
    git commit -m "fintool-$ver-$(Get-Date -f yyyyMMddHHmm)"
    if ($LASTEXITCODE -ne 0) { Write-Warning "Nothing to commit (or commit failed)." }
    git push
    if ($LASTEXITCODE -ne 0) { throw "GIT PUSH Failed!" }
    start "https://cawoodm.github.io/fintool"
  } catch {
    throw $_
  } finally {
    Pop-Location
  }
}
$ErrorActionPreference = "Stop"
main
