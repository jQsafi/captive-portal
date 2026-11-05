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

## ⏳ Phase 5: Architecture & Modular Templates — [UPCOMING]

*Focus: Code cleanliness and ease of customization while strictly keeping zero npm dependencies.*

- [ ] **5.1 Template Separation**
  - [ ] Extract inline HTML strings from `server.js` into clean `templates/` files.
  - [ ] In-memory template caching via native `node:fs` for zero performance penalty.
