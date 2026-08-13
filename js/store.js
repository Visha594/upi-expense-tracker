/**
 * Central State Store with Live SQLite Database Sync & Persistence
 */

import { api } from './api.js';
import { authService } from './auth.js';

export function formatINR(amount, compact = false) {
  const num = Number(amount) || 0;
  if (compact) {
    if (Math.abs(num) >= 10000000) return `₹${(num / 10000000).toFixed(2)}Cr`;
    if (Math.abs(num) >= 100000) return `₹${(num / 100000).toFixed(1)}L`;
    if (Math.abs(num) >= 1000) return `₹${(num / 1000).toFixed(1)}k`;
  }
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: num % 1 === 0 ? 0 : 2
  }).format(num);
}

export function formatDateIndian(isoDateString) {
  if (!isoDateString) return '';
  const date = new Date(isoDateString);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const isToday = date.toDateString() === today.toDateString();
  const isYesterday = date.toDateString() === yesterday.toDateString();

  const timeStr = date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });

  if (isToday) return `Today, ${timeStr}`;
  if (isYesterday) return `Yesterday, ${timeStr}`;

  return `${date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}, ${timeStr}`;
}

class StateStore {
  constructor() {
    this.listeners = [];
    this.isDbConnected = false;
    this.dbStatus = null;
    this.state = {
      accounts: [
        { id: 'acc_primary', name: 'Salary Account', bank: 'HDFC Bank', accountLast4: '7890', account_last4: '7890', type: 'savings', balance: 34500, upiId: 'vishal@okhdfcbank', upi_id: 'vishal@okhdfcbank', theme: 'bank-hdfc' },
        { id: 'acc_secondary', name: 'Personal Savings', bank: 'SBI', accountLast4: '4921', account_last4: '4921', type: 'savings', balance: 9800, upiId: 'vishal@oksbi', upi_id: 'vishal@oksbi', theme: 'bank-sbi' },
        { id: 'acc_lite', name: 'UPI Lite Wallet', bank: 'UPI Lite', accountLast4: 'LITE', account_last4: 'LITE', type: 'wallet', balance: 980, upiId: 'vishal@okhdfcbank', upi_id: 'vishal@okhdfcbank', theme: 'bank-lite' }
      ],
      transactions: [],
      budgets: { food: 6000, grocery: 5000, transit: 3000, shopping: 4000, bills: 4500, entertainment: 2500 },
      friends: [],
      settings: {
        theme: 'dark',
        sound: true,
        voice: true,
        hideBalance: false,
        userUpi: 'vishal@okhdfcbank'
      }
    };
  }

  async initStore() {
    await this.syncFromDb();
  }

  async syncFromDb() {
    try {
      const [txs, accs, budgets, status] = await Promise.all([
        api.getTransactions().catch(() => []),
        api.getAccounts().catch(() => []),
        api.getBudgets().catch(() => ({})),
        api.getDbStatus().catch(() => null)
      ]);

      this.state.transactions = txs || [];
      this.state.accounts = accs || [];
      this.state.budgets = budgets || {};
      this.dbStatus = status;
      this.isDbConnected = status !== null;

      const user = authService.getCurrentUser();
      if (user) {
        this.state.settings.userUpi = user.upi_id || user.upiId || 'vishal@okhdfcbank';
      }

      this.notify();
    } catch (e) {
      console.warn('DB Sync error:', e);
      this.isDbConnected = false;
    }
  }

  subscribe(listener) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  notify() {
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }

  // Transaction CRUD (Syncs to SQLite DB)
  async addTransaction(tx) {
    const user = authService.getCurrentUser();
    const payload = {
      ...tx,
      user_id: user ? user.id : 'usr_demo',
      timestamp: tx.timestamp || new Date().toISOString(),
      upi_ref: tx.upiRef || `422${Date.now() % 1000000000}`
    };

    try {
      const saved = await api.addTransaction(payload);
      // Refresh state from database
      await this.syncFromDb();
      return saved;
    } catch (e) {
      // Local optimistic fallback
      const newTx = {
        id: 'tx_' + Date.now(),
        ...payload
      };
      this.state.transactions.unshift(newTx);
      this.notify();
      return newTx;
    }
  }

  async deleteTransaction(id) {
    try {
      await api.deleteTransaction(id);
      await this.syncFromDb();
    } catch (e) {
      this.state.transactions = this.state.transactions.filter(t => t.id !== id);
      this.notify();
    }
  }

  async updateBudget(categoryId, amount) {
    try {
      await api.updateBudget(categoryId, amount);
      this.state.budgets[categoryId] = Number(amount);
      this.notify();
    } catch (e) {
      this.state.budgets[categoryId] = Number(amount);
      this.notify();
    }
  }

  async topUpLite(amount) {
    try {
      await api.topUpLite(amount);
      await this.syncFromDb();
    } catch (e) {
      console.warn('Topup error:', e);
    }
  }

  async reloadSampleData() {
    try {
      await api.reloadSampleData();
      await this.syncFromDb();
    } catch (e) {
      console.warn('Reload sample error:', e);
    }
  }

  async clearAllData() {
    try {
      await api.clearUserData();
      await this.syncFromDb();
    } catch (e) {
      this.state.transactions = [];
      this.notify();
    }
  }

  updateSettings(partial) {
    this.state.settings = { ...this.state.settings, ...partial };
    this.notify();
  }

  // Computed Summaries
  getTotalBalance() {
    return this.state.accounts.reduce((acc, a) => acc + (a.type !== 'credit' ? Number(a.balance) : 0), 0);
  }

  getMonthlyTotals() {
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    let totalDebit = 0;
    let totalCredit = 0;
    let liteDebit = 0;

    for (const tx of this.state.transactions) {
      const d = new Date(tx.timestamp);
      if (d.getMonth() === currentMonth && d.getFullYear() === currentYear) {
        const amt = Number(tx.amount) || 0;
        if (tx.type === 'debit') {
          totalDebit += amt;
          if (tx.is_lite || tx.isLite) liteDebit += amt;
        } else if (tx.type === 'credit') {
          totalCredit += amt;
        }
      }
    }

    const daysInMonthSoFar = Math.max(1, now.getDate());
    const dailyAvg = totalDebit / daysInMonthSoFar;

    return { totalDebit, totalCredit, liteDebit, dailyAvg, daysInMonthSoFar };
  }

  getCategorySpends() {
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    const categoryMap = {};

    for (const tx of this.state.transactions) {
      const d = new Date(tx.timestamp);
      if (tx.type === 'debit' && d.getMonth() === currentMonth && d.getFullYear() === currentYear) {
        const cat = tx.category || 'other';
        categoryMap[cat] = (categoryMap[cat] || 0) + Number(tx.amount);
      }
    }

    return categoryMap;
  }

  getTopMerchants(limit = 5) {
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    const merchantMap = {};

    for (const tx of this.state.transactions) {
      const d = new Date(tx.timestamp);
      if (tx.type === 'debit' && d.getMonth() === currentMonth && d.getFullYear() === currentYear) {
        const name = tx.merchant || 'UPI Payee';
        if (!merchantMap[name]) {
          merchantMap[name] = { name, total: 0, count: 0 };
        }
        merchantMap[name].total += Number(tx.amount);
        merchantMap[name].count += 1;
      }
    }

    return Object.values(merchantMap)
      .sort((a, b) => b.total - a.total)
      .slice(0, limit);
  }
}

export const store = new StateStore();
