param (
    [string]$Action = "start",
    [string]$Ssid = "Smart Computer Guest",
    [string]$Password = "11111111"
)

[Windows.Networking.Connectivity.NetworkInformation,Windows.Networking.Connectivity,ContentType=WindowsRuntime] | Out-Null
[Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager,Windows.Networking.NetworkOperators,ContentType=WindowsRuntime] | Out-Null
[Windows.Networking.NetworkOperators.NetworkOperatorTetheringOperationResult,Windows.Networking.NetworkOperators,ContentType=WindowsRuntime] | Out-Null

$conn = [Windows.Networking.Connectivity.NetworkInformation]::GetInternetConnectionProfile()
if (-not $conn) {
    Write-Error "No active internet connection found to share."
    exit 1
}

$mgr = [Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager]::CreateFromConnectionProfile($conn)

function Wait-WinRTAsync($async) {
    while ($async.Status -eq 0) {
        Start-Sleep -Milliseconds 100
    }
    if ($async.Status -eq 3) {
        throw "WinRT async error: $($async.ErrorCode)"
    }
}

switch ($Action.ToLower()) {
    "configure" {
        $cfg = $mgr.GetCurrentAccessPointConfiguration()
        if ($Ssid) { $cfg.Ssid = $Ssid }
        if ($Password -and $Password.Length -ge 8) { $cfg.Passphrase = $Password }
        $action = $mgr.ConfigureAccessPointAsync($cfg)
        Wait-WinRTAsync $action
        Write-Output "Hotspot configured: SSID='$($cfg.Ssid)'"
    }
    "start" {
        # Configure first if specified
        $cfg = $mgr.GetCurrentAccessPointConfiguration()
        $needConfig = $false
        if ($Ssid -and $cfg.Ssid -ne $Ssid) { $cfg.Ssid = $Ssid; $needConfig = $true }
        if ($Password -and $Password.Length -ge 8 -and $cfg.Passphrase -ne $Password) { $cfg.Passphrase = $Password; $needConfig = $true }
        if ($needConfig) {
            $act = $mgr.ConfigureAccessPointAsync($cfg)
            Wait-WinRTAsync $act
        }

        if ($mgr.TetheringOperationalState -ne 'On') {
            $op = $mgr.StartTetheringAsync()
            Wait-WinRTAsync $op
            Write-Output "Hotspot started: State=$($mgr.TetheringOperationalState)"
        } else {
            Write-Output "Hotspot is already ON"
        }
        $finalCfg = $mgr.GetCurrentAccessPointConfiguration()
        Write-Output "SSID: $($finalCfg.Ssid)"
        Write-Output "Password: $($finalCfg.Passphrase)"
    }
    "stop" {
        if ($mgr.TetheringOperationalState -eq 'On') {
            $op = $mgr.StopTetheringAsync()
            Wait-WinRTAsync $op
            Write-Output "Hotspot stopped: State=$($mgr.TetheringOperationalState)"
        } else {
            Write-Output "Hotspot is already OFF"
        }
    }
    "status" {
        $cfg = $mgr.GetCurrentAccessPointConfiguration()
        Write-Output "State: $($mgr.TetheringOperationalState)"
        Write-Output "SSID: $($cfg.Ssid)"
        Write-Output "Password: $($cfg.Passphrase)"
        Write-Output "ClientCount: $($mgr.ClientCount)"
    }
    default {
        Write-Error "Unknown action: $Action. Use start, stop, configure, or status."
    }
}
