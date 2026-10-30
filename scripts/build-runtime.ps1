# Rebuild the checked-in browser runtime after changing count-tokens.inc.
# Emscripten and all downloaded sources stay in the ignored .tools folder.
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
$root = (Get-Location).Path
$tools = Join-Path $root '.tools'
$source = Join-Path $tools 'wllama-runtime'
$sdk = Join-Path $tools 'emsdk'
New-Item -ItemType Directory -Force $tools, $source | Out-Null
if (!(Test-Path "$sdk/emsdk.bat")) {
    git clone --depth 1 https://github.com/emscripten-core/emsdk.git $sdk
    if ($LASTEXITCODE) { throw 'Could not clone Emscripten SDK.' }
}
$env:EMSDK_PYTHON = (Resolve-Path '.conda/python.exe').Path
& "$sdk/emsdk.bat" install 4.0.20
if ($LASTEXITCODE) { throw 'Could not install Emscripten 4.0.20.' }
& "$sdk/emsdk.bat" activate 4.0.20 --embedded
if ($LASTEXITCODE) { throw 'Could not activate the local SDK.' }
$env:EM_CONFIG = "$sdk/.emscripten"
$env:EMSDK = $sdk
$env:Path = "$sdk;$sdk/upstream/emscripten;$sdk/upstream/bin;$root/.conda/Scripts;$root/.conda;$env:Path"
if (!(Get-Command ninja -ErrorAction SilentlyContinue)) {
    & '.conda/python.exe' -m pip install ninja==1.13.2
    if ($LASTEXITCODE) { throw 'Could not install Ninja in .conda.' }
}
if (!(Test-Path "$source/llama.cpp/CMakeLists.txt")) {
    $archive = "$tools/llama-46ca246.tar.gz"
    Invoke-WebRequest 'https://codeload.github.com/ggml-org/llama.cpp/tar.gz/46ca246' -OutFile $archive
    if ((Get-FileHash $archive -Algorithm SHA256).Hash -ne '408101465FCD32AEEEC4CAEA7DD1831D2BF48CA4E2394D2B86670B6BC8915516') { throw 'Unexpected llama.cpp source checksum.' }
    tar -xf $archive -C $source
    if ($LASTEXITCODE) { throw 'Could not extract llama.cpp.' }
    Rename-Item -LiteralPath "$source/llama.cpp-46ca246" -NewName 'llama.cpp'
}
New-Item -ItemType Directory -Force "$source/cpp" | Out-Null
Copy-Item -Recurse -Force 'node_modules/@wllama/wllama/cpp/*' "$source/cpp"
Copy-Item 'node_modules/@wllama/wllama/CMakeLists.txt' "$source/CMakeLists.txt"
# Do not alter the installed npm package. Apply the extension's addition only
# to the isolated build source, retaining the existing GLUE wire format.
$cpp = Get-Content "$source/cpp/wllama.cpp" -Raw
$cpp = $cpp.Replace('WLLAMA_ACTION(completion)', 'WLLAMA_ACTION(completion)' + "`n    WLLAMA_ACTION(count_tokens)")
Set-Content "$source/cpp/wllama.cpp" $cpp -NoNewline
$header = Get-Content "$source/cpp/wllama-context.h" -Raw
$method = Get-Content 'runtime/wllama/count-tokens.inc' -Raw
$header = $header.Replace('  glue_msg_completion_res action_completion', "$method`n  glue_msg_completion_res action_completion")
Set-Content "$source/cpp/wllama-context.h" $header -NoNewline
$dawn = "$tools/emdawn/emdawnwebgpu_pkg"
if (!(Test-Path $dawn)) {
    Invoke-WebRequest 'https://github.com/google/dawn/releases/download/v20260317.182325/emdawnwebgpu_pkg-v20260317.182325.zip' -OutFile "$tools/emdawn.zip"
    Expand-Archive -LiteralPath "$tools/emdawn.zip" -DestinationPath "$tools/emdawn" -Force
}
Push-Location $source
try {
    & "$sdk/upstream/emscripten/emcmake.bat" cmake -S $source -B "$source/build" -G Ninja '-DCMAKE_BUILD_TYPE=Release' '-DGGML_WEBGPU=ON' '-DGGML_WEBGPU_JSPI=ON' "-DEMDAWNWEBGPU_DIR=$dawn" '-DLLAMA_BUILD_NUMBER=11364' '-DLLAMA_BUILD_COMMIT=46ca246' '-DLLAMA_BUILD_TESTS=OFF' '-DLLAMA_BUILD_EXAMPLES=OFF' '-DLLAMA_BUILD_SERVER=OFF'
    if ($LASTEXITCODE) { throw 'Runtime configuration failed.' }
    cmake --build "$source/build" --target wllama --parallel 8
    if ($LASTEXITCODE) { throw 'Runtime compilation failed.' }
    & "$root/.conda/node.exe" "$root/node_modules/@wllama/wllama/scripts/build_source_map.js" --input default:build --output "$root/runtime/wllama/source-map.ts"
    if ($LASTEXITCODE) { throw 'Runtime debug map generation failed.' }
} finally { Pop-Location }
Copy-Item "$source/build/wllama.wasm", "$source/build/wllama.js" 'runtime/wllama/'
Copy-Item "$source/llama.cpp/LICENSE" 'runtime/wllama/LLAMA-LICENSE'
Copy-Item 'node_modules/@wllama/wllama/LICENCE' 'runtime/wllama/WLLAMA-LICENSE'
Get-FileHash runtime/wllama/wllama.wasm -Algorithm SHA256
