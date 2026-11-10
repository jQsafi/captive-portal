# 📋 UI/UX Enhancement & Implementation Checklist
**Project:** Wi-Fi Captive Portal & Marketing Gateway  
**Architecture:** Pure Node.js (Zero NPM Dependencies) • Embedded SQLite • Windows Hotspot & Firewall Isolation

This checklist tracks the design, development, and verification of all user-facing interfaces (Guest Portal, Connected Screen, and Admin Marketing Dashboard).

---

## ✅ Phase 1: Guest Captive Portal (`getPortalHtml`) — [COMPLETED]

*Focus: Maximize lead conversion, mobile keyboard ergonomics, zero-dependency offline resilience, and brand presentation.*

- [x] **1.1 Strict Offline Isolation Compliance**
  - [x] Remove all external CDN dependencies (`<link>`, `<script>`, external fonts).
  - [x] Embed all icons as lightweight, vector inline SVGs (Wi-Fi, User, Phone, Lock, Lightning, Gift, Close).
  - [x] Use native system font stack (`system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto`) for instant rendering with zero network latency.

- [x] **1.2 Visual Identity & Modern Tech Theme**
  - [x] Dark ambient mesh gradient background (`#0b0f19` to `#111827`) with glowing aura effects.
  - [x] Frosted glassmorphism card container with subtle borders and deep elevation shadows.
  - [x] Live Hotspot Status indicator (pulsing green dot + connected SSID badge).
  - [x] Prominent business headline, marketing offer subtext, and trust badges (⚡ 5G Speed, 🔒 Encrypted, 🎁 VIP Perks).

- [x] **1.3 Smart Phone & Input Ergonomics**
  - [x] Integrated country code prefix selector (`🇧🇩 +880` default, `🇺🇸 +1`, `🇮🇳 +91`, `🇬🇧 +44`, `🇦🇪 +971`, etc.).
  - [x] Phone input configured with `type="tel"`, `inputmode="tel"`, and `autocomplete="tel"` to trigger numeric dialpad on iOS & Android.
  - [x] Preserve entered values (`name`, `phone`) on server error re-renders so guests never have to re-type.
  - [x] Automatic phone number formatting & cleaning (strips spaces, hyphens, and invalid characters).

- [x] **1.4 Instant Client-Side Validation & Anti-Double-Submit Loading State**
  - [x] Real-time inline field validation (name length, phone digits, dummy repetition checks) before submission.
  - [x] Animated button loading state: disables button on click, displays animated SVG spinner, and updates text to *"Authenticating & Unlocking Wi-Fi..."* to prevent multiple firewall command executions.

- [x] **1.5 Interactive Terms & Privacy Modal**
  - [x] Built-in modal dialog explaining acceptable Wi-Fi usage and data protection (stored locally, never sold).
  - [x] Dismissable via close icon, outside backdrop tap, or Escape key.

---

## ✅ Phase 2: Connection Success Screen (`getSuccessHtml`) — [COMPLETED]

*Focus: Clear visual feedback, seamless redirection, and venue engagement before CNA micro-browser closes.*

- [x] **2.1 Visual Countdown Timer & Progress Bar**
  - [x] Synchronized animated linear countdown timer (3... 2... 1...).
  - [x] Fixed discrepancy: both UI copy and `<meta http-equiv="refresh">` accurately match 3 seconds.
- [x] **2.2 Venue Marketing Call-to-Action (CTA)**
  - [x] High-impact venue greeting card showcasing venue branding and VIP coupon notice.
  - [x] Prominent manual "Continue to Web" button with instant tactile response.
- [x] **2.3 CNA Auto-Close Resilience & Design Cohesion**
  - [x] Visual consistency with Phase 1 dark glassmorphism theme and glowing accent bars.
  - [x] Animated SVG checkmark badge with popIn animation.
  - [x] Helpful advice line for iOS/Android prompt dismissal.

---

## ✅ Phase 3: Customer Wi-Fi & Device Dashboard (`getAdminHtml`) — [COMPLETED]

*Focus: Professional shop rebranding ("Smart Computer"), instant search/filter, mobile card responsiveness, and operational safety.*

- [x] **3.1 Shop Rebranding & Clean Terminology**
  - [x] Rebranded all marketing jargon into a clean customer directory for "Smart Computer" shop.
  - [x] Renamed CSV export to `smart_computer_customer_records.csv` with clear customer column headers.
- [x] **3.2 Mobile-Responsive Card & Table Hybrid Layout**
  - [x] Desktop displays an elegant, full-featured data table.
  - [x] Smartphones (< 768px) automatically switch to touch-friendly customer cards.
- [x] **3.3 Real-Time Instant Search & Filtering**
  - [x] Instant client-side search bar filtering rows and cards by Name, Phone, or IP as the user types with live count indicator.
- [x] **3.4 Quick Visitor Analytics**
  - [x] Stats cards: "Total Registered Visitors", "Currently Connected Devices", and "Today's Visits".
- [x] **3.5 Safety Confirmation on Disconnect**
  - [x] Javascript confirmation dialog (*"Disconnect Wi-Fi access for [Name] ([IP])?"*) preventing accidental disconnects.
- [x] **3.6 Manual Customer Entry & Customer Types**
  - [x] "➕ Add Customer" modal for walk-in, service/repair, and sales clients without device IPs.
  - [x] Colored badges for `Hotspot`, `Walk-in`, `Service/Repair`, and `Sales`.
- [x] **3.7 Standardized Phone Formatting & Folder Creation (`+880...`)**
  - [x] All Bangladeshi mobile numbers are strictly standardized to `+8801616332313`.
  - [x] Comprehensive normalization handles all customer input variations:
    - With `+880` (e.g. `+8801616332313` &rarr; `+8801616332313`)
    - With `0` (e.g. `01616332313` &rarr; `+8801616332313`)
    - With `88` or `880` (e.g. `881616332313` or `8801616332313` &rarr; `+8801616332313`)
    - Without `0` (e.g. `1616332313` &rarr; `+8801616332313`)
    - With punctuation/spaces (e.g. `01616-332313` &rarr; `+8801616332313`)
  - [x] Real-time input listeners across Guest Portal, Add Customer Modal, and Edit Customer Modal automatically clean inputs as users type or paste.
  - [x] Dedicated customer folders created strictly using the standardized mobile number: `customers/<standardized_phone>/` (e.g. `customers/+8801616332313/`).
  - [x] Startup auto-migration retroactively upgrades existing database records and renames disk folders.
  - [x] Each folder includes pre-formatted `customer_info.json` and a shop `notes.txt` file for service orders and invoices.
- [x] **3.8 Admin Customer Edit & Update Workflow**
  - [x] Interactive "Edit" modal allowing admin to modify customer name, country code, phone number, and customer type.
  - [x] Automatically parses and pre-populates existing country codes and canonical numbers without trunk zero.
  - [x] Strips leading 0 in real-time as admin types.
  - [x] Server endpoint `POST /admin/customer/edit` updates SQLite database, renames customer folder if phone changed, updates `customer_info.json`, and records an audit log entry in `notes.txt`.
- [x] **3.9 Admin Customer Deletion & Complete Cleanup**
  - [x] "Delete" action button on desktop rows and mobile cards.
  - [x] Safety prompt (*"⚠️ Are you sure you want to delete customer [Name] ([Phone])? This will remove their database record and delete their folder."*).
  - [x] Server endpoint `POST /admin/customer/delete` purges SQLite row, revokes active Wi-Fi session IP from firewall, and permanently removes the customer folder in `customers/<phone>/`.

---

## ⏳ Phase 4: Admin Access Control & Privacy Protection — [UPCOMING]

*Focus: Prevent unauthorized guests on the hotspot from accessing customer contact lists.*

- [ ] **4.1 Admin PIN / Session Authentication**
  - [ ] Require a simple PIN or password to access `/admin` and `/admin/export.csv`.
  - [ ] Restrict access by default so guest IPs (`192.168.137.x`) cannot view other customers' phone numbers.

---

## ✅ Phase 5: Architecture & Modular Templates — [COMPLETED]

*Focus: Code cleanliness and ease of customization while strictly keeping zero npm dependencies.*

- [x] **5.1 Template Separation & Clean View Engine**
  - [x] Extracted 2,300+ lines of inline HTML/CSS/JS strings from `server.js` into clean `templates/` files:
    - `templates/portal.html` (Guest Wi-Fi Portal)
    - `templates/success.html` (Connection Success Screen)
    - `templates/admin.html` (Customer Directory Dashboard)
  - [x] Implemented in-memory caching engine in `templates.js` via native `node:fs` for zero performance overhead.
  - [x] Shrunk `server.js` from 3,043 lines down to ~680 clean lines.
  - [x] IDE syntax highlighting and linting now function properly for all HTML/CSS/JS template files.

---

## ✅ Phase 6: Customer Notes & Service Tracker (Option 2) — [COMPLETED]

*Focus: Provide shop managers with instant customer history, repair order logs, and sales invoices directly in the browser.*

- [x] **6.1 In-Store Customer Notes Modal**
  - [x] Added `📝 Notes` button to each customer row in desktop table and mobile cards.
  - [x] Clicking `Notes` opens `#customerNotesModal` with customer details (name, phone, folder).
  - [x] Loads and displays the customer's `customers/<phone>/notes.txt` file directly in an in-modal textarea.
- [x] **6.2 Quick Snippet Log Templates**
  - [x] `🛠️ + Repair / Service`: Instantly inserts timestamped service order template (Device Model, Issue, Cost, Status, Tech Remarks).
  - [x] `🛒 + Sale / Invoice`: Inserts timestamped sales log template (Item, Quantity, Total Amount, Payment Method, Warranty).
  - [x] `📌 + General Note`: Inserts quick timestamped note.
- [x] **6.3 Native File Synchronization & Real-Time Feedback**
  - [x] Backend endpoint `GET /admin/customer/notes?id=...` reads the customer file.
  - [x] Backend endpoint `POST /admin/customer/notes` persists updates directly to `customers/<phone>/notes.txt`.
  - [x] Real-time visual feedback ("✓ Saved successfully at [Time]") with zero page reloads.

---

## ✅ Phase 7: Wi-Fi Session Limits & Duration Control (Option 3) — [COMPLETED]

*Focus: Control network bandwidth, prevent unauthorized prolonged squatting, and manage access limits gracefully.*

- [x] **7.1 Configurable Session Duration**
  - [x] Added `CONFIG.session = { durationMinutes: 120, checkIntervalSeconds: 30 }` in `server.js` (default: 2 hours).
  - [x] Added `session_expires_at` column to SQLite `leads` table to persist session expiration across restarts.
- [x] **7.2 Background Session Expiration Monitor**
  - [x] Background interval checks active sessions every 30 seconds.
  - [x] When a session expires, client IP is automatically purged from `authorizedIps` and revoked from firewall.
  - [x] Next user browse automatically redirects back to `/portal`.
- [x] **7.3 Admin Real-Time Remaining Time & 1-Click Extension**
  - [x] Device IP column displays dynamic session remaining pill (e.g. `⏱️ 1h 45m left` in green, warning pulse when &le; 15m, or `⏱️ Expired`).
  - [x] Added `⏱️ +1h` button in table rows and mobile cards to extend customer access by +60 minutes with 1 click.
  - [x] Endpoint `POST /admin/session/extend` updates in-memory sessions and SQLite database.
- [x] **7.4 Success Screen Session Badge**
  - [x] Connection success screen displays `⚡ 2 Hours High-Speed Access Activated` badge.
