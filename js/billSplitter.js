/**
 * UPI Bill Splitter & Splitwise Group Expense Manager
 * Supports Group Ledgers, Balance Settlements, UPI Deep Links, and QR Generation.
 */

import { api } from './api.js';
import { generateUpiQrMatrix, buildUpiPaymentUri } from './qrEngine.js';
import { formatINR } from './store.js';

export class BillSplitterController {
  constructor(store, canvasElement) {
    this.store = store;
    this.canvas = canvasElement;
    this.groups = [];
    this.activeGroupId = null;

    // Default standalone split state
    this.title = 'Dinner at Social';
    this.totalAmount = 1200;
    this.participants = [
      { id: 'p1', name: 'Vishal (You)', upiId: 'vishal@okhdfcbank', share: 400, isMe: true },
      { id: 'p2', name: 'Aarav Sharma', upiId: 'aarav@okaxis', share: 400, isMe: false },
      { id: 'p3', name: 'Pooja Nair', upiId: 'pooja@okhdfcbank', share: 400, isMe: false }
    ];
  }

  async loadGroups() {
    try {
      this.groups = await api.fetchJson('/split/groups').catch(() => []);
      if (this.groups.length > 0 && !this.activeGroupId) {
        this.activeGroupId = this.groups[0].id;
      }
    } catch (e) {
      console.warn('Failed to load split groups:', e);
      this.groups = [];
    }
  }

  getActiveGroup() {
    return this.groups.find(g => g.id === this.activeGroupId) || this.groups[0] || null;
  }

  async createGroup(name, description, category, members) {
    try {
      const res = await api.fetchJson('/split/groups', {
        method: 'POST',
        body: JSON.stringify({ name, description, category, members })
      });
      await this.loadGroups();
      this.activeGroupId = res.id;
      return res;
    } catch (e) {
      console.warn('Create group error:', e);
    }
  }

  async addGroupExpense(groupId, title, amount, paidByName) {
    try {
      const res = await api.fetchJson('/split/expenses', {
        method: 'POST',
        body: JSON.stringify({ groupId, title, amount, paidByName })
      });
      await this.loadGroups();
      return res;
    } catch (e) {
      console.warn('Add group expense error:', e);
    }
  }

  /**
   * Calculates net balances for active group members:
   * Returns array of settlements: [{ from, to, amount, toUpi }]
   */
  calculateGroupSettlements(group) {
    if (!group || !group.members || !group.expenses || group.members.length === 0) {
      return [];
    }

    const n = group.members.length;
    const balances = {}; // name -> net amount (positive: should receive, negative: owes)
    group.members.forEach(m => { balances[m.name] = 0; });

    group.expenses.forEach(exp => {
      const amt = Number(exp.amount || 0);
      const splitShare = amt / n;
      const payer = exp.paid_by_name || exp.paidByName;

      if (balances[payer] !== undefined) {
        balances[payer] += amt;
      }
      group.members.forEach(m => {
        balances[m.name] -= splitShare;
      });
    });

    // Simplify debts (Greedy match debtors to creditors)
    const debtors = [];
    const creditors = [];

    Object.entries(balances).forEach(([name, bal]) => {
      if (bal < -0.5) debtors.push({ name, amount: -bal });
      else if (bal > 0.5) creditors.push({ name, amount: bal });
    });

    const settlements = [];
    let i = 0, j = 0;

    while (i < debtors.length && j < creditors.length) {
      const debtor = debtors[i];
      const creditor = creditors[j];
      const amount = Math.min(debtor.amount, creditor.amount);

      const credMember = group.members.find(m => m.name === creditor.name);
      settlements.push({
        from: debtor.name,
        to: creditor.name,
        amount: Math.round(amount),
        toUpi: credMember ? credMember.upi_id || credMember.upiId : 'upi@bank'
      });

      debtor.amount -= amount;
      creditor.amount -= amount;

      if (debtor.amount <= 0.5) i++;
      if (creditor.amount <= 0.5) j++;
    }

    return settlements;
  }

  // Standalone Split Management Methods
  setTitle(title) {
    this.title = title || 'Shared Bill';
  }

  setTotal(total) {
    this.totalAmount = Math.max(0, Number(total) || 0);
    this.recalculateShares();
  }

  addParticipant(name, upiId) {
    const id = 'p_' + Date.now();
    this.participants.push({
      id,
      name,
      upiId: upiId || `${name.toLowerCase().replace(/\s+/g, '')}@okaxis`,
      share: 0,
      isMe: false
    });
    this.recalculateShares();
  }

  removeParticipant(id) {
    if (this.participants.length <= 1) return;
    this.participants = this.participants.filter(p => p.id !== id);
    this.recalculateShares();
  }

  recalculateShares() {
    const count = this.participants.length;
    if (count === 0) return;
    const equalShare = Math.round((this.totalAmount / count) * 100) / 100;
    this.participants.forEach(p => { p.share = equalShare; });
  }

  getPerPersonShare() {
    if (this.participants.length === 0) return 0;
    return Math.round((this.totalAmount / this.participants.length) * 100) / 100;
  }

  generateSettlementQr(payeeUpi, amount) {
    if (!this.canvas) return '';
    const uri = buildUpiPaymentUri(payeeUpi, 'Vishal Sharma', amount, `Split: ${this.title}`);
    generateUpiQrMatrix(this.canvas, uri, 180);
    return uri;
  }

  getWhatsAppShareText(participant) {
    const amount = participant.share || this.getPerPersonShare();
    const user = this.store.state.currentUser || { name: 'Vishal', upiId: 'vishal@okhdfcbank' };
    const upiLink = buildUpiPaymentUri(user.upiId || 'vishal@okhdfcbank', user.name || 'Vishal', amount, `Split: ${this.title}`);
    const message = `Hey ${participant.name}! 👋\nYour share for *${this.title}* is *${formatINR(amount)}*.\n\n⚡ Pay instantly via UPI Link:\n${upiLink}\n\nThank you!`;
    return encodeURIComponent(message);
  }
}
