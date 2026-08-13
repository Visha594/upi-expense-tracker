# ⚡ UPI Spendr — Smart UPI Expense Tracker & Splitwise

> A production-grade, sellable Indian UPI Expense Tracker, Subscription/EMI Manager, and Splitwise Ledger with a local persistent SQLite database, PWA offline support, and intelligent Bank SMS extraction.

---

## 🌟 Key Features

1. **🚀 1-Tap UPI Logging & NPCI Deep Links**
   - Quick logging chips for daily micro-spends (Chai ₹15, Auto ₹40, Swiggy ₹380, Blinkit ₹500).
   - Dynamic `upi://pay` deep linking and dynamic settlement QR matrix generation.

2. **🗄️ Persistent SQLite Database (`upi_tracker.db`)**
   - 8 relational tables (`users`, `accounts`, `transactions`, `budgets`, `recurring_bills`, `split_groups`, `group_members`, `group_expenses`).
   - 100% private, offline-first local data storage.

3. **🔁 Subscriptions, SIPs & EMI Tracker**
   - Automated due-date countdown alerts (`Due in 3d`, `Due Today`, `Overdue`).
   - 1-tap **⚡ Pay Now** settlement debited directly from your linked accounts into your transaction ledger.

4. **👥 Splitwise Multi-Group Ledgers**
   - Create groups for trips, room rent, and team dinners.
   - Built-in **Greedy Debt Simplification Algorithm** that computes net balances (*"Who Owes Whom"*).
   - 1-click WhatsApp payment reminders and UPI QR code generator for settlements.

5. **📩 Bank SMS Intelligence**
   - Parses SMS alerts from SBI, HDFC, ICICI, Axis, Kotak, and PNB.
   - Automatically extracts amount, payee, account last-4 digits, UPI reference number (UTR), and transaction type (Debit/Credit).

6. **📱 Progressive Web App (PWA)**
   - Standalone display mode with offline caching service worker (`sw.js`).
   - Installable on Android, iOS, and Desktop.

---

## 🛠️ Tech Stack
- **Frontend**: Vanilla JavaScript (ES Modules), Modern CSS Design System with dark/light themes, Canvas Charts, Web Audio API Soundbox.
- **Backend / Database**: Python 3 standard library `http.server`, SQLite3 (`upi_tracker.db`).

---

## 🚀 Getting Started

### Prerequisites
- Python 3.10+

### Run Locally
```bash
# Clone the repository
git clone https://github.com/<your-username>/<your-repo-name>.git
cd upi-expense-tracker

# Start the server
python server.py
```
Open **[http://localhost:3000](http://localhost:3000)** in your browser.

---

## 🔒 Security & Privacy
All banking transactions, accounts, and budgets are kept strictly on your local machine in SQLite. No credentials, tokens, or financial records leave your device.
