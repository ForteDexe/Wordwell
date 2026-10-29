$ErrorActionPreference = 'Stop'
$env:Path = "$PSScriptRoot\.conda;$PSScriptRoot\.conda\Library\bin;$env:Path"
Push-Location $PSScriptRoot
try { npm start } finally { Pop-Location }
