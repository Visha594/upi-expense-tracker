/**
 * Smart Spending Insights & In-App Notification Engine
 */

import { formatINR } from './store.js';

export class InsightsEngine {
  constructor(store) {
    this.store = store;
  }

  generateInsights() {
    const txs = this.store.state.transactions;
    const debits = txs.filter(t => t.type === 'debit');
    const totalDebit = debits.reduce((acc, t) => acc + Number(t.amount || 0), 0);
    const insights = [];

    if (debits.length === 0) {
      return [{
        type: 'info',
        icon: 'ℹ️',
        title: 'Start Tracking Spends',
        description: 'Add your first UPI transaction or parse a bank SMS to unlock intelligent spending trends and anomaly alerts.'
      }];
    }

    // 1. Top Category Burn Rate
    const catTotals = {};
    debits.forEach(t => {
      const cat = t.category || 'other';
      catTotals[cat] = (catTotals[cat] || 0) + Number(t.amount || 0);
    });

    const sortedCats = Object.entries(catTotals).sort((a, b) => b[1] - a[1]);
    if (sortedCats.length > 0) {
      const [topCat, topAmount] = sortedCats[0];
      const pct = Math.round((topAmount / totalDebit) * 100);
      insights.push({
        type: pct > 40 ? 'warning' : 'spending_trend',
        icon: pct > 40 ? '⚠️' : '📊',
        title: `Dominant Category: ${topCat.toUpperCase()} (${pct}%)`,
        description: `You have spent ${formatINR(topAmount)} on ${topCat} out of ${formatINR(totalDebit)} total monthly debits.`
      });
    }

    // 2. Micro-Transactions & UPI Lite Savings
    const microTxs = debits.filter(t => t.amount <= 500);
    const microCount = microTxs.length;
    if (microCount >= 3) {
      insights.push({
        type: 'micro_spend',
        icon: '⚡',
        title: 'Micro-Spend Alert (Under ₹500)',
        description: `${microCount} transactions are below ₹500 (Chai, Auto, Mart). Using UPI Lite prevents bank server timeouts and clutter.`
      });
    }

    // 3. Merchant Concentration
    const merchantTotals = {};
    debits.forEach(t => {
      const m = t.merchant || 'Payee';
      merchantTotals[m] = (merchantTotals[m] || 0) + Number(t.amount || 0);
    });
    const topMerchant = Object.entries(merchantTotals).sort((a, b) => b[1] - a[1])[0];
    if (topMerchant && topMerchant[1] > 1000) {
      insights.push({
        type: 'merchant_insight',
        icon: '🛍️',
        title: `Frequent Payee: ${topMerchant[0]}`,
        description: `Total ${formatINR(topMerchant[1])} paid to ${topMerchant[0]}. Consider setting a monthly limit or buying gift cards for cashback.`
      });
    }

    // 4. Budget Overrun Warnings
    const budgets = this.store.state.budgets || {};
    Object.entries(budgets).forEach(([cat, limit]) => {
      const spent = catTotals[cat] || 0;
      if (limit > 0 && spent >= limit) {
        insights.push({
          type: 'danger',
          icon: '🚨',
          title: `Budget Exceeded: ${cat.toUpperCase()}`,
          description: `You have exceeded your ${formatINR(limit)} limit for ${cat} (Spent: ${formatINR(spent)}).`
        });
      }
    });

    return insights;
  }

  getNotifications(upcomingBills = []) {
    const notifications = [];
    const insights = this.generateInsights();

    // Upcoming Bill Notifications
    upcomingBills.forEach(b => {
      if (b.isDueSoon || b.isOverdue) {
        notifications.push({
          id: `notif_${b.id}`,
          icon: '📅',
          title: b.isOverdue ? `Overdue: ${b.name}` : `Due in ${b.daysUntil} days: ${b.name}`,
          time: b.next_due_date,
          text: `Amount: ${formatINR(b.amount)} • Tap to settle now.`,
          actionType: 'pay_bill',
          bill: b
        });
      }
    });

    // Add high-priority insights as notifications
    insights.filter(i => i.type === 'danger' || i.type === 'warning').forEach((ins, idx) => {
      notifications.push({
        id: `ins_${idx}`,
        icon: ins.icon,
        title: ins.title,
        time: 'Just now',
        text: ins.description,
        actionType: 'view_budget'
      });
    });

    return notifications;
  }
}
