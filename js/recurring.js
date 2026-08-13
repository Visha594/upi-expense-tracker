/**
 * Recurring Bills, EMIs & Subscriptions Controller
 */

import { api } from './api.js';
import { formatINR } from './store.js';
import { audioService } from './audioChime.js';

export class RecurringController {
  constructor(store) {
    this.store = store;
    this.recurringBills = [];
  }

  async loadRecurring() {
    try {
      this.recurringBills = await api.fetchJson('/recurring').catch(() => []);
    } catch (e) {
      console.warn('Failed to load recurring bills:', e);
      this.recurringBills = [];
    }
  }

  getUpcomingBills() {
    const today = new Date().toISOString().split('T')[0];
    return this.recurringBills.map(b => {
      const daysUntil = Math.ceil((new Date(b.next_due_date || b.nextDueDate) - new Date()) / (1000 * 60 * 60 * 24));
      return {
        ...b,
        daysUntil: Math.max(0, daysUntil),
        isDueSoon: daysUntil >= 0 && daysUntil <= 3,
        isOverdue: daysUntil < 0
      };
    }).sort((a, b) => new Date(a.next_due_date) - new Date(b.next_due_date));
  }

  getTotalMonthlyObligations() {
    return this.recurringBills.reduce((acc, b) => acc + Number(b.amount || 0), 0);
  }

  async addRecurring(bill) {
    try {
      const saved = await api.fetchJson('/recurring', {
        method: 'POST',
        body: JSON.stringify(bill)
      });
      await this.loadRecurring();
      return saved;
    } catch (e) {
      console.warn('Add recurring error:', e);
    }
  }

  async deleteRecurring(id) {
    try {
      await api.fetchJson(`/recurring/${id}`, { method: 'DELETE' });
      await this.loadRecurring();
    } catch (e) {
      console.warn('Delete recurring error:', e);
    }
  }

  async payRecurringNow(bill, accountId) {
    // Log as debit transaction in SQLite
    const account = this.store.state.accounts.find(a => a.id === accountId) || this.store.state.accounts[0];
    const tx = await this.store.addTransaction({
      type: 'debit',
      amount: bill.amount,
      merchant: bill.name,
      category: bill.category || 'bills',
      accountId: account ? account.id : 'acc_primary',
      bank: account ? account.bank : 'HDFC',
      accountLast4: account ? (account.account_last4 || account.accountLast4) : '7890',
      note: `Recurring payment for ${bill.name}`,
      isLite: bill.amount <= 500
    });

    audioService.playUpiSuccessChime();
    audioService.speakPayment(bill.amount, bill.name, 'debit');
    return tx;
  }
}
