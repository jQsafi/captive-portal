# 🎯 Wi-Fi Captive Portal & Marketing Gateway

A lightweight, zero-dependency Wi-Fi Captive Portal and Marketing Gateway written in pure Node.js. Collect customer leads (Name & WhatsApp / Phone numbers) in exchange for free Wi-Fi access at venues, cafes, retail stores, events, or via mobile hotspots.

Designed to run smoothly on Linux servers, Raspberry Pi, or directly on Android devices via **Termux**.

---

## ✨ Features

- **📱 Mobile-First Captive Portal:** Modern, sleek landing page optimized for smartphones and tablets.
- **🔍 OS Captive Portal Detection:** Responds to standard network probe endpoints for Android (`/generate_204`), iOS/macOS (`/hotspot-detect.html`), and Windows (`/ncsi.txt`, `/connecttest.txt`).
- **🚀 Zero NPM Dependencies:** Powered entirely by Node.js built-in modules (`node:http`, `node:net`, `node:url`, `node:sqlite`, `node:os`). No `node_modules` required!
- **🗄️ Native SQLite Storage:** Persists customer leads locally in SQLite using Node.js's built-in `node:sqlite` (`DatabaseSync`).
- **📊 Real-Time Admin Dashboard:** View collected leads, monitor connected IPs, and revoke device access with one click at `/admin`.
- **💬 Direct WhatsApp Chat Links:** Instantly start WhatsApp conversations with connected customers directly from the dashboard.
- **📥 1-Click CSV/Excel Export:** Export lead datasets anytime via `/admin/export.csv` for CRM or marketing campaigns.
- **🛡️ Input Validation & Cleaning:** Automatically cleans phone number formats and filters out dummy/invalid entries.
- **🌐 HTTP/HTTPS Forwarding:** Built-in proxy and HTTPS CONNECT tunneling for authenticated users.

---

## 📋 Requirements

- **Node.js >= 22.5.0** (requires native `node:sqlite` support)
- Compatible with Linux, macOS, Windows, Raspberry Pi, and Android (Termux)

---

## 🚀 Quick Start

### 1. Clone the Repository
```bash
git clone https://github.com/jQsafi/captive-portal.git
cd captive-portal
```

### 2. Start the Server
Make the start script executable and launch the server:
```bash
chmod +x start.sh
./start.sh
```
Or start directly with Node.js:
```bash
node server.js
```

Upon launching, the terminal will display the active IP addresses and ports:
```
====================================================
🎯 Wi-Fi Marketing Captive Portal running on Port 8080
----------------------------------------------------
  [wlan0] http://192.168.43.1:8080
----------------------------------------------------
📊 Marketing Dashboard: http://localhost:8080/admin
📥 Download CSV Leads:  http://localhost:8080/admin/export.csv
====================================================
```

---

## ⚙️ Configuration

You can easily customize the business name, marketing messaging, and redirect destinations in [`server.js`](server.js):

```javascript
const PORT = 8080;

const CONFIG = {
  businessName: 'Exclusive Free Wi-Fi',
  promoHeadline: 'Get Free High-Speed Wi-Fi & Exclusive Offers! 🎁',
  promoSubtext: 'Enter your name and mobile number to unlock instant unlimited internet and receive special discounts & VIP deals.',
  // Destination URL after user connects (e.g., website, Instagram, Google Maps review)
  redirectUrl: 'https://www.google.com'
};
```

---

## 🌐 Network & Hotspot Setup

To route guest devices through the captive portal:

### Option A: Mobile Hotspot (Termux / Android / Linux)
1. Turn on your mobile Wi-Fi Hotspot.
2. Note your gateway IP address (commonly `192.168.43.1`).
3. For connected clients, configure their Wi-Fi proxy settings to point to your IP on port `8080` (or use `iptables` redirect rules if rooted):
   ```bash
   iptables -t nat -A PREROUTING -p tcp --dport 80 -j REDIRECT --to-port 8080
   ```

### Option B: Router Redirection (OpenWrt / MikroTik / DD-WRT)
Configure your router's captive portal or firewall rules to forward unauthorized HTTP traffic on port `80` to `http://<SERVER_IP>:8080`.

---

## 📌 Available Endpoints

| Endpoint | Method | Description |
| :--- | :--- | :--- |
| `/` or `/portal` | `GET` | Captive portal login & lead capture page |
| `/auth/connect` | `POST` | Validates submission, stores lead, and authorizes client IP |
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
├── server.js          # Core server, captive portal logic, routing & proxy
├── start.sh           # Shell launch script
├── package.json       # Project metadata and npm scripts
├── .gitignore         # Git ignore rules (excludes leads.db database)
└── README.md          # Documentation
```

---

## 📄 License

This project is open-source under the [MIT License](LICENSE).
