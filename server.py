"""
UPI Spendr - Full Production SQLite Database Backend & REST API Server
Persistent SQLite schema with Users, Accounts, Transactions, Budgets, Recurring Bills & Splitwise Groups.
"""

import http.server
import json
import os
import posixpath
import sqlite3
import sys
import urllib.parse
from datetime import datetime, timedelta

# Ensure UTF-8 output on Windows consoles
if sys.platform == 'win32':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    except Exception:
        pass

DB_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'upi_tracker.db')
PORT = 3000

# ----------------- DATABASE SCHEMA & INITIALIZATION -----------------

def get_db():
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    cursor = conn.cursor()

    # 1. Users Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        phone TEXT UNIQUE NOT NULL,
        email TEXT,
        upi_id TEXT,
        pin TEXT NOT NULL,
        avatar TEXT DEFAULT '👨‍💼',
        created_at TEXT NOT NULL
    )
    """)

    # 2. Accounts Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        bank TEXT NOT NULL,
        account_last4 TEXT NOT NULL,
        type TEXT NOT NULL,
        balance REAL NOT NULL DEFAULT 0,
        credit_limit REAL DEFAULT 0,
        upi_id TEXT NOT NULL,
        is_primary INTEGER DEFAULT 0,
        theme TEXT DEFAULT 'bank-hdfc',
        created_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    )
    """)

    # 3. Transactions Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS transactions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        type TEXT NOT NULL,
        amount REAL NOT NULL,
        merchant TEXT NOT NULL,
        category TEXT NOT NULL,
        account_id TEXT,
        bank TEXT,
        account_last4 TEXT,
        upi_ref TEXT,
        timestamp TEXT NOT NULL,
        note TEXT,
        is_lite INTEGER DEFAULT 0,
        created_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
        FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE SET NULL
    )
    """)

    # 4. Category Budgets Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS budgets (
        user_id TEXT NOT NULL,
        category_id TEXT NOT NULL,
        amount REAL NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (user_id, category_id),
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    )
    """)

    # 5. Recurring Bills, Subscriptions & EMIs Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS recurring_bills (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        amount REAL NOT NULL,
        category TEXT NOT NULL,
        frequency TEXT DEFAULT 'monthly',
        due_day INTEGER DEFAULT 1,
        next_due_date TEXT NOT NULL,
        auto_pay INTEGER DEFAULT 0,
        is_active INTEGER DEFAULT 1,
        created_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    )
    """)

    # 6. Splitwise Groups Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS split_groups (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        category TEXT DEFAULT 'trip',
        created_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    )
    """)

    # 7. Group Members Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS group_members (
        id TEXT PRIMARY KEY,
        group_id TEXT NOT NULL,
        name TEXT NOT NULL,
        upi_id TEXT NOT NULL,
        phone TEXT,
        is_owner INTEGER DEFAULT 0,
        created_at TEXT NOT NULL,
        FOREIGN KEY (group_id) REFERENCES split_groups (id) ON DELETE CASCADE
    )
    """)

    # 8. Group Shared Expenses Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS group_expenses (
        id TEXT PRIMARY KEY,
        group_id TEXT NOT NULL,
        paid_by_name TEXT NOT NULL,
        amount REAL NOT NULL,
        title TEXT NOT NULL,
        split_type TEXT DEFAULT 'equal',
        created_at TEXT NOT NULL,
        FOREIGN KEY (group_id) REFERENCES split_groups (id) ON DELETE CASCADE
    )
    """)

    conn.commit()

    # Seed Demo User & Sample Data if not exists
    cursor.execute("SELECT id FROM users WHERE id = 'usr_demo'")
    if not cursor.fetchone():
        seed_demo_data(conn)

    conn.close()

def seed_demo_data(conn):
    cursor = conn.cursor()
    now_iso = datetime.now().isoformat()

    # 1. Demo User
    cursor.execute("""
    INSERT OR REPLACE INTO users (id, name, phone, email, upi_id, pin, avatar, created_at)
    VALUES ('usr_demo', 'Vishal Sharma', '9876543210', 'vishal@example.com', 'vishal@okhdfcbank', '1234', '👨‍💼', ?)
    """, (now_iso,))

    # 2. Demo Accounts
    accounts = [
        ('acc_hdfc', 'usr_demo', 'HDFC Salary Account', 'HDFC', '7890', 'savings', 54320.0, 0, 'vishal@okhdfcbank', 1, 'bank-hdfc', now_iso),
        ('acc_sbi', 'usr_demo', 'SBI Personal Savings', 'SBI', '4921', 'savings', 18450.0, 0, 'vishal@oksbi', 0, 'bank-sbi', now_iso),
        ('acc_icici_cc', 'usr_demo', 'ICICI Coral RuPay CC', 'ICICI', '8899', 'credit', 45000.0, 125000.0, 'vishal.cc@icici', 0, 'bank-rupay', now_iso),
        ('acc_lite', 'usr_demo', 'UPI Lite (PIN-less)', 'UPI Lite', 'LITE', 'wallet', 1450.0, 2000.0, 'vishal@lite', 0, 'bank-lite', now_iso)
    ]
    cursor.executemany("""
    INSERT OR REPLACE INTO accounts (id, user_id, name, bank, account_last4, type, balance, credit_limit, upi_id, is_primary, theme, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, accounts)

    # 3. Demo Budgets
    budgets = [
        ('usr_demo', 'food', 8000.0, now_iso),
        ('usr_demo', 'grocery', 7000.0, now_iso),
        ('usr_demo', 'transit', 3500.0, now_iso),
        ('usr_demo', 'shopping', 6000.0, now_iso),
        ('usr_demo', 'bills', 5000.0, now_iso),
        ('usr_demo', 'entertainment', 2500.0, now_iso),
        ('usr_demo', 'health', 2000.0, now_iso),
        ('usr_demo', 'investment', 15000.0, now_iso)
    ]
    cursor.executemany("""
    INSERT OR REPLACE INTO budgets (user_id, category_id, amount, updated_at)
    VALUES (?, ?, ?, ?)
    """, budgets)

    # 4. Demo Recurring Bills & Subscriptions
    def get_due_date(day):
        d = datetime.now()
        if d.day > day:
            # next month
            month = d.month + 1 if d.month < 12 else 1
            year = d.year if d.month < 12 else d.year + 1
            return datetime(year, month, min(day, 28)).strftime('%Y-%m-%d')
        return datetime(d.year, d.month, min(day, 28)).strftime('%Y-%m-%d')

    recurring = [
        ('rec_1', 'usr_demo', 'Netflix Premium 4K', 649.0, 'entertainment', 'monthly', 18, get_due_date(18), 1, 1, now_iso),
        ('rec_2', 'usr_demo', 'Spotify Premium Duo', 149.0, 'entertainment', 'monthly', 22, get_due_date(22), 1, 1, now_iso),
        ('rec_3', 'usr_demo', 'Nifty 50 Index SIP', 5000.0, 'investment', 'monthly', 10, get_due_date(10), 1, 1, now_iso),
        ('rec_4', 'usr_demo', 'Airtel Xstream Fiber', 999.0, 'bills', 'monthly', 25, get_due_date(25), 0, 1, now_iso),
        ('rec_5', 'usr_demo', 'Apartment Rent', 18000.0, 'bills', 'monthly', 1, get_due_date(1), 0, 1, now_iso)
    ]
    cursor.executemany("""
    INSERT OR REPLACE INTO recurring_bills (id, user_id, name, amount, category, frequency, due_day, next_due_date, auto_pay, is_active, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, recurring)

    # 5. Demo Splitwise Groups
    cursor.execute("""
    INSERT OR REPLACE INTO split_groups (id, user_id, name, description, category, created_at)
    VALUES ('grp_goa', 'usr_demo', 'Goa Vacation 🌴', 'Beach resort, scooty & seafood', 'trip', ?)
    """, (now_iso,))

    members = [
        ('m1', 'grp_goa', 'Vishal (You)', 'vishal@okhdfcbank', '+91 98765 43210', 1, now_iso),
        ('m2', 'grp_goa', 'Aarav Sharma', 'aarav@okaxis', '+91 98111 22233', 0, now_iso),
        ('m3', 'grp_goa', 'Pooja Nair', 'pooja@okhdfcbank', '+91 98222 33344', 0, now_iso),
        ('m4', 'grp_goa', 'Rohan Gupta', 'rohan@icici', '+91 98333 44455', 0, now_iso)
    ]
    cursor.executemany("""
    INSERT OR REPLACE INTO group_members (id, group_id, name, upi_id, phone, is_owner, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    """, members)

    expenses = [
        ('exp_1', 'grp_goa', 'Vishal (You)', 4800.0, 'Resort Villa Booking', 'equal', now_iso),
        ('exp_2', 'grp_goa', 'Aarav Sharma', 2400.0, 'Beach Shack Dinner', 'equal', now_iso),
        ('exp_3', 'grp_goa', 'Pooja Nair', 1600.0, 'Scooty & Petrol Rental', 'equal', now_iso)
    ]
    cursor.executemany("""
    INSERT OR REPLACE INTO group_expenses (id, group_id, paid_by_name, amount, title, split_type, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    """, expenses)

    # 6. Demo Transactions
    def get_past_time(days_ago, hour, minute):
        d = datetime.now() - timedelta(days=days_ago)
        d = d.replace(hour=hour, minute=minute, second=0, microsecond=0)
        return d.isoformat()

    txs = [
        ('tx_1', 'usr_demo', 'debit', 380.0, 'Swiggy', 'food', 'acc_hdfc', 'HDFC', '7890', '422789100234', get_past_time(0, 20, 15), 'Dinner with Paneer Butter Masala', 0, now_iso),
        ('tx_2', 'usr_demo', 'debit', 25.0, 'Chai Point', 'food', 'acc_lite', 'UPI Lite', 'LITE', '422789100235', get_past_time(0, 17, 30), 'Evening Masala Chai', 1, now_iso),
        ('tx_3', 'usr_demo', 'debit', 549.0, 'Blinkit', 'grocery', 'acc_hdfc', 'HDFC', '7890', '422789100236', get_past_time(0, 10, 45), 'Milk, Eggs & Morning snacks', 0, now_iso),
        ('tx_4', 'usr_demo', 'debit', 220.0, 'Uber India', 'transit', 'acc_sbi', 'SBI', '4921', '422789100237', get_past_time(1, 18, 40), 'Auto ride back from office', 0, now_iso),
        ('tx_5', 'usr_demo', 'debit', 1499.0, 'Amazon India', 'shopping', 'acc_icici_cc', 'ICICI', '8899', '422789100238', get_past_time(2, 21, 10), 'Wireless Ergonomic Mouse', 0, now_iso),
        ('tx_6', 'usr_demo', 'debit', 650.0, 'Zomato', 'food', 'acc_hdfc', 'HDFC', '7890', '422789100239', get_past_time(3, 13, 20), 'Team Biryani Lunch', 0, now_iso),
        ('tx_7', 'usr_demo', 'debit', 850.0, 'BESCOM Electricity', 'bills', 'acc_sbi', 'SBI', '4921', '422789100240', get_past_time(4, 11, 0), 'August Home Electricity Bill', 0, now_iso),
        ('tx_8', 'usr_demo', 'debit', 349.0, 'BookMyShow', 'entertainment', 'acc_hdfc', 'HDFC', '7890', '422789100241', get_past_time(5, 19, 30), 'Weekend Movie Ticket', 0, now_iso),
        ('tx_9', 'usr_demo', 'credit', 75000.0, 'Employer Payroll', 'transfer', 'acc_hdfc', 'HDFC', '7890', '422789100242', get_past_time(13, 9, 30), 'Monthly Salary Credit', 0, now_iso),
        ('tx_10', 'usr_demo', 'credit', 450.0, 'Aarav Sharma', 'transfer', 'acc_hdfc', 'HDFC', '7890', '422789100243', get_past_time(2, 16, 15), 'Split settlement for Lunch', 0, now_iso),
        ('tx_11', 'usr_demo', 'debit', 420.0, 'Apollo Pharmacy', 'health', 'acc_sbi', 'SBI', '4921', '422789100244', get_past_time(6, 15, 45), 'Multivitamins & First Aid', 0, now_iso),
        ('tx_12', 'usr_demo', 'debit', 35.0, 'DMRC Metro', 'transit', 'acc_lite', 'UPI Lite', 'LITE', '422789100245', get_past_time(7, 8, 50), 'Metro Smart Card Topup', 1, now_iso),
        ('tx_13', 'usr_demo', 'debit', 1200.0, 'HPCL Petrol Pump', 'transit', 'acc_icici_cc', 'ICICI', '8899', '422789100246', get_past_time(8, 18, 10), 'Car Fuel Tank Full', 0, now_iso),
        ('tx_14', 'usr_demo', 'debit', 899.0, 'Zepto', 'grocery', 'acc_hdfc', 'HDFC', '7890', '422789100247', get_past_time(9, 21, 40), 'Party Drinks & Munchies', 0, now_iso),
        ('tx_15', 'usr_demo', 'debit', 5000.0, 'Zerodha Broking', 'investment', 'acc_hdfc', 'HDFC', '7890', '422789100248', get_past_time(10, 10, 0), 'Monthly Nifty 50 Index SIP', 0, now_iso)
    ]
    cursor.executemany("""
    INSERT OR REPLACE INTO transactions (id, user_id, type, amount, merchant, category, account_id, bank, account_last4, upi_ref, timestamp, note, is_lite, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, txs)

    conn.commit()


# ----------------- HTTP & REST API SERVER -----------------

class UpiRequestHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        if self.path.startswith('/api/'):
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
            self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-User-Id')
        elif self.path.endswith('.json'):
            self.send_header('Content-Type', 'application/manifest+json; charset=utf-8')
        elif self.path.endswith('.js'):
            self.send_header('Content-Type', 'application/javascript; charset=utf-8')
        elif self.path.endswith('.svg'):
            self.send_header('Content-Type', 'image/svg+xml')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def read_json_body(self):
        content_length = int(self.headers.get('Content-Length', 0))
        if content_length == 0:
            return {}
        body = self.rfile.read(content_length).decode('utf-8')
        try:
            return json.loads(body)
        except Exception:
            return {}

    def send_json(self, data, status=200):
        self.send_response(status)
        self.end_headers()
        self.wfile.write(json.dumps(data, indent=2).encode('utf-8'))

    def get_user_id_header(self):
        return self.headers.get('X-User-Id', 'usr_demo')

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if not path.startswith('/api/'):
            return super().do_GET()

        user_id = self.get_user_id_header()
        conn = get_db()
        cursor = conn.cursor()

        try:
            # 1. Database Status
            if path == '/api/db/status':
                cursor.execute("SELECT COUNT(*) FROM users")
                u_cnt = cursor.fetchone()[0]
                cursor.execute("SELECT COUNT(*) FROM transactions")
                t_cnt = cursor.fetchone()[0]
                cursor.execute("SELECT COUNT(*) FROM accounts")
                a_cnt = cursor.fetchone()[0]
                cursor.execute("SELECT COUNT(*) FROM budgets")
                b_cnt = cursor.fetchone()[0]
                cursor.execute("SELECT COUNT(*) FROM recurring_bills")
                r_cnt = cursor.fetchone()[0]
                cursor.execute("SELECT COUNT(*) FROM split_groups")
                g_cnt = cursor.fetchone()[0]
                
                db_size = os.path.getsize(DB_FILE) if os.path.exists(DB_FILE) else 0

                return self.send_json({
                    'status': 'online',
                    'database': 'SQLite 3 (upi_tracker.db)',
                    'db_size_bytes': db_size,
                    'db_size_kb': round(db_size / 1024, 2),
                    'tables': {
                        'users': u_cnt,
                        'transactions': t_cnt,
                        'accounts': a_cnt,
                        'budgets': b_cnt,
                        'recurring_bills': r_cnt,
                        'split_groups': g_cnt
                    }
                })

            # 2. Database Live Tables Inspector
            if path == '/api/db/tables':
                cursor.execute("SELECT * FROM users")
                users = [dict(r) for r in cursor.fetchall()]
                cursor.execute("SELECT * FROM accounts WHERE user_id = ?", (user_id,))
                accounts = [dict(r) for r in cursor.fetchall()]
                cursor.execute("SELECT * FROM transactions WHERE user_id = ? ORDER BY timestamp DESC LIMIT 50", (user_id,))
                transactions = [dict(r) for r in cursor.fetchall()]
                cursor.execute("SELECT * FROM budgets WHERE user_id = ?", (user_id,))
                budgets = [dict(r) for r in cursor.fetchall()]
                cursor.execute("SELECT * FROM recurring_bills WHERE user_id = ?", (user_id,))
                recurring = [dict(r) for r in cursor.fetchall()]

                return self.send_json({
                    'users': users,
                    'accounts': accounts,
                    'transactions': transactions,
                    'budgets': budgets,
                    'recurring': recurring
                })

            # 3. Transactions List
            if path == '/api/transactions':
                cursor.execute("SELECT * FROM transactions WHERE user_id = ? ORDER BY timestamp DESC", (user_id,))
                rows = [dict(r) for r in cursor.fetchall()]
                return self.send_json(rows)

            # 4. Accounts List
            if path == '/api/accounts':
                cursor.execute("SELECT * FROM accounts WHERE user_id = ? ORDER BY is_primary DESC, created_at ASC", (user_id,))
                rows = [dict(r) for r in cursor.fetchall()]
                return self.send_json(rows)

            # 5. Budgets
            if path == '/api/budgets':
                cursor.execute("SELECT category_id, amount FROM budgets WHERE user_id = ?", (user_id,))
                rows = cursor.fetchall()
                budget_map = {r['category_id']: r['amount'] for r in rows}
                return self.send_json(budget_map)

            # 6. Recurring Bills / Subscriptions
            if path == '/api/recurring':
                cursor.execute("SELECT * FROM recurring_bills WHERE user_id = ? ORDER BY next_due_date ASC", (user_id,))
                rows = [dict(r) for r in cursor.fetchall()]
                return self.send_json(rows)

            # 7. Splitwise Groups with Members & Expenses
            if path == '/api/split/groups':
                cursor.execute("SELECT * FROM split_groups WHERE user_id = ? ORDER BY created_at DESC", (user_id,))
                groups = [dict(g) for g in cursor.fetchall()]
                for g in groups:
                    cursor.execute("SELECT * FROM group_members WHERE group_id = ?", (g['id'],))
                    g['members'] = [dict(m) for m in cursor.fetchall()]
                    cursor.execute("SELECT * FROM group_expenses WHERE group_id = ? ORDER BY created_at DESC", (g['id'],))
                    g['expenses'] = [dict(e) for e in cursor.fetchall()]
                return self.send_json(groups)

            # 8. Smart Insights Engine
            if path == '/api/insights':
                cursor.execute("SELECT amount, category, merchant, timestamp FROM transactions WHERE user_id = ? AND type = 'debit'", (user_id,))
                debits = [dict(r) for r in cursor.fetchall()]
                total_spend = sum(r['amount'] for r in debits)
                
                # Category totals
                cat_totals = {}
                for d in debits:
                    cat_totals[d['category']] = cat_totals.get(d['category'], 0) + d['amount']

                top_cat = max(cat_totals.items(), key=lambda x: x[1]) if cat_totals else ('food', 0)
                
                insights = [
                    {
                        'type': 'spending_trend',
                        'icon': '📊',
                        'title': f'Top Category: {top_cat[0].title()}',
                        'description': f'₹{top_cat[1]:,.0f} spent on {top_cat[0]}, making up {round((top_cat[1]/total_spend)*100 if total_spend > 0 else 0)}% of monthly outflow.'
                    },
                    {
                        'type': 'micro_spend',
                        'icon': '☕',
                        'title': 'UPI Lite Micro-spends',
                        'description': 'PIN-less UPI Lite saves ~45 seconds per chai & metro transaction with 0% bank failure rate.'
                    },
                    {
                        'type': 'smart_saving',
                        'icon': '💡',
                        'title': 'Subscription Optimization',
                        'description': 'You have active recurring bills. Reviewing unused OTT/apps could save ₹650+/month.'
                    }
                ]
                return self.send_json(insights)

            # 9. Get Current User Info
            if path == '/api/auth/me':
                cursor.execute("SELECT id, name, phone, email, upi_id, avatar, created_at FROM users WHERE id = ?", (user_id,))
                row = cursor.fetchone()
                if row:
                    return self.send_json(dict(row))
                return self.send_json({'error': 'User not found'}, 404)

            self.send_json({'error': 'Endpoint not found'}, 404)

        except Exception as e:
            self.send_json({'error': str(e)}, 500)
        finally:
            conn.close()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if not path.startswith('/api/'):
            return self.send_json({'error': 'Not found'}, 404)

        user_id = self.get_user_id_header()
        data = self.read_json_body()
        conn = get_db()
        cursor = conn.cursor()

        try:
            # 1. Auth: Login
            if path == '/api/auth/login':
                identifier = data.get('identifier', '').strip().lower()
                pin = data.get('pin', '').strip()
                cursor.execute("""
                SELECT id, name, phone, email, upi_id, avatar, created_at
                FROM users
                WHERE (LOWER(phone) = ? OR LOWER(email) = ? OR LOWER(upi_id) = ?) AND pin = ?
                """, (identifier, identifier, identifier, pin))
                row = cursor.fetchone()
                if row:
                    return self.send_json({'success': True, 'user': dict(row)})
                return self.send_json({'success': False, 'message': 'Invalid Mobile / UPI ID or 4-digit PIN'}, 401)

            # 2. Auth: Register
            if path == '/api/auth/register':
                name = data.get('name', '').strip()
                phone = ''.join(c for c in data.get('phone', '') if c.isdigit())
                upi_id = data.get('upi_id', '').strip() or f"{name.lower().replace(' ', '')}@okhdfcbank"
                pin = data.get('pin', '').strip()
                email = data.get('email', '').strip() or f"{phone}@upispdr.in"
                avatar = data.get('avatar', '👤')
                now_iso = datetime.now().isoformat()

                if not name or len(phone) < 10 or len(pin) != 4:
                    return self.send_json({'success': False, 'message': 'Please fill all required fields properly'}, 400)

                new_user_id = f"usr_{int(datetime.now().timestamp() * 1000)}"

                try:
                    cursor.execute("""
                    INSERT INTO users (id, name, phone, email, upi_id, pin, avatar, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """, (new_user_id, name, phone, email, upi_id, pin, avatar, now_iso))

                    # Starter Accounts
                    starter_accounts = [
                        (f"acc_{new_user_id}_pri", new_user_id, 'Primary Bank A/C', 'HDFC', '1234', 'savings', 25000.0, 0, upi_id, 1, 'bank-hdfc', now_iso),
                        (f"acc_{new_user_id}_lite", new_user_id, 'UPI Lite Wallet', 'UPI Lite', 'LITE', 'wallet', 1000.0, 2000.0, f"{phone}@lite", 0, 'bank-lite', now_iso)
                    ]
                    cursor.executemany("""
                    INSERT INTO accounts (id, user_id, name, bank, account_last4, type, balance, credit_limit, upi_id, is_primary, theme, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """, starter_accounts)

                    # Starter Budgets
                    starter_budgets = [
                        (new_user_id, 'food', 8000.0, now_iso),
                        (new_user_id, 'grocery', 7000.0, now_iso),
                        (new_user_id, 'transit', 3500.0, now_iso),
                        (new_user_id, 'shopping', 6000.0, now_iso),
                        (new_user_id, 'bills', 5000.0, now_iso),
                        (new_user_id, 'entertainment', 2500.0, now_iso)
                    ]
                    cursor.executemany("""
                    INSERT INTO budgets (user_id, category_id, amount, updated_at)
                    VALUES (?, ?, ?, ?)
                    """, starter_budgets)

                    conn.commit()

                    return self.send_json({
                        'success': True,
                        'user': {
                            'id': new_user_id,
                            'name': name,
                            'phone': phone,
                            'email': email,
                            'upi_id': upi_id,
                            'avatar': avatar,
                            'created_at': now_iso
                        }
                    })
                except sqlite3.IntegrityError:
                    return self.send_json({'success': False, 'message': 'An account with this mobile number already exists'}, 400)

            # 3. Auth: Demo Login
            if path == '/api/auth/demo':
                cursor.execute("SELECT id, name, phone, email, upi_id, avatar, created_at FROM users WHERE id = 'usr_demo'")
                row = cursor.fetchone()
                if not row:
                    seed_demo_data(conn)
                    cursor.execute("SELECT id, name, phone, email, upi_id, avatar, created_at FROM users WHERE id = 'usr_demo'")
                    row = cursor.fetchone()
                return self.send_json({'success': True, 'user': dict(row)})

            # 4. Transactions: Create / Add
            if path == '/api/transactions':
                tx_id = data.get('id') or f"tx_{int(datetime.now().timestamp() * 1000)}"
                tx_type = data.get('type', 'debit')
                amount = float(data.get('amount', 0))
                merchant = data.get('merchant', 'UPI Payee')
                category = data.get('category', 'other')
                account_id = data.get('accountId') or data.get('account_id')
                bank = data.get('bank', 'UPI Bank')
                account_last4 = data.get('accountLast4') or data.get('account_last4', '1234')
                upi_ref = data.get('upiRef') or data.get('upi_ref') or f"422{int(datetime.now().timestamp()) % 1000000000}"
                timestamp = data.get('timestamp') or datetime.now().isoformat()
                note = data.get('note', '')
                is_lite = 1 if data.get('isLite') or data.get('is_lite') else 0
                now_iso = datetime.now().isoformat()

                cursor.execute("""
                INSERT INTO transactions (id, user_id, type, amount, merchant, category, account_id, bank, account_last4, upi_ref, timestamp, note, is_lite, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (tx_id, user_id, tx_type, amount, merchant, category, account_id, bank, account_last4, upi_ref, timestamp, note, is_lite, now_iso))

                if account_id:
                    if tx_type == 'debit':
                        cursor.execute("UPDATE accounts SET balance = MAX(0, balance - ?) WHERE id = ? AND user_id = ?", (amount, account_id, user_id))
                    elif tx_type == 'credit':
                        cursor.execute("UPDATE accounts SET balance = balance + ? WHERE id = ? AND user_id = ?", (amount, account_id, user_id))

                conn.commit()

                return self.send_json({
                    'id': tx_id,
                    'user_id': user_id,
                    'type': tx_type,
                    'amount': amount,
                    'merchant': merchant,
                    'category': category,
                    'accountId': account_id,
                    'bank': bank,
                    'accountLast4': account_last4,
                    'upiRef': upi_ref,
                    'timestamp': timestamp,
                    'note': note,
                    'isLite': bool(is_lite)
                })

            # 5. Recurring Bills: Create
            if path == '/api/recurring':
                rec_id = f"rec_{int(datetime.now().timestamp() * 1000)}"
                name = data.get('name', 'Subscription')
                amount = float(data.get('amount', 0))
                category = data.get('category', 'bills')
                frequency = data.get('frequency', 'monthly')
                due_day = int(data.get('dueDay', data.get('due_day', 1)))
                next_due_date = data.get('nextDueDate', data.get('next_due_date', datetime.now().strftime('%Y-%m-%d')))
                auto_pay = 1 if data.get('autoPay', data.get('auto_pay')) else 0
                now_iso = datetime.now().isoformat()

                cursor.execute("""
                INSERT INTO recurring_bills (id, user_id, name, amount, category, frequency, due_day, next_due_date, auto_pay, is_active, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
                """, (rec_id, user_id, name, amount, category, frequency, due_day, next_due_date, auto_pay, now_iso))
                conn.commit()

                return self.send_json({'success': True, 'id': rec_id, 'name': name, 'amount': amount})

            # 6. Splitwise: Create Group
            if path == '/api/split/groups':
                grp_id = f"grp_{int(datetime.now().timestamp() * 1000)}"
                name = data.get('name', 'New Group')
                desc = data.get('description', '')
                category = data.get('category', 'trip')
                now_iso = datetime.now().isoformat()

                cursor.execute("""
                INSERT INTO split_groups (id, user_id, name, description, category, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """, (grp_id, user_id, name, desc, category, now_iso))

                # Add members
                members = data.get('members', [])
                if not any(m.get('isOwner') or m.get('is_owner') for m in members):
                    cursor.execute("""
                    SELECT name, upi_id, phone FROM users WHERE id = ?
                    """, (user_id,))
                    u = cursor.fetchone()
                    u_name = u['name'] if u else 'You'
                    u_upi = u['upi_id'] if u else 'user@upi'
                    members.insert(0, {'name': f"{u_name} (You)", 'upiId': u_upi, 'phone': '', 'isOwner': 1})

                for m in members:
                    m_id = f"m_{int(datetime.now().timestamp() * 1000)}_{os.urandom(2).hex()}"
                    cursor.execute("""
                    INSERT INTO group_members (id, group_id, name, upi_id, phone, is_owner, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """, (m_id, grp_id, m.get('name'), m.get('upiId', m.get('upi_id', 'upi@bank')), m.get('phone', ''), 1 if m.get('isOwner') else 0, now_iso))

                conn.commit()
                return self.send_json({'success': True, 'id': grp_id, 'name': name})

            # 7. Splitwise: Add Expense to Group
            if path == '/api/split/expenses':
                exp_id = f"exp_{int(datetime.now().timestamp() * 1000)}"
                group_id = data.get('groupId', data.get('group_id'))
                paid_by = data.get('paidByName', data.get('paid_by_name', 'You'))
                amount = float(data.get('amount', 0))
                title = data.get('title', 'Expense')
                split_type = data.get('splitType', 'equal')
                now_iso = datetime.now().isoformat()

                cursor.execute("""
                INSERT INTO group_expenses (id, group_id, paid_by_name, amount, title, split_type, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """, (exp_id, group_id, paid_by, amount, title, split_type, now_iso))
                conn.commit()

                return self.send_json({'success': True, 'id': exp_id, 'title': title, 'amount': amount})

            # 8. Accounts: Top-Up UPI Lite
            if path == '/api/accounts/topup-lite':
                amount = float(data.get('amount', 500))
                cursor.execute("SELECT id FROM accounts WHERE user_id = ? AND is_primary = 1 LIMIT 1", (user_id,))
                pri = cursor.fetchone()
                cursor.execute("SELECT id FROM accounts WHERE user_id = ? AND type = 'wallet' LIMIT 1", (user_id,))
                lite = cursor.fetchone()

                if pri and lite and amount > 0:
                    cursor.execute("UPDATE accounts SET balance = MAX(0, balance - ?) WHERE id = ?", (amount, pri['id']))
                    cursor.execute("UPDATE accounts SET balance = MIN(2000, balance + ?) WHERE id = ?", (amount, lite['id']))
                    conn.commit()
                    return self.send_json({'success': True, 'message': f'Topped up ₹{amount} into UPI Lite'})
                return self.send_json({'success': False, 'message': 'Could not top up UPI Lite'}, 400)

            # 9. Budgets: Update
            if path == '/api/budgets':
                category_id = data.get('categoryId') or data.get('category_id')
                amount = float(data.get('amount', 0))
                now_iso = datetime.now().isoformat()
                cursor.execute("""
                INSERT OR REPLACE INTO budgets (user_id, category_id, amount, updated_at)
                VALUES (?, ?, ?, ?)
                """, (user_id, category_id, amount, now_iso))
                conn.commit()
                return self.send_json({'success': True, 'categoryId': category_id, 'amount': amount})

            # 10. Reload Sample Dataset in SQLite
            if path == '/api/db/reload-sample':
                cursor.execute("DELETE FROM transactions WHERE user_id = 'usr_demo'")
                cursor.execute("DELETE FROM accounts WHERE user_id = 'usr_demo'")
                cursor.execute("DELETE FROM budgets WHERE user_id = 'usr_demo'")
                cursor.execute("DELETE FROM recurring_bills WHERE user_id = 'usr_demo'")
                cursor.execute("DELETE FROM split_groups WHERE user_id = 'usr_demo'")
                seed_demo_data(conn)
                return self.send_json({'success': True, 'message': 'Sample dataset reloaded in SQLite'})

            # 11. Clear User Transactions
            if path == '/api/db/clear':
                cursor.execute("DELETE FROM transactions WHERE user_id = ?", (user_id,))
                conn.commit()
                return self.send_json({'success': True, 'message': 'All user transactions cleared'})

            self.send_json({'error': 'Endpoint not found'}, 404)

        except Exception as e:
            self.send_json({'error': str(e)}, 500)
        finally:
            conn.close()

    def do_DELETE(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        user_id = self.get_user_id_header()
        conn = get_db()
        cursor = conn.cursor()

        try:
            if path.startswith('/api/transactions/'):
                tx_id = path.replace('/api/transactions/', '').strip()
                cursor.execute("SELECT * FROM transactions WHERE id = ? AND user_id = ?", (tx_id, user_id))
                tx = cursor.fetchone()
                if tx:
                    if tx['account_id']:
                        if tx['type'] == 'debit':
                            cursor.execute("UPDATE accounts SET balance = balance + ? WHERE id = ?", (tx['amount'], tx['account_id']))
                        elif tx['type'] == 'credit':
                            cursor.execute("UPDATE accounts SET balance = MAX(0, balance - ?) WHERE id = ?", (tx['amount'], tx['account_id']))

                    cursor.execute("DELETE FROM transactions WHERE id = ? AND user_id = ?", (tx_id, user_id))
                    conn.commit()
                    return self.send_json({'success': True, 'deletedId': tx_id})
                return self.send_json({'error': 'Transaction not found'}, 404)

            if path.startswith('/api/recurring/'):
                rec_id = path.replace('/api/recurring/', '').strip()
                cursor.execute("DELETE FROM recurring_bills WHERE id = ? AND user_id = ?", (rec_id, user_id))
                conn.commit()
                return self.send_json({'success': True, 'deletedId': rec_id})

            if path.startswith('/api/split/groups/'):
                grp_id = path.replace('/api/split/groups/', '').strip()
                cursor.execute("DELETE FROM split_groups WHERE id = ? AND user_id = ?", (grp_id, user_id))
                conn.commit()
                return self.send_json({'success': True, 'deletedId': grp_id})

            return self.send_json({'error': 'Endpoint not found'}, 404)
        except Exception as e:
            self.send_json({'error': str(e)}, 500)
        finally:
            conn.close()


def run_server():
    init_db()
    server_address = ('', PORT)
    httpd = http.server.ThreadingHTTPServer(server_address, UpiRequestHandler)
    print(f"[OK] UPI Spendr SQLite REST API Server running at http://localhost:{PORT}")
    print(f"[OK] Persistent Database: {DB_FILE}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down server...")
        httpd.server_close()

if __name__ == '__main__':
    run_server()
