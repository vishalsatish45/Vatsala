# Laptop Postgres for building the Supabase schema before it goes to the cloud.
# Uses its own data folder and port.
#
#   .\scripts\laptop-db.ps1 init      # one-time: create the cluster (trust auth, listens on localhost only)
#   .\scripts\laptop-db.ps1 start     # start Postgres on port 55500
#   .\scripts\laptop-db.ps1 stop      # stop it (harmless either way before shutting the laptop)
#   .\scripts\laptop-db.ps1 status
#   .\scripts\laptop-db.ps1 reset     # drop + recreate mch_dev: shim -> migrations -> seed -> tests
#   .\scripts\laptop-db.ps1 test      # re-run supabase/tests against the current mch_dev
#   .\scripts\laptop-db.ps1 psql      # interactive shell on mch_dev
#
# Synthetic data only. The shim (supabase/laptop) fakes the bits of Supabase that plain Postgres lacks
# (auth.users, auth.uid(), API roles) and is never applied to a Supabase project.
param([ValidateSet("init", "start", "stop", "status", "reset", "test", "perf", "psql")][string]$Action = "status")

$ErrorActionPreference = "Stop"
$PgBin = "C:\Program Files\PostgreSQL\17\bin"
$Root = Join-Path $HOME "healthathon-laptop-db"
$Data = Join-Path $Root "data"
$Log = Join-Path $Root "postgres.log"
$Port = 55500
$Db = "mch_dev"
$Supa = Join-Path (Split-Path $PSScriptRoot -Parent) "supabase"

function Invoke-Psql([string]$Database, [string[]]$PsqlArgs) {
  & "$PgBin\psql.exe" -h localhost -p $Port -U postgres -d $Database -X -q -v ON_ERROR_STOP=1 @PsqlArgs
  if ($LASTEXITCODE -ne 0) { throw "psql failed ($LASTEXITCODE): $($PsqlArgs -join ' ')" }
}

function Invoke-SqlDir([string]$Dir, [string[]]$Extra = @()) {
  if (-not (Test-Path $Dir)) { return }
  Get-ChildItem $Dir -Filter *.sql | Sort-Object Name | ForEach-Object {
    Write-Host "  $($_.Directory.Name)/$($_.Name)"
    Invoke-Psql $Db (@("-f", $_.FullName) + $Extra)
  }
}

# Test query results go to a log; \echo lines and errors still reach the console.
function Invoke-Tests { Invoke-SqlDir (Join-Path $Supa "tests") @("-o", (Join-Path $Root "tests.out")) }

switch ($Action) {
  "init" {
    if (Test-Path $Data) { throw "$Data already exists" }
    New-Item -ItemType Directory -Force $Root | Out-Null
    & "$PgBin\initdb.exe" -D $Data -U postgres -A trust -E UTF8 --no-locale
    if ($LASTEXITCODE -ne 0) { throw "initdb failed" }
  }
  # Started in its own hidden console: the server outlives this script, and on Windows its backends die with
  # 0xC0000142 if the console they inherited goes away (e.g. when started from an editor or agent terminal).
  # WaitForExit() (not -Wait, which also waits for the server child) waits for pg_ctl only.
  "start" {
    $p = Start-Process -FilePath "$PgBin\pg_ctl.exe" -WindowStyle Hidden -PassThru `
      -ArgumentList @("-D", "`"$Data`"", "-l", "`"$Log`"", "-o", "`"-p $Port -c listen_addresses=localhost`"", "-w", "start")
    $p.WaitForExit()
    & "$PgBin\pg_ctl.exe" -D $Data status
  }
  "stop" { & "$PgBin\pg_ctl.exe" -D $Data -m fast -w stop }
  "status" { & "$PgBin\pg_ctl.exe" -D $Data status }
  "reset" {
    Write-Host "Recreating $Db on port $Port"
    Invoke-Psql "postgres" @("-c", "drop database if exists $Db with (force)")
    Invoke-Psql "postgres" @("-c", "create database $Db")
    Invoke-SqlDir (Join-Path $Supa "laptop")
    Invoke-SqlDir (Join-Path $Supa "migrations")
    Write-Host "  seed.sql"
    Invoke-Psql $Db @("-f", (Join-Path $Supa "seed.sql"))
    Invoke-Tests
    Write-Host "Done: $Db is fresh and all tests passed."
  }
  "test" { Invoke-Tests; Write-Host "All tests passed." }
  # Volume + RLS timing probe; prints query plans, rolls everything back.
  "perf" { Get-ChildItem (Join-Path $Supa "perf") -Filter *.sql | Sort-Object Name | ForEach-Object { Invoke-Psql $Db @("-f", $_.FullName) } }
  "psql" { & "$PgBin\psql.exe" -h localhost -p $Port -U postgres -d $Db }
}
