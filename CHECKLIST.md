# ✅ Captive Portal & Wi-Fi Marketing Gateway: Deployment Checklist

Use this checklist to verify your setup, launch the captive portal, and test the customer journey from connection to lead capture.

---

## 📋 1. Prerequisites & Environment Check

- [ ] **Node.js Installed:** Node.js version is `>= 22.5.0` (required for native `node:sqlite`).
  ```bash
  node -v
  ```
- [ ] **Network Interface:** PC has an active internet connection to share (via Ethernet cable or secondary Wi-Fi) and a functional Wi-Fi adapter.
- [ ] **Port 80 Availability:**
  - IIS (`W3SVC`) is stopped or disabled.
  - Windows MultiPoint (`Wms`) is stopped (or will be automatically paused by `start.bat`).
  ```powershell
  # Permanent release command (PowerShell as Administrator)
  Set-Service -Name W3SVC, Wms, WmsRepair -StartupType Disabled -ErrorAction SilentlyContinue
  Stop-Service -Name W3SVC, Wms, WmsRepair -ErrorAction SilentlyContinue
  ```

---

## ⚙️ 2. Configuration (`server.js`)

Open [`server.js`](server.js) and verify the `CONFIG` block:

- [ ] **Branding:** `businessName` reflects your business or venue name.
- [ ] **Offer Text:** `promoHeadline` and `promoSubtext` present an attractive offer or discount for joining.
- [ ] **Destination Link:** `redirectUrl` points to your Google Review page, Instagram, website, or menu.
- [ ] **Hotspot Settings:**
  - `hotspot.autoStart`: Set to `true` for automatic activation on Windows.
  - `hotspot.ssid`: Network name guests will look for (e.g. `Smart Computer Guest`).
  - `hotspot.password`: Minimum 8 characters (required by Windows WPA2, e.g. `11111111`).

---

## 🚀 3. Launch Checklist

- [ ] **Launch via Elevated Launcher:**
  - Right-click [`start.bat`](start.bat) and choose **"Run as administrator"** (or double-click and accept UAC).
- [ ] **Verify Terminal Output:**
  - Hotspot status confirmed: `✓ Hotspot is running.`
  - Firewall status confirmed: `✓ Unauthorized clients are BLOCKED from internet.`
  - Hosts redirect confirmed: `✓ Redirected mobile probe domains to 192.168.137.1...`
  - Web Server listening on standard HTTP **Port 80** (or Port 8080 fallback).
  - Admin links displayed:
    - Dashboard: `http://localhost/admin`
    - CSV Export: `http://localhost/admin/export.csv`

---

## 📱 4. Guest Mobile Device Testing

Test with a smartphone (Android / iPhone):

- [ ] **Connect to Wi-Fi:** Open Wi-Fi settings and connect to your SSID (e.g. `Smart Computer Guest`).
- [ ] **Automatic Pop-Up:** Within 2–5 seconds, the phone displays the **"Sign into Wi-Fi network"** notification or automatically pops open the portal browser screen.
- [ ] **Internet Isolation Test:** Before submitting the form, attempt to open any non-portal web page or app; confirm traffic is blocked by firewall.
- [ ] **Form Submission:**
  - Fill in **Full Name** and a valid **WhatsApp / Mobile Number**.
  - Submit the form &rarr; Verify the success screen appears ("You're Connected!").
- [ ] **Internet Unlocked:** Confirm the phone is now able to browse the internet, stream, and use apps.
- [ ] **Redirection:** Confirm the phone redirects to your configured `redirectUrl`.

---

## 📊 5. Marketing Admin & Leads Verification

- [ ] **Admin Dashboard:** Open [http://localhost/admin](http://localhost/admin) in your PC browser.
- [ ] **Lead Verification:** Verify the newly submitted contact appears at the top of the table with Name, Phone, and Timestamp.
- [ ] **Direct WhatsApp Contact:** Click the green **"💬 Chat WhatsApp"** button next to the lead to confirm it opens a direct WhatsApp chat window.
- [ ] **CSV Export:** Click **"📥 Download Leads (CSV / Excel)"** to download `wifi_marketing_leads.csv` and ensure all rows are formatted properly for CRM import.
- [ ] **Revoke Access (Optional):** Click **"Revoke"** next to a client IP to test immediately revoking their internet access.

---

## 🛑 6. Shutdown & Cleanup

- [ ] **Stop Server Gracefully:** Press <kbd>Ctrl</kbd> + <kbd>C</kbd> in the console.
- [ ] **Firewall Cleanup:** Confirmed `CaptivePortal-*` firewall rules are automatically removed from Windows Defender Firewall.
- [ ] **Hosts Cleanup:** Confirmed captive portal probe domains are removed from `C:\Windows\System32\drivers\etc\hosts`.
- [ ] **Hotspot Stopped:** Turn off hotspot via console or Windows Quick Settings if no longer needed.

---

## 🔍 Troubleshooting Quick Reference

| Issue | Root Cause | Solution |
| :--- | :--- | :--- |
| **Port 80 error / EADDRINUSE** | IIS (`W3SVC`) or MultiPoint (`Wms`) is running | Run `start.bat` as Administrator (it pauses them automatically) or run the permanent disable command in Step 1. |
| **No auto-popup on mobile** | Mobile probe domains not resolving to `192.168.137.1` | Run `start.bat` as Administrator so it has permission to update the Windows `hosts` file and flush DNS. |
| **Guests have internet before login** | Windows Firewall rules not initialized | Must run elevated (as Administrator) for Windows Defender Firewall API access. |
| **Hotspot fails to turn on** | PC has no active internet connection or Wi-Fi is disabled | Ensure PC Wi-Fi is switched ON and connected to internet (or plugged into Ethernet). |
