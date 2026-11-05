# 🎯 Wi-Fi Captive Portal & Marketing Gateway

A lightweight, zero-dependency Wi-Fi Captive Portal and Marketing Gateway written in pure Node.js. Collect customer leads (Name & WhatsApp / Phone numbers) in exchange for free Wi-Fi access at venues, cafes, retail stores, events, or via mobile hotspots.

Designed to run smoothly on **Windows 10/11**, Linux servers, Raspberry Pi, or directly on Android devices via **Termux**.

---

## ✨ Features

- **📶 Windows Hotspot Automation:** Automatically switches on your Windows Mobile Hotspot and configures SSID & passphrase when starting the project.
- **🛡️ Windows Defender Firewall Client Isolation:** Blocks unauthorized guest devices from browsing the internet until they submit their lead via the portal.
- **📱 Automatic Mobile Sign-In Popups:** Responds to standard network probe endpoints and redirects mobile probe domains to trigger instant OS captive login prompts on:
  - **Android / Google Chrome:** `/generate_204`, `connectivitycheck.gstatic.com`, `clients3.google.com`
  - **Apple iOS / macOS / iPadOS:** CNA `/hotspot-detect.html`, `captive.apple.com`
  - **Samsung Galaxy:** `connectivity.samsung.com`
  - **Xiaomi / Redmi / MIUI / HyperOS:** `connect.rom.miui.com`
  - **Huawei / Honor:** `connectivitycheck.platform.hicloud.com`
  - **Windows:** `/ncsi.txt`, `/connecttest.txt`, `www.msftconnecttest.com`
- **🚀 Zero NPM Dependencies:** Powered entirely by Node.js built-in modules (`node:http`, `node:net`, `node:sqlite`, `node:os`, `node:child_process`). No `node_modules` required!
- **🌐 Standard WHATWG URL API:** Built to modern Node.js standards without deprecated legacy methods.
- **🗄️ Native SQLite Storage:** Persists customer leads locally in SQLite using Node.js's built-in `node:sqlite` (`DatabaseSync`).
- **📊 Real-Time Admin Dashboard:** View collected leads, monitor connected IPs, and revoke device access with one click at `/admin`.
- **💬 Direct WhatsApp Chat Links:** Instantly start WhatsApp conversations with connected customers directly from the dashboard.
- **📥 1-Click CSV/Excel Export:** Export lead datasets anytime via `/admin/export.csv` for CRM or marketing campaigns.
- **🛡️ Input Validation & Cleaning:** Automatically cleans phone number formats and filters out dummy/invalid entries.
- **🔄 Port 80 with Auto-Fallback:** Operates directly on standard HTTP Port 80 for native captive portal detection, with automatic fallback to Port 8080 if Port 80 is occupied.

---

## 📋 Requirements

- **Node.js >= 22.5.0** (requires native `node:sqlite` support)
- Compatible with Windows 10/11, Linux, macOS, Raspberry Pi, and Android (Termux)
- See [`CHECKLIST.md`](CHECKLIST.md) for full pre-flight verification steps.

---

## 🚀 Quick Start

### 1. Clone the Repository
```bash
git clone https://github.com/jQsafi/captive-portal.git
cd captive-portal
```

### 2. Start the Server

#### On Windows:
Right-click `start.bat` and click **Run as administrator** (or double-click `start.bat` and accept the UAC prompt):
```cmd
start.bat
```
*(When prompted for Administrator privileges, click **Yes** so Windows can activate the Mobile Hotspot, bind Port 80, apply firewall isolation rules, and configure auto-popup redirects).*

#### On Linux / Termux:
```bash
chmod +x start.sh
./start.sh
```

Upon launching, the terminal will display the active IP addresses, Hotspot credentials, and dashboard links:
```
====================================================
🎯 Wi-Fi Marketing Captive Portal running on Port 80
----------------------------------------------------
📶 Wi-Fi Hotspot SSID : Smart Computer Guest
🔑 Wi-Fi Password     : 11111111
----------------------------------------------------
  [Local Area Connection* 10] http://192.168.137.1
  [Ethernet] http://192.168.0.97
----------------------------------------------------
📊 Marketing Dashboard: http://localhost/admin
📥 Download CSV Leads:  http://localhost/admin/export.csv
====================================================
```

---

## ⚙️ Configuration

You can customize the business name, marketing messaging, destination URL, and Hotspot settings in [`server.js`](server.js):

```javascript
const PORT = 80;

const CONFIG = {
  businessName: 'Smart Computer',
  promoHeadline: 'Welcome to Smart Computer! 🎁',
  promoSubtext: 'Enter your name and mobile number to unlock instant unlimited high-speed internet.',
  // Destination URL after user connects (e.g., website, Instagram, Google Reviews)
  redirectUrl: 'https://www.google.com',

  // Windows Hotspot Auto-Start Settings
  hotspot: {
    autoStart: true,
    ssid: 'Smart Computer Guest',
    // Note: Windows enforces minimum 8 characters (WPA2-Personal)
    password: '11111111'
  }
};
```

> [!NOTE]
> **Why does Windows require a password?**
> Microsoft's native Windows Mobile Hotspot system strictly enforces WPA2-Personal (AES) security, which requires a minimum of 8 characters. Setting a simple password (e.g., `11111111` or `12345678`) allows anyone to connect easily while remaining fully compliant with Windows wireless driver architecture.

---

## 📌 Available Endpoints

| Endpoint | Method | Description |
| :--- | :--- | :--- |
| `/` or `/portal` | `GET` | Captive portal login & lead capture page |
| `/auth/connect` | `POST` | Validates submission, stores lead in SQLite, and authorizes client IP |
| `/admin` | `GET` | Admin dashboard to view leads and connected devices |
| `/admin/export.csv` | `GET` | Downloads all leads as a CSV file |
| `/admin/revoke` | `POST` | Revokes internet access for a specified client IP |
| `/generate_204` | `GET` | Captive portal detection endpoint (Android / Chrome) |
| `/hotspot-detect.html` | `GET` | Captive portal detection endpoint (Apple iOS / macOS) |
| `/ncsi.txt` | `GET` | Captive portal detection endpoint (Windows) |

---

## 📂 Project Structure

```
captive-portal/
├── server.js          # Core HTTP server, captive portal logic, routing & proxy
├── hotspot.js         # Windows Mobile Hotspot automation controller
├── hotspot.ps1        # WinRT PowerShell script for Windows tethering
├── firewall.js        # Windows Defender Firewall access control controller
├── firewall.ps1       # PowerShell script managing outbound client isolation rules
├── hosts-manager.js   # Multi-vendor mobile probe DNS redirect manager
├── start.bat          # 1-click elevated Windows launcher (frees Port 80 & launches)
├── start.sh           # Shell launch script for Linux / Android
├── package.json       # Project metadata and npm scripts
├── CHECKLIST.md       # Pre-flight and deployment checklist
├── .gitignore         # Git ignore rules (excludes leads.db database & runtime files)
└── README.md          # Project documentation
```

---

## 📄 License

This project is open-source under the [MIT License](LICENSE).
