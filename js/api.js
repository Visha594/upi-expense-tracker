/**
 * Frontend REST API Client for SQLite Backend
 */

import { authService } from './auth.js';

class ApiClient {
  constructor() {
    this.baseUrl = '/api';
  }

  getHeaders() {
    const user = authService.getCurrentUser();
    return {
      'Content-Type': 'application/json',
      'X-User-Id': user ? user.id : 'usr_demo'
    };
  }

  async fetchJson(endpoint, options = {}) {
    try {
      const res = await fetch(`${this.baseUrl}${endpoint}`, {
        ...options,
        headers: {
          ...this.getHeaders(),
          ...(options.headers || {})
        }
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.message || errorData.error || `HTTP error ${res.status}`);
      }
      return await res.json();
    } catch (e) {
      console.warn(`API call ${endpoint} failed:`, e);
      throw e;
    }
  }

  // Auth
  async login(identifier, pin) {
    return this.fetchJson('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier, pin })
    });
  }

  async loginDemo() {
    return this.fetchJson('/auth/demo', {
      method: 'POST'
    });
  }

  async register(userData) {
    return this.fetchJson('/auth/register', {
      method: 'POST',
      body: JSON.stringify(userData)
    });
  }

  // Transactions
  async getTransactions() {
    return this.fetchJson('/transactions');
  }

  async addTransaction(tx) {
    return this.fetchJson('/transactions', {
      method: 'POST',
      body: JSON.stringify(tx)
    });
  }

  async deleteTransaction(id) {
    return this.fetchJson(`/transactions/${id}`, {
      method: 'DELETE'
    });
  }

  // Accounts
  async getAccounts() {
    return this.fetchJson('/accounts');
  }

  async topUpLite(amount) {
    return this.fetchJson('/accounts/topup-lite', {
      method: 'POST',
      body: JSON.stringify({ amount })
    });
  }

  // Budgets
  async getBudgets() {
    return this.fetchJson('/budgets');
  }

  async updateBudget(categoryId, amount) {
    return this.fetchJson('/budgets', {
      method: 'POST',
      body: JSON.stringify({ categoryId, amount })
    });
  }

  // Recurring Bills
  async getRecurring() {
    return this.fetchJson('/recurring');
  }

  async addRecurring(bill) {
    return this.fetchJson('/recurring', {
      method: 'POST',
      body: JSON.stringify(bill)
    });
  }

  async deleteRecurring(id) {
    return this.fetchJson(`/recurring/${id}`, {
      method: 'DELETE'
    });
  }

  // Split Groups & Expenses
  async getSplitGroups() {
    return this.fetchJson('/split/groups');
  }

  async createSplitGroup(groupData) {
    return this.fetchJson('/split/groups', {
      method: 'POST',
      body: JSON.stringify(groupData)
    });
  }

  async addGroupExpense(expenseData) {
    return this.fetchJson('/split/expenses', {
      method: 'POST',
      body: JSON.stringify(expenseData)
    });
  }

  // Insights
  async getInsights() {
    return this.fetchJson('/insights');
  }

  // Database Management
  async getDbStatus() {
    return this.fetchJson('/db/status');
  }

  async getDbTables() {
    return this.fetchJson('/db/tables');
  }

  async reloadSampleData() {
    return this.fetchJson('/db/reload-sample', { method: 'POST' });
  }

  async clearUserData() {
    return this.fetchJson('/db/clear', { method: 'POST' });
  }
}

export const api = new ApiClient();
