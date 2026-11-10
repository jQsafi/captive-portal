# 🧠 AI Context & Project Deep-Dive: Wi-Fi Captive Portal & Marketing Gateway

> **Status:** Active Knowledge Base & Technical Blueprint  
> **Target Audience:** AI Coding Assistants & Developers  
> **Last Updated:** November 2026

---

## 1. 📌 Executive Project Summary

This project is a **lightweight, zero-dependency Wi-Fi Captive Portal and Marketing Gateway** built entirely with pure Node.js. It operates as an on-premise captive portal designed to run on a host PC (primarily **Windows 10/11**, with fallback capabilities for Linux/Termux/Raspberry Pi) that acts as a Wi-Fi Hotspot.

### Core Value Proposition
Venues, retail shops, cafes, and event organizers share free high-speed Wi-Fi in exchange for customer contact leads (Full Name and WhatsApp / Mobile phone number). The system stores leads in an embedded database and automatically unblocks internet access for verified guests while providing a real-time marketing dashboard.

---

## 2. 🏗️ System Architecture & Mechanics

```
                  ┌──────────────────────────────────────────────┐
                  │           Guest Mobile Device                │
                  │ (Android / iOS / macOS / Windows / HyperOS)  │
                  └──────────────────────┬───────────────────────┘
                                         │ 1. Connects to Wi-Fi SSID
                                         ▼
                  ┌──────────────────────────────────────────────┐
                  │       Windows Mobile Hotspot (WinRT)         │
                  │   SSID: e.g. "Smart Computer Guest"          │
                  │   Gateway IP: 192.168.137.1                  │
                  └──────────────────────┬───────────────────────┘
                                         │ 2. OS triggers captive probe
                                         │    (e.g., /generate_204)
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│ Host Machine (Pure Node.js Runtime >= 22.5.0)                                    │
│                                                                                 │
│  [hosts-manager.js] ──► Hijacks probe domains (connectivitycheck.gstatic.com,   │
│                         captive.apple.com, etc.) to 192.168.137.1               │
│                                                                                 │
│  [firewall.js]      ──► Manages Windows Defender Firewall outbound rules:       │
│                         Blocks unauthorized IPs; Allows authenticated IPs.      │
│                                                                                 │
│  [server.js]        ──► Native Node HTTP Server (Port 80 / fallback 8080):      │
│                         • Serves Captive Portal UI (/)                          │
│                         • Handles Leads Form (/auth/connect)                    │
│                         • Serves Admin Directory (/admin)                       │
│                         • Adds Customer Record (/admin/customer/add)            │
│                         • Edits Customer Record (/admin/customer/edit)          │
│                         • Deletes Customer Record (/admin/customer/delete)      │
│                         • Exports CSV (/admin/export.csv)                       │
│                         • Revokes IPs (/admin/revoke)                           │
│                                                                                 │
│  [templates.js]     ──► In-memory caching view engine for HTML/CSS/JS templates │
│  [templates/]       ──► Modular HTML files: portal.html, success.html, admin.html│
│  [leads.db]         ──► Native node:sqlite database (DatabaseSync)              │
│  [customers/]       ──► Local folder directory named by customer mobile number  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Key Technical Pillars
1. **Zero External NPM Dependencies (`node_modules` = 0):**  
   - Relies strictly on Node.js core modules: `node:http`, `node:net`, `node:os`, `node:path`, `node:fs`, `node:child_process`, and `node:sqlite` (`DatabaseSync`).
   - Requires Node.js `>= 22.5.0` for built-in SQLite support.
2. **Windows Hotspot Automation (`hotspot.js` + `hotspot.ps1`):**  
   - Automatically activates Windows 10/11 Mobile Hotspot via WinRT API (`Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager`).
3. **Outbound Firewall Isolation (`firewall.js` + `firewall.ps1`):**  
   - Uses Windows Defender Firewall rules (`CaptivePortal-BlockGuests`, `CaptivePortal-AllowAuthorized`).
   - Unauthenticated guest devices are blocked from internet access while still having local access to Port 80 on the host machine.
4. **Captive Probe Hijacking (`hosts-manager.js`):**  
   - Modifies `C:\Windows\System32\drivers\etc\hosts` to redirect Android, Apple CNA, Samsung, MIUI, and Windows detection domains directly to the gateway (`192.168.137.1`), triggering native OS "Sign in to Wi-Fi network" popups instantly.
5. **Standardized Mobile Normalization & Folder Convention:**  
   - All customer phone numbers are strictly standardized to the canonical `+8801XXXXXXXXX` format across database records, WhatsApp links, and directory paths.
   - Handles all variations: with `+880`, `880`, `+88`, `88`, with leading `0`, or without `0`.
   - Customer files and invoices are organized into dedicated disk directories: `./customers/<standardized_phone>/` containing `customer_info.json` and `notes.txt`.

---

## 3. 🚨 Critical UI/UX Design Constraints (Read Before Modifying UI)

### ⚠️ Constraint 1: The Offline / Isolated Sandbox State
When an unauthorized guest reaches the captive portal:
- **THEY HAVE NO INTERNET ACCESS.**
- **NEVER use external CDN links** (e.g., `<link href="https://cdnjs.cloudflare...>`, `<script src="https://cdn.jsdelivr...">`, or Google Fonts).
- Any attempt to load external scripts, styles, or images will fail, timeout, or prevent the captive window from displaying.
- **Rule:** All CSS, JavaScript, and SVG icons **must be inline or served locally** by the Node.js server.

### ⚠️ Constraint 2: Captive Network Assistant (CNA) WebViews
- On iOS (CaptiveNetworkAssistant) and Android (`CaptivePortalLogin`), the portal opens in an isolated micro-browser/WebView, NOT full Safari or Chrome.
- **Characteristics:**
  - Viewport height changes drastically when the virtual keyboard opens.
  - Cookies and local storage may be cleared when the modal closes.
  - As soon as the device detects that internet access is unblocked, iOS CNA may auto-dismiss the sheet or display "Done" in the top-right corner.
- **Rule:** The portal must be ultra-lightweight, 100% mobile-friendly, vertically compact, and resilient to sudden disconnections.

### ⚠️ Constraint 3: Strict Zero-Dependency Rule
- Do not introduce build pipelines (Webpack, Vite, Tailwind CLI) or npm packages (Express, EJS) unless explicitly approved by the project owner.
- Templates must be clean, maintainable, modular vanilla HTML/CSS/JS served directly through standard Node.js methods.

---

## 4. 🔍 In-Depth UI & UX Audit of Current Codebase

Currently, all HTML and CSS reside as template strings inside `server.js`.

### Screen 1: Guest Captive Portal (`getPortalHtml`)
* **Current Elements:**
  - Dark gradient background (`#0f172a` to `#1e293b`).
  - White card with `FREE HIGH-SPEED WI-FI` badge.
  - Business Headline & Subtext from `CONFIG`.
  - Form fields: Name (`type="text"`), Mobile (`type="tel"`), Consent Checkbox.
  - Submit Button: `Connect to Wi-Fi Now`.
  - Perks row: `⚡ 5G Speed | 🔒 Secure Browsing | 🎁 VIP Discounts`.
* **UX Flaws & Friction Points:**
  1. **No Brand Identity / Logo:** Just generic text headings; venues cannot display their store logo or banner.
  2. **Phone Number Usability:** Raw text input with a static placeholder (`e.g. +91 9876543210`). No country code selector, no real-time formatting as the user types, and no numeric keypad enforcement (`inputmode="numeric"` / `tel`).
  3. **Error Handling Flash:** When input fails server-side validation (e.g. invalid phone number), the server re-renders the whole page, wiping inputs and causing a jarring reload.
  4. **No Loading State:** When clicking "Connect", the client waits while PowerShell executes firewall rules. There is no spinner, button disabled state, or "Activating internet..." feedback. Users tap multiple times.
  5. **Consent / Privacy Friction:** The marketing checkbox is hard-set to `required`, but there is no clickable Terms & Privacy modal explaining what data is collected.

### Screen 2: Connection Success Screen (`getSuccessHtml`)
* **Current Elements:**
  - Green check/party emoji (`🎉`), "You're Connected, [Name]!".
  - Button: "Continue to Internet".
  - Meta refresh redirect to `CONFIG.redirectUrl`.
* **UX Flaws & Friction Points:**
  1. **Timing Inconsistency:** Copy says *"Redirecting automatically in 3 seconds..."*, but meta tag is `<meta http-equiv="refresh" content="4;...">`.
  2. **No Visual Progress:** No countdown timer or progress bar showing the remaining seconds.
  3. **CNA Auto-Close Trap:** Mobile devices often kill the CNA window before the meta-refresh completes. A prominent, finger-friendly button with instant touch feedback is essential.

### Screen 3: Marketing Admin Dashboard (`getAdminHtml` at `/admin`)
* **Current Elements:**
  - Header with title and "Download Leads (CSV / Excel)" button.
  - Two stat cards: "Total Customer Leads" and "Currently Connected IPs".
  - Raw HTML data table with columns: ID, Name, Mobile Number, Direct WhatsApp button (`wa.me`), IP Address, Joined Date, Revoke button.
* **UX Flaws & Friction Points:**
  1. **Mobile Unfriendly:** The table is fixed-width and overflows horizontally on phone screens. Store managers checking leads on their phones have a poor experience.
  2. **Security Vulnerability:** `/admin` has **zero authentication**. Any connected guest who navigates to `http://192.168.137.1/admin` can view all collected customer numbers and revoke other guests' access!
  3. **No Filtering or Search:** As soon as leads exceed 50 records, finding a specific customer or number requires manual scrolling.
  4. **Accidental Revocation Risk:** Clicking "Revoke" immediately posts the form and cuts internet without an "Are you sure?" confirmation dialog.
  5. **Static Data:** Does not automatically update when new guests connect. Requires manual page refresh.

---

## 5. 🚀 Actionable UI/UX Improvement Roadmap

### Phase 1: Guest Captive Portal Redesign (High Priority)
- [ ] **Modern Visual Polish:** Clean glassmorphism or crisp modern card design with SVG brand icons, Wi-Fi signal indicator, and customizable accent color.
- [ ] **Smart Mobile Input UX:**
  - Country code dropdown / auto-detection prefix.
  - Clean input masking / formatting for mobile numbers.
  - Explicit `inputmode="tel"` and `autocomplete` attributes for effortless mobile autofill.
- [ ] **Client-Side Live Validation & Instant Feedback:**
  - Inline error hints before form submission.
  - Disable button and show an animated spinner ("Connecting to high-speed Wi-Fi...") upon submit.
- [ ] **Terms & Privacy Modal:** Inline, zero-dependency pop-up modal explaining privacy and opt-in terms.

### Phase 2: Connected Screen & Redirect Experience (Medium Priority)
- [ ] **Animated Circular or Bar Countdown:** Real-time visual countdown timer (3... 2... 1...).
- [ ] **Venue Call-to-Action:** Prominent cards for Google Reviews, Instagram, or Today's Specials while waiting for redirection.

### Phase 3: Admin Dashboard Overhaul (High Priority)
- [ ] **Admin Authentication:** Simple PIN or basic password protection to prevent guests from viewing leads.
- [ ] **Responsive Card / Table Hybrid:** Responsive grid that turns into readable cards on mobile screens and full data tables on desktop.
- [ ] **Search & Quick Filter:** Real-time instant search bar for filtering leads by Name or Phone number.
- [ ] **Live Polling / Auto-Refresh:** Non-intrusive periodic fetch or lightweight SSE to show new leads in real-time.
- [ ] **Safety Confirmation on Revoke:** Modal or tooltip confirmation to prevent accidental disconnection.

### Phase 4: Code Architecture & Separation of Concerns (Engineering Quality) [COMPLETED]
- [x] **Modular Template Files:** Moved 2,300+ lines of inline HTML/CSS blocks out of `server.js` into clean `templates/portal.html`, `templates/success.html`, and `templates/admin.html`.
- [x] **Zero-Dependency View Engine (`templates.js`):** Loads and caches templates in memory using native `node:fs` with micro-placeholder replacement (`{{key}}`) for optimal performance and pure zero-dependency Node.js architecture.
- [x] Shrunk `server.js` from 3,043 lines down to ~680 clean lines.

