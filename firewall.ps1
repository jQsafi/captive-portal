param (
    [string]$Action = "status",
    [string]$Ip = "",
    [string]$AllowedIpsFile = ""
)

function Test-Admin {
    $currentPrincipal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    return $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-Admin)) {
    Write-Error "Administrator privileges required to manage Windows Defender Firewall."
    exit 1
}

$RULE_NAME = "CaptivePortal-Block-Unauthorized"
$ALLOW_DNS_UDP = "CaptivePortal-Allow-DNS-UDP"
$ALLOW_DNS_TCP = "CaptivePortal-Allow-DNS-TCP"
$ALLOW_HTTP_80 = "CaptivePortal-Allow-Portal-80"
$ALLOW_HTTP_8080 = "CaptivePortal-Allow-Portal-8080"

function Get-BlockedRanges($allowedList) {
    $allowedOctets = @()
    foreach ($item in $allowedList) {
        $trimmed = "$item".Trim()
        if ($trimmed -match '^192\.168\.137\.(\d+)$') {
            $allowedOctets += [int]$matches[1]
        }
    }
    $blockedNumbers = @()
    for ($i = 2; $i -le 254; $i++) {
        if (-not ($allowedOctets -contains $i)) {
            $blockedNumbers += $i
        }
    }
    if ($blockedNumbers.Count -eq 0) { return @() }
    
    $ranges = @()
    $start = $blockedNumbers[0]
    $prev = $start
    for ($idx = 1; $idx -lt $blockedNumbers.Count; $idx++) {
        $curr = $blockedNumbers[$idx]
        if ($curr -eq $prev + 1) {
            $prev = $curr
        } else {
            if ($start -eq $prev) { $ranges += "192.168.137.$start" }
            else { $ranges += "192.168.137.$start-192.168.137.$prev" }
            $start = $curr
            $prev = $curr
        }
    }
    if ($start -eq $prev) { $ranges += "192.168.137.$start" }
    else { $ranges += "192.168.137.$start-192.168.137.$prev" }
    return $ranges
}

function Update-BlockRule($allowedList) {
    $ranges = Get-BlockedRanges $allowedList
    if ($ranges.Count -eq 0) {
        # All IPs authorized, disable block rule
        Set-NetFirewallRule -DisplayName $RULE_NAME -Enabled False -ErrorAction SilentlyContinue
        Write-Output "All clients authorized. Block rule disabled."
        return
    }

    $existing = Get-NetFirewallRule -DisplayName $RULE_NAME -ErrorAction SilentlyContinue
    if (-not $existing) {
        New-NetFirewallRule -DisplayName $RULE_NAME `
            -Direction Outbound `
            -RemoteAddress $ranges `
            -Action Block `
            -Enabled True | Out-Null
    } else {
        Set-NetFirewallRule -DisplayName $RULE_NAME `
            -RemoteAddress $ranges `
            -Enabled True | Out-Null
    }
    Write-Output "Block rule updated: $([string]::Join(', ', $ranges))"
}

switch ($Action.ToLower()) {
    "init" {
        # 1. Ensure Host Inbound rules for DNS and Portal ports are active
        if (-not (Get-NetFirewallRule -DisplayName $ALLOW_DNS_UDP -ErrorAction SilentlyContinue)) {
            New-NetFirewallRule -DisplayName $ALLOW_DNS_UDP -Direction Inbound -Protocol UDP -LocalPort 53 -Action Allow | Out-Null
        }
        if (-not (Get-NetFirewallRule -DisplayName $ALLOW_DNS_TCP -ErrorAction SilentlyContinue)) {
            New-NetFirewallRule -DisplayName $ALLOW_DNS_TCP -Direction Inbound -Protocol TCP -LocalPort 53 -Action Allow | Out-Null
        }
        if (-not (Get-NetFirewallRule -DisplayName $ALLOW_HTTP_80 -ErrorAction SilentlyContinue)) {
            New-NetFirewallRule -DisplayName $ALLOW_HTTP_80 -Direction Inbound -Protocol TCP -LocalPort 80 -Action Allow | Out-Null
        }
        if (-not (Get-NetFirewallRule -DisplayName $ALLOW_HTTP_8080 -ErrorAction SilentlyContinue)) {
            New-NetFirewallRule -DisplayName $ALLOW_HTTP_8080 -Direction Inbound -Protocol TCP -LocalPort 8080 -Action Allow | Out-Null
        }

        # 2. Block all 192.168.137.2-254 by default
        Update-BlockRule @()
        Write-Output "Firewall initialized: Unauthorized hotspot internet blocked."
    }

    "sync" {
        # Sync from an array or file of allowed IPs
        $allowed = @()
        if ($AllowedIpsFile -and (Test-Path $AllowedIpsFile)) {
            $allowed = Get-Content $AllowedIpsFile | Where-Object { $_.Trim() -ne "" }
        } elseif ($Ip) {
            $allowed = $Ip -split ','
        }
        Update-BlockRule $allowed
    }

    "allow" {
        if (-not $Ip) { Write-Error "Must provide -Ip"; exit 1 }
        # Read current allowed from file or query existing
        $allowed = @($Ip)
        if ($AllowedIpsFile -and (Test-Path $AllowedIpsFile)) {
            $existing = Get-Content $AllowedIpsFile | Where-Object { $_.Trim() -ne "" }
            $allowed = @($existing; $Ip) | Select-Object -Unique
            $allowed | Out-File -FilePath $AllowedIpsFile -Encoding utf8
        }
        Update-BlockRule $allowed
        Write-Output "Authorized IP $Ip: Internet access granted."
    }

    "revoke" {
        if (-not $Ip) { Write-Error "Must provide -Ip"; exit 1 }
        $allowed = @()
        if ($AllowedIpsFile -and (Test-Path $AllowedIpsFile)) {
            $allowed = Get-Content $AllowedIpsFile | Where-Object { $_.Trim() -ne "" -and $_.Trim() -ne $Ip.Trim() }
            $allowed | Out-File -FilePath $AllowedIpsFile -Encoding utf8
        }
        Update-BlockRule $allowed
        Write-Output "Revoked IP $Ip: Internet access blocked."
    }

    "cleanup" {
        Get-NetFirewallRule -DisplayName "CaptivePortal-*" -ErrorAction SilentlyContinue | Remove-NetFirewallRule
        Write-Output "All CaptivePortal firewall rules removed."
    }

    default {
        Write-Output "Usage: firewall.ps1 -Action [init | allow | revoke | sync | cleanup] [-Ip <ip>] [-AllowedIpsFile <path>]"
    }
}
