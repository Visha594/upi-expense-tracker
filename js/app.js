/**
 * UPI Spendr - Main Application Orchestrator (PWA + Splitwise + Recurring + SQLite DB)
 */

import { api } from './api.js';
import { authService } from './auth.js';
import { store, formatINR, formatDateIndian } from './store.js';
import { CATEGORIES, parseBankSms, SAMPLE_BANK_SMS } from './smsParser.js';
import { audioService } from './audioChime.js';
import { renderCategoryDonutChart, renderDailyTrendChart } from './charts.js';
import { BillSplitterController } from './billSplitter.js';
import { RecurringController } from './recurring.js';
import { InsightsEngine } from './insights.js';
import { exportTransactionsToCsv, exportBackupJson, importBackupJson } from './exportUtils.js';

export class UpiExpenseApp {
  constructor() {
    this.currentTab = 'dashboard';
    this.selectedFilterCategory = 'all';
    this.selectedFilterType = 'all';
    this.searchQuery = '';
    this.pinEntered = '';
    this.deferredPrompt = null;

    // Sub-controllers
    this.recurring = new RecurringController(store);
    this.billSplitter = null;
    this.insights = new InsightsEngine(store);

    this.init();
  }

  async init() {
    try {
      this.registerServiceWorker();
      this.setupPwaInstallPrompt();
      this.applyTheme(store.state.settings.theme || 'dark');
      this.bindAuthEvents();
      this.bindAppEvents();
      this.initBillSplitter();

      // Check Auth Status & Load DB State
      await this.checkAuthAndRender();

      // Subscribe to store updates
      store.subscribe(() => {
        if (authService.isLoggedIn()) {
          this.render();
        }
      });

      // Window resize handler for charts
      window.addEventListener('resize', () => {
        if (authService.isLoggedIn()) {
          this.renderCharts();
        }
      });
    } catch (err) {
      console.error('App init error:', err);
      const authScreen = document.getElementById('auth-screen');
      if (authScreen && !authService.isLoggedIn()) {
        authScreen.style.display = 'flex';
      }
    }
  }

  registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
          .then((reg) => console.log('✓ UPI Spendr PWA Service Worker Registered', reg.scope))
          .catch((err) => console.warn('PWA Service Worker Registration Failed:', err));
      });
    }
  }

  setupPwaInstallPrompt() {
    const banner = document.getElementById('pwa-install-banner');
    const btnInstall = document.getElementById('btn-pwa-install');
    const btnDismiss = document.getElementById('btn-pwa-dismiss');

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.deferredPrompt = e;
      if (banner) banner.style.display = 'flex';
    });

    btnInstall?.addEventListener('click', async () => {
      if (this.deferredPrompt) {
        this.deferredPrompt.prompt();
        const { outcome } = await this.deferredPrompt.userChoice;
        if (outcome === 'accepted') {
          this.showToast('UPI Spendr installed to Home Screen!', 'success');
        }
        this.deferredPrompt = null;
        if (banner) banner.style.display = 'none';
      }
    });

    btnDismiss?.addEventListener('click', () => {
      if (banner) banner.style.display = 'none';
    });
  }

  async checkAuthAndRender() {
    const authScreen = document.getElementById('auth-screen');
    const mainScreen = document.getElementById('main-app-screen');

    if (!authService.isLoggedIn()) {
      if (authScreen) authScreen.style.display = 'flex';
      if (mainScreen) mainScreen.style.display = 'none';
    } else {
      if (authScreen) authScreen.style.display = 'none';
      if (mainScreen) mainScreen.style.display = 'block';
      this.updateUserProfileDisplay();

      try {
        await store.initStore();
      } catch (e) {
        console.warn('Store sync warning:', e);
      }

      try {
        await this.recurring.loadRecurring();
      } catch (e) {
        console.warn('Recurring load warning:', e);
      }

      try {
        if (this.billSplitter) {
          await this.billSplitter.loadGroups();
        }
      } catch (e) {
        console.warn('Bill splitter load warning:', e);
      }

      try {
        this.render();
      } catch (e) {
        console.error('Render error:', e);
      }

      try {
        this.renderDbConsole();
      } catch (e) {
        console.warn('DB console render warning:', e);
      }

      try {
        this.renderNotifications();
      } catch (e) {
        console.warn('Notification render warning:', e);
      }

      setTimeout(() => {
        try {
          this.renderCharts();
        } catch (e) {
          console.warn('Charts render warning:', e);
        }
      }, 100);
    }
  }

  updateUserProfileDisplay() {
    const user = authService.getCurrentUser();
    if (!user) return;

    const nameEl = document.getElementById('user-display-name');
    const avatarEl = document.getElementById('user-avatar-icon');
    if (nameEl) nameEl.textContent = (user.name || 'User').split(' ')[0];
    if (avatarEl) avatarEl.textContent = user.avatar || '👨‍💼';
  }

  applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    store.updateSettings({ theme });
    const themeBtn = document.getElementById('theme-toggle-btn');
    if (themeBtn) {
      themeBtn.innerHTML = theme === 'dark' ? '☀️ Light' : '🌙 Dark';
    }
  }

  showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
      <span>${type === 'success' ? '✅' : type === 'error' ? '⚠️' : 'ℹ️'}</span>
      <span>${message}</span>
    `;

    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      setTimeout(() => toast.remove(), 300);
    }, 3200);
  }

  bindAuthEvents() {
    const tabLogin = document.getElementById('tab-auth-login');
    const tabRegister = document.getElementById('tab-auth-register');
    const formLogin = document.getElementById('form-auth-login');
    const formRegister = document.getElementById('form-auth-register');

    tabLogin?.addEventListener('click', () => {
      tabLogin.classList.add('active');
      tabRegister.classList.remove('active');
      if (formLogin) formLogin.style.display = 'flex';
      if (formRegister) formRegister.style.display = 'none';
    });

    tabRegister?.addEventListener('click', () => {
      tabRegister.classList.add('active');
      tabLogin.classList.remove('active');
      if (formLogin) formLogin.style.display = 'none';
      if (formRegister) formRegister.style.display = 'flex';
    });

    // Login Form Submit (Direct DB Auth)
    formLogin?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = document.getElementById('login-input-id')?.value;
      const pin = document.getElementById('login-input-pin')?.value;
      const res = await authService.login(id, pin);
      if (res.success) {
        this.showToast(`Welcome back, ${res.user.name}!`, 'success');
        audioService.playUpiSuccessChime();
        await this.checkAuthAndRender();
      } else {
        this.showToast(res.message, 'error');
      }
    });

    // Demo Login Button
    document.getElementById('btn-auth-demo')?.addEventListener('click', async () => {
      const res = await authService.loginDemo();
      this.showToast(`Logged in as ${res.user.name} (Demo Mode)`, 'success');
      audioService.playUpiSuccessChime();
      await this.checkAuthAndRender();
    });

    // Register Form Submit (Direct DB Insert)
    formRegister?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('reg-input-name')?.value;
      const phone = document.getElementById('reg-input-phone')?.value;
      const upi = document.getElementById('reg-input-upi')?.value;
      const pin = document.getElementById('reg-input-pin')?.value;

      const res = await authService.register({ name, phone, upiId: upi, pin });
      if (res.success) {
        this.showToast(`Account saved to SQLite! Welcome, ${res.user.name}`, 'success');
        audioService.playUpiSuccessChime();
        await this.checkAuthAndRender();
      } else {
        this.showToast(res.message, 'error');
      }
    });

    // Logout
    document.getElementById('btn-user-logout')?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (confirm('Are you sure you want to log out?')) {
        authService.logout();
        this.showToast('Logged out successfully', 'info');
        this.checkAuthAndRender();
      }
    });
  }

  bindAppEvents() {
    // Tab switching (Desktop + Mobile)
    document.querySelectorAll('.nav-tab, .mobile-nav-item').forEach(tab => {
      tab.addEventListener('click', () => {
        const tabName = tab.getAttribute('data-tab');
        this.switchTab(tabName);
      });
    });

    // Theme toggle
    document.getElementById('theme-toggle-btn')?.addEventListener('click', () => {
      const newTheme = store.state.settings.theme === 'dark' ? 'light' : 'dark';
      this.applyTheme(newTheme);
    });

    // Notification Popover Toggle
    const notifBtn = document.getElementById('btn-open-notifications');
    const notifPopover = document.getElementById('notif-popover');
    notifBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      notifPopover?.classList.toggle('active');
    });

    document.addEventListener('click', (e) => {
      if (!notifPopover?.contains(e.target) && e.target !== notifBtn) {
        notifPopover?.classList.remove('active');
      }
    });

    // Pro Tier Modals
    document.getElementById('btn-open-pro')?.addEventListener('click', () => this.openModal('modal-pro-tier'));
    document.getElementById('link-monetization-plan')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.openModal('modal-pro-tier');
    });
    document.getElementById('btn-activate-demo-pro')?.addEventListener('click', () => {
      this.showToast('PRO Features unlocked for your account!', 'success');
      this.closeAllModals();
    });

    // Privacy & Terms Modals
    document.getElementById('link-privacy-policy')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.openModal('modal-privacy-terms');
    });
    document.getElementById('link-terms-service')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.openModal('modal-privacy-terms');
    });

    // Hide/Show balance toggle
    document.getElementById('balance-eye-btn')?.addEventListener('click', () => {
      const current = store.state.settings.hideBalance;
      store.updateSettings({ hideBalance: !current });
      this.showToast(!current ? 'Balance hidden' : 'Balance visible');
    });

    // Sound toggle
    document.getElementById('sound-toggle-btn')?.addEventListener('click', () => {
      const enabled = !store.state.settings.sound;
      store.updateSettings({ sound: enabled });
      audioService.toggleSound(enabled);
      document.getElementById('sound-toggle-btn').textContent = enabled ? '🔊 Sound: ON' : '🔇 Sound: OFF';
      this.showToast(`Sound ${enabled ? 'Enabled' : 'Disabled'}`);
    });

    // Voice toggle
    document.getElementById('voice-toggle-btn')?.addEventListener('click', () => {
      const enabled = !store.state.settings.voice;
      store.updateSettings({ voice: enabled });
      audioService.toggleVoice(enabled);
      document.getElementById('voice-toggle-btn').textContent = enabled ? '🗣️ Voice: ON' : '🤐 Voice: OFF';
      this.showToast(`Voice announcer ${enabled ? 'Enabled' : 'Disabled'}`);
    });

    // Quick Log Chips
    document.querySelectorAll('.quick-chip').forEach(chip => {
      chip.addEventListener('click', async () => {
        const amount = Number(chip.getAttribute('data-amount'));
        const merchant = chip.getAttribute('data-merchant');
        const category = chip.getAttribute('data-category');
        const isLite = amount <= 500;

        const account = isLite
          ? store.state.accounts.find(a => a.id === 'acc_lite' || a.type === 'wallet') || store.state.accounts[0]
          : store.state.accounts[0];

        await store.addTransaction({
          type: 'debit',
          amount,
          merchant,
          category,
          accountId: account ? account.id : 'acc_primary',
          bank: account ? account.bank : 'UPI Bank',
          accountLast4: account ? (account.account_last4 || account.accountLast4) : '1234',
          note: `Quick 1-tap ${merchant}`,
          isLite
        });

        audioService.playUpiSuccessChime();
        audioService.speakPayment(amount, merchant, 'debit');
        this.showToast(`₹${amount} paid to ${merchant} saved to DB!`, 'success');
      });
    });

    // Modals Triggers
    document.getElementById('btn-open-add-tx')?.addEventListener('click', () => {
      const dtInput = document.getElementById('input-tx-datetime');
      if (dtInput) {
        const now = new Date();
        now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
        dtInput.value = now.toISOString().slice(0, 16);
      }
      this.openModal('modal-add-tx');
    });

    document.getElementById('btn-open-sms-parser')?.addEventListener('click', () => this.openModal('modal-sms-parser'));
    document.getElementById('btn-quick-sms-promo')?.addEventListener('click', () => this.openModal('modal-sms-parser'));
    document.getElementById('btn-open-upi-sim')?.addEventListener('click', () => this.openUpiSimulator());

    // Recurring & Splitwise Modal Triggers
    document.getElementById('btn-open-add-recurring')?.addEventListener('click', () => this.openModal('modal-add-recurring'));
    document.getElementById('btn-open-create-group')?.addEventListener('click', () => this.openModal('modal-create-group'));
    document.getElementById('btn-open-add-group-exp')?.addEventListener('click', () => {
      this.renderGroupPayerSelect();
      this.openModal('modal-add-group-exp');
    });

    // Close Modals
    document.querySelectorAll('.modal-close, .btn-modal-cancel').forEach(btn => {
      btn.addEventListener('click', () => this.closeAllModals());
    });

    // Search and Filters
    document.getElementById('tx-search-input')?.addEventListener('input', (e) => {
      this.searchQuery = e.target.value.toLowerCase();
      this.renderTransactionList();
    });

    document.getElementById('tx-filter-category')?.addEventListener('change', (e) => {
      this.selectedFilterCategory = e.target.value;
      this.renderTransactionList();
    });

    document.getElementById('tx-filter-type')?.addEventListener('change', (e) => {
      this.selectedFilterType = e.target.value;
      this.renderTransactionList();
    });

    // Add Transaction Form Submit
    document.getElementById('form-add-tx')?.addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleAddTransactionSubmit();
    });

    // Add Recurring Bill Form Submit
    document.getElementById('form-add-recurring')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('rec-input-name')?.value;
      const amount = Number(document.getElementById('rec-input-amount')?.value);
      const category = document.getElementById('rec-input-category')?.value;
      const dueDay = Number(document.getElementById('rec-input-day')?.value);
      const frequency = document.getElementById('rec-input-freq')?.value;
      const autoPay = document.getElementById('rec-input-autopay')?.checked;

      await this.recurring.addRecurring({ name, amount, category, dueDay, frequency, autoPay });
      this.showToast(`${name} subscription saved to database!`, 'success');
      this.closeAllModals();
      this.renderRecurringTab();
      this.renderNotifications();
    });

    // Create Group Form Submit
    document.getElementById('form-create-group')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('grp-input-name')?.value;
      const desc = document.getElementById('grp-input-desc')?.value;
      const category = document.getElementById('grp-input-category')?.value;

      await this.billSplitter.createGroup(name, desc, category, []);
      this.showToast(`Group '${name}' created in database!`, 'success');
      this.closeAllModals();
      this.renderSplitGroupsTab();
    });

    // Add Group Expense Form Submit
    document.getElementById('form-add-group-exp')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const activeGroup = this.billSplitter?.getActiveGroup();
      if (!activeGroup) return;

      const title = document.getElementById('exp-input-title')?.value;
      const amount = Number(document.getElementById('exp-input-amount')?.value);
      const paidBy = document.getElementById('exp-select-payer')?.value;

      await this.billSplitter.addGroupExpense(activeGroup.id, title, amount, paidBy);
      audioService.playUpiSuccessChime();
      this.showToast(`₹${amount} recorded in ${activeGroup.name}!`, 'success');
      this.closeAllModals();
      this.renderSplitGroupsTab();
    });

    // SMS Parser UI
    this.bindSmsParserEvents();

    // UPI Simulator Keypad Events
    this.bindUpiSimulatorEvents();

    // DB Refresh
    document.getElementById('btn-refresh-db-stats')?.addEventListener('click', () => {
      this.renderDbConsole();
      this.showToast('Database metrics refreshed from SQLite', 'success');
    });

    // Data Export & Reset Actions
    document.getElementById('btn-export-csv')?.addEventListener('click', () => {
      exportTransactionsToCsv(store.state.transactions);
      this.showToast('CSV exported from database!', 'success');
    });

    document.getElementById('btn-export-json')?.addEventListener('click', () => {
      exportBackupJson(store.state);
      this.showToast('Backup JSON downloaded!', 'success');
    });

    document.getElementById('input-import-json')?.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        importBackupJson(
          file,
          store,
          () => this.showToast('Data restored successfully!', 'success'),
          (err) => this.showToast('Failed to import: ' + err, 'error')
        );
      }
    });

    document.getElementById('btn-reload-sample')?.addEventListener('click', async () => {
      if (confirm('Reload default sample Indian UPI dataset into SQLite Database?')) {
        await store.reloadSampleData();
        await this.recurring.loadRecurring();
        if (this.billSplitter) await this.billSplitter.loadGroups();
        this.showToast('Sample dataset reloaded into SQLite!', 'success');
        this.render();
      }
    });

    document.getElementById('btn-clear-all')?.addEventListener('click', async () => {
      if (confirm('Are you sure you want to clear all transactions from the SQLite database?')) {
        await store.clearAllData();
        this.showToast('Database transactions cleared.', 'info');
        this.render();
      }
    });

    // Top-up UPI Lite
    document.getElementById('btn-topup-lite')?.addEventListener('click', async () => {
      const amount = prompt('Enter amount to top up UPI Lite wallet (Max ₹2,000):', '500');
      const num = Number(amount);
      if (num > 0 && num <= 2000) {
        await store.topUpLite(num);
        audioService.playUpiSuccessChime();
        this.showToast(`Loaded ${formatINR(num)} into UPI Lite in Database!`, 'success');
      }
    });
  }

  switchTab(tabName) {
    this.currentTab = tabName;
    document.querySelectorAll('.nav-tab').forEach(t => {
      t.classList.toggle('active', t.getAttribute('data-tab') === tabName);
    });
    document.querySelectorAll('.mobile-nav-item').forEach(t => {
      t.classList.toggle('active', t.getAttribute('data-tab') === tabName);
    });

    document.querySelectorAll('.tab-pane').forEach(p => {
      p.classList.toggle('active', p.id === `tab-${tabName}`);
    });

    if (tabName === 'analytics' || tabName === 'dashboard') {
      setTimeout(() => this.renderCharts(), 60);
    }
    if (tabName === 'database') {
      this.renderDbConsole();
    }
    if (tabName === 'recurring') {
      this.renderRecurringTab();
    }
    if (tabName === 'split') {
      this.renderSplitGroupsTab();
    }
  }

  openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.classList.add('active');
    }
  }

  closeAllModals() {
    document.querySelectorAll('.modal-backdrop').forEach(m => m.classList.remove('active'));
  }

  render() {
    this.renderHeaderBalance();
    this.renderDashboardStats();
    this.renderDashboardInsights();
    this.renderAccountSelectOptions();
    this.renderTransactionList();
    this.renderCharts();
    this.renderRecurringTab();
    this.renderSplitGroupsTab();
    this.renderAccountsTab();
    this.renderBudgetsTab();
    this.renderTopMerchants();
    this.renderNotifications();
  }

  renderHeaderBalance() {
    const totalBalEl = document.getElementById('header-total-balance');
    const hide = store.state.settings.hideBalance;
    if (totalBalEl) {
      totalBalEl.textContent = hide ? '₹ ••••••' : formatINR(store.getTotalBalance());
    }
  }

  renderDashboardStats() {
    const totals = store.getMonthlyTotals();
    const hide = store.state.settings.hideBalance;

    const elDebit = document.getElementById('kpi-month-debit');
    const elCredit = document.getElementById('kpi-month-credit');
    const elDaily = document.getElementById('kpi-daily-avg');
    const elLite = document.getElementById('kpi-lite-balance');

    const liteAcc = store.state.accounts.find(a => a.id === 'acc_lite' || a.type === 'wallet');

    if (elDebit) elDebit.textContent = hide ? '₹ ••••' : formatINR(totals.totalDebit);
    if (elCredit) elCredit.textContent = hide ? '₹ ••••' : formatINR(totals.totalCredit);
    if (elDaily) elDaily.textContent = hide ? '₹ ••••' : `${formatINR(totals.dailyAvg)} / day`;
    if (elLite) elLite.textContent = hide ? '₹ ••••' : formatINR(liteAcc ? liteAcc.balance : 0);
  }

  renderDashboardInsights() {
    const container = document.getElementById('dashboard-insights-container');
    if (!container) return;

    const items = this.insights.generateInsights();
    container.innerHTML = items.map(ins => `
      <div style="background: var(--bg-card); padding: 0.75rem 0.9rem; border-radius: var(--radius-md); border: 1px solid var(--border-subtle); display: flex; align-items: flex-start; gap: 0.65rem;">
        <span style="font-size: 1.3rem;">${ins.icon}</span>
        <div>
          <div style="font-weight: 700; font-size: 0.85rem; color: var(--text-primary);">${ins.title}</div>
          <div style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 0.15rem;">${ins.description}</div>
        </div>
      </div>
    `).join('');
  }

  renderNotifications() {
    const upcoming = this.recurring.getUpcomingBills();
    const notifs = this.insights.getNotifications(upcoming);

    const badge = document.getElementById('notif-count-badge');
    const headerCount = document.getElementById('notif-header-count');
    const list = document.getElementById('notif-items-list');

    if (badge) {
      badge.textContent = notifs.length;
      badge.style.display = notifs.length > 0 ? 'flex' : 'none';
    }
    if (headerCount) {
      headerCount.textContent = `${notifs.length} alerts`;
    }
    if (list) {
      if (notifs.length === 0) {
        list.innerHTML = '<div style="padding: 0.5rem; text-align: center; color: var(--text-muted); font-size: 0.75rem;">No active alerts. All bills on track!</div>';
        return;
      }
      list.innerHTML = notifs.map(n => `
        <div class="notif-item">
          <span style="font-size: 1.1rem;">${n.icon}</span>
          <div style="flex: 1;">
            <div style="font-weight: 700; color: var(--text-primary);">${n.title}</div>
            <div style="color: var(--text-secondary); font-size: 0.72rem;">${n.text}</div>
            <div style="font-size: 0.65rem; color: var(--text-muted); margin-top: 0.2rem;">${n.time}</div>
          </div>
        </div>
      `).join('');
    }
  }

  renderRecurringTab() {
    const grid = document.getElementById('recurring-bills-grid');
    const totalEl = document.getElementById('rec-total-monthly');
    const countEl = document.getElementById('rec-active-count');

    const bills = this.recurring.getUpcomingBills();
    if (totalEl) totalEl.textContent = formatINR(this.recurring.getTotalMonthlyObligations());
    if (countEl) countEl.textContent = bills.length;

    if (!grid) return;

    if (bills.length === 0) {
      grid.innerHTML = '<div style="color: var(--text-muted); padding: 1.5rem; text-align: center;">No recurring subscriptions added yet.</div>';
      return;
    }

    grid.innerHTML = bills.map(b => `
      <div class="recurring-card">
        <div class="recurring-card-top">
          <div>
            <div class="recurring-name">${b.name}</div>
            <div class="recurring-cat">${b.category} • ${b.frequency}</div>
          </div>
          <span class="recurring-due-pill ${b.isDueSoon ? 'soon' : 'safe'}">
            ${b.isOverdue ? 'Overdue!' : b.daysUntil === 0 ? 'Due Today!' : `Due in ${b.daysUntil}d`}
          </span>
        </div>
        <div style="display: flex; align-items: baseline; justify-content: space-between;">
          <div class="recurring-amount">${formatINR(b.amount)}</div>
          ${b.auto_pay || b.autoPay ? '<span class="badge badge-credit">🔄 AutoPay Active</span>' : ''}
        </div>
        <div style="display: flex; gap: 0.5rem; padding-top: 0.4rem; border-top: 1px solid var(--border-subtle);">
          <button class="btn btn-sm btn-success btn-pay-rec-now" data-id="${b.id}" style="flex: 1;">⚡ Pay Now</button>
          <button class="btn-action-icon delete btn-del-rec" data-id="${b.id}">🗑️</button>
        </div>
      </div>
    `).join('');

    grid.querySelectorAll('.btn-pay-rec-now').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        const bill = bills.find(b => b.id === id);
        if (bill) {
          await this.recurring.payRecurringNow(bill, store.state.accounts[0]?.id);
          this.showToast(`Paid ${formatINR(bill.amount)} for ${bill.name}! Stored in DB`, 'success');
        }
      });
    });

    grid.querySelectorAll('.btn-del-rec').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        if (confirm('Delete this subscription from database?')) {
          await this.recurring.deleteRecurring(id);
          this.renderRecurringTab();
          this.renderNotifications();
          this.showToast('Subscription deleted', 'info');
        }
      });
    });
  }

  // Splitwise Multi-Group Tab
  renderSplitGroupsTab() {
    const tabsContainer = document.getElementById('split-groups-tabs-container');
    const groupTitle = document.getElementById('active-group-title');
    const groupTotal = document.getElementById('active-group-total-spent');
    const expList = document.getElementById('active-group-expenses-list');
    const settlementsList = document.getElementById('group-settlements-list');

    const groups = this.billSplitter?.groups || [];
    if (!tabsContainer) return;

    tabsContainer.innerHTML = groups.map(g => `
      <button class="btn btn-sm ${g.id === this.billSplitter?.activeGroupId ? 'btn-primary' : 'btn-secondary'} btn-switch-group" data-id="${g.id}" style="white-space: nowrap;">
        ${g.name}
      </button>
    `).join('');

    tabsContainer.querySelectorAll('.btn-switch-group').forEach(btn => {
      btn.addEventListener('click', () => {
        if (this.billSplitter) {
          this.billSplitter.activeGroupId = btn.getAttribute('data-id');
          this.renderSplitGroupsTab();
        }
      });
    });

    const active = this.billSplitter?.getActiveGroup();
    if (!active) {
      if (groupTitle) groupTitle.textContent = 'No Group Selected';
      return;
    }

    if (groupTitle) groupTitle.textContent = active.name;
    const totalExp = (active.expenses || []).reduce((acc, e) => acc + Number(e.amount || 0), 0);
    if (groupTotal) groupTotal.textContent = `Total: ${formatINR(totalExp)}`;

    // Render Expenses
    if (expList) {
      if (!active.expenses || active.expenses.length === 0) {
        expList.innerHTML = '<div style="color: var(--text-muted); font-size: 0.8rem; padding: 1rem 0;">No shared expenses in this group yet. Click "Add Group Expense".</div>';
      } else {
        expList.innerHTML = active.expenses.map(e => `
          <div style="display: flex; align-items: center; justify-content: space-between; padding: 0.6rem 0.8rem; background: var(--bg-surface); border-radius: var(--radius-md); font-size: 0.82rem;">
            <div>
              <div style="font-weight: 700; color: var(--text-primary);">${e.title}</div>
              <div style="font-size: 0.72rem; color: var(--text-muted);">Paid by <strong style="color: var(--accent-blue);">${e.paid_by_name || e.paidByName}</strong></div>
            </div>
            <div style="font-weight: 800; font-family: var(--font-sans); color: var(--text-primary);">${formatINR(e.amount)}</div>
          </div>
        `).join('');
      }
    }

    // Render Settlements
    const settlements = this.billSplitter ? this.billSplitter.calculateGroupSettlements(active) : [];
    if (settlementsList) {
      if (settlements.length === 0) {
        settlementsList.innerHTML = '<div style="color: var(--success-green); font-weight: 600; font-size: 0.85rem; padding: 0.5rem 0;">✨ All group debts are fully settled!</div>';
      } else {
        settlementsList.innerHTML = settlements.map(s => `
          <div style="display: flex; align-items: center; justify-content: space-between; padding: 0.55rem 0.75rem; background: var(--bg-card); border-radius: var(--radius-md); border: 1px solid var(--border-subtle); font-size: 0.8rem;">
            <div>
              <strong>${s.from}</strong> owes <strong>${s.to}</strong>
            </div>
            <div style="display: flex; align-items: center; gap: 0.4rem;">
              <span style="font-weight: 800; font-family: var(--font-mono); color: var(--danger-red);">${formatINR(s.amount)}</span>
              <button class="btn btn-sm btn-success btn-settle-qr" data-upi="${s.toUpi}" data-to="${s.to}" data-amt="${s.amount}">QR</button>
            </div>
          </div>
        `).join('');

        settlementsList.querySelectorAll('.btn-settle-qr').forEach(btn => {
          btn.addEventListener('click', () => {
            const upi = btn.getAttribute('data-upi');
            const amt = Number(btn.getAttribute('data-amt'));
            const uri = this.billSplitter?.generateSettlementQr(upi, amt) || '';
            const uriDisplay = document.getElementById('split-upi-uri-text');
            if (uriDisplay) uriDisplay.textContent = uri;
            this.showToast(`UPI QR generated for ${formatINR(amt)} to ${upi}`, 'success');
          });
        });
      }
    }

    // Default Settlement QR
    const firstSettlement = settlements[0];
    const targetUpi = firstSettlement ? firstSettlement.toUpi : (authService.getCurrentUser()?.upi_id || 'vishal@okhdfcbank');
    const targetAmt = firstSettlement ? firstSettlement.amount : 500;
    const uri = this.billSplitter?.generateSettlementQr(targetUpi, targetAmt) || '';
    const uriDisplay = document.getElementById('split-upi-uri-text');
    if (uriDisplay) uriDisplay.textContent = uri;
  }

  renderGroupPayerSelect() {
    const select = document.getElementById('exp-select-payer');
    const active = this.billSplitter?.getActiveGroup();
    if (!select || !active || !active.members) return;

    select.innerHTML = active.members.map(m => `
      <option value="${m.name}">${m.name}</option>
    `).join('');
  }

  renderAccountSelectOptions() {
    const selects = ['input-tx-account', 'sim-select-account'];
    selects.forEach(selectId => {
      const el = document.getElementById(selectId);
      if (!el) return;
      el.innerHTML = store.state.accounts.map(acc => `
        <option value="${acc.id}">
          ${acc.name} (${acc.bank} ••${acc.account_last4 || acc.accountLast4}) - ${formatINR(acc.balance)}
        </option>
      `).join('');
    });
  }

  renderTransactionList() {
    const container = document.getElementById('tx-list-container');
    if (!container) return;

    let filtered = [...store.state.transactions];

    if (this.selectedFilterType !== 'all') {
      if (this.selectedFilterType === 'lite') {
        filtered = filtered.filter(tx => tx.is_lite || tx.isLite);
      } else {
        filtered = filtered.filter(tx => tx.type === this.selectedFilterType);
      }
    }

    if (this.selectedFilterCategory !== 'all') {
      filtered = filtered.filter(tx => tx.category === this.selectedFilterCategory);
    }

    if (this.searchQuery) {
      filtered = filtered.filter(tx =>
        (tx.merchant && tx.merchant.toLowerCase().includes(this.searchQuery)) ||
        (tx.note && tx.note.toLowerCase().includes(this.searchQuery)) ||
        (tx.bank && tx.bank.toLowerCase().includes(this.searchQuery)) ||
        (tx.upi_ref && tx.upi_ref.includes(this.searchQuery)) ||
        (tx.upiRef && tx.upiRef.includes(this.searchQuery))
      );
    }

    if (filtered.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; padding: 2.5rem 1rem; color: var(--text-muted);">
          <div style="font-size: 2.2rem; margin-bottom: 0.5rem;">🔍</div>
          <div style="font-weight: 600; color: var(--text-primary);">No UPI transactions match your filter in SQLite DB</div>
          <div style="font-size: 0.8rem; margin-top: 0.25rem;">Try adjusting search terms or add a new transaction</div>
        </div>
      `;
      return;
    }

    container.innerHTML = filtered.map(tx => {
      const cat = CATEGORIES[(tx.category || 'other').toUpperCase()] || CATEGORIES.OTHER;
      const isDebit = tx.type === 'debit';
      const formattedAmt = `${isDebit ? '-' : '+'}${formatINR(tx.amount)}`;
      const isLite = tx.is_lite || tx.isLite;
      const ref = tx.upi_ref || tx.upiRef;
      const last4 = tx.account_last4 || tx.accountLast4;

      return `
        <div class="tx-row" data-id="${tx.id}">
          <div class="tx-left">
            <div class="tx-category-icon" style="background: ${cat.color}20; color: ${cat.color};">
              ${cat.icon}
            </div>
            <div class="tx-info">
              <div class="tx-merchant">
                <span>${tx.merchant || 'UPI Payee'}</span>
                ${isLite ? '<span class="badge badge-upi-lite">⚡ UPI Lite</span>' : ''}
              </div>
              <div class="tx-meta">
                <span>${formatDateIndian(tx.timestamp)}</span>
                <span>•</span>
                <span class="badge badge-bank">${tx.bank || 'UPI'} ••${last4 || ''}</span>
                ${ref ? `<span style="font-family: var(--font-mono); font-size: 0.7rem;">Ref:${ref}</span>` : ''}
                ${tx.note ? `<span style="color: var(--text-secondary); max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">— ${tx.note}</span>` : ''}
              </div>
            </div>
          </div>
          <div class="tx-right">
            <div class="tx-amount ${isDebit ? 'debit' : 'credit'}">${formattedAmt}</div>
            <div class="tx-actions">
              <button class="btn-action-icon btn-view-receipt" data-id="${tx.id}" title="View UPI Receipt">🧾</button>
              <button class="btn-action-icon delete btn-del-tx" data-id="${tx.id}" title="Delete from Database">🗑️</button>
            </div>
          </div>
        </div>
      `;
    }).join('');

    container.querySelectorAll('.btn-del-tx').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-id');
        if (confirm('Delete this transaction from SQLite database?')) {
          await store.deleteTransaction(id);
          this.showToast('Transaction removed from database', 'info');
        }
      });
    });

    container.querySelectorAll('.btn-view-receipt').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-id');
        this.openReceiptModal(id);
      });
    });

    container.querySelectorAll('.tx-row').forEach(row => {
      row.addEventListener('click', () => {
        const id = row.getAttribute('data-id');
        this.openReceiptModal(id);
      });
    });
  }

  renderCharts() {
    const categorySpends = store.getCategorySpends();
    const donutCanvas = document.getElementById('chart-category-donut');
    const donutLegend = document.getElementById('donut-legend-container');
    if (donutCanvas) {
      renderCategoryDonutChart(donutCanvas, categorySpends, donutLegend);
    }

    const trendCanvas = document.getElementById('chart-daily-trend');
    if (trendCanvas) {
      renderDailyTrendChart(trendCanvas, store.state.transactions);
    }
  }

  renderTopMerchants() {
    const container = document.getElementById('top-merchants-list');
    if (!container) return;

    const top = store.getTopMerchants(5);
    if (top.length === 0) {
      container.innerHTML = '<div style="color: var(--text-muted); font-size: 0.8rem; padding: 0.5rem 0;">No merchant data yet.</div>';
      return;
    }

    container.innerHTML = top.map((m, idx) => `
      <div class="merchant-rank-item ${idx === 0 ? 'merchant-rank-1' : ''}">
        <div class="merchant-rank-left">
          <div class="merchant-rank-badge">${idx + 1}</div>
          <div class="merchant-rank-info">
            <div class="merchant-rank-name">${m.name}</div>
            <div class="merchant-rank-count">${m.count} payments in database</div>
          </div>
        </div>
        <div class="merchant-rank-amount">${formatINR(m.total)}</div>
      </div>
    `).join('');
  }

  renderAccountsTab() {
    const grid = document.getElementById('accounts-cards-grid');
    if (!grid) return;

    grid.innerHTML = store.state.accounts.map(acc => {
      const isCC = acc.type === 'credit';
      const isLite = acc.type === 'wallet';
      const last4 = acc.account_last4 || acc.accountLast4;
      const upi = acc.upi_id || acc.upiId;

      return `
        <div class="bank-visual-card ${acc.theme || 'bank-hdfc'}">
          <div class="bank-card-top">
            <div>
              <div class="bank-card-name">${acc.name}</div>
              <div class="bank-card-type">${isCC ? 'RuPay Credit Card' : isLite ? 'UPI Lite Wallet' : 'Savings Account'}</div>
            </div>
            <div style="font-size: 1.2rem; font-weight: 800;">UPI</div>
          </div>
          <div class="bank-card-balance">
            <div style="font-size: 0.7rem; opacity: 0.8; text-transform: uppercase; letter-spacing: 0.05em;">
              ${isCC ? 'Available Credit' : 'Available Balance'}
            </div>
            <div class="bank-card-balance-val">${store.state.settings.hideBalance ? '₹ ••••••' : formatINR(acc.balance)}</div>
          </div>
          <div class="bank-card-bottom">
            <span>${upi}</span>
            <span>••${last4}</span>
          </div>
        </div>
      `;
    }).join('');
  }

  renderBudgetsTab() {
    const grid = document.getElementById('budgets-grid-container');
    if (!grid) return;

    const categorySpends = store.getCategorySpends();
    const budgets = store.state.budgets;

    grid.innerHTML = Object.entries(budgets).map(([catId, target]) => {
      const cat = CATEGORIES[catId.toUpperCase()] || { name: catId, icon: '🏷️', color: '#3B82F6' };
      const spent = categorySpends[catId] || 0;
      const pct = target > 0 ? Math.round((spent / target) * 100) : 0;

      let statusClass = 'safe';
      let statusText = 'On Track';
      if (pct >= 100) {
        statusClass = 'danger';
        statusText = 'Over Budget!';
      } else if (pct >= 75) {
        statusClass = 'warning';
        statusText = 'Approaching Limit';
      }

      return `
        <div class="budget-card">
          <div class="budget-card-header">
            <div class="budget-cat-name">
              <span>${cat.icon}</span>
              <span>${cat.name}</span>
            </div>
            <span class="badge ${pct >= 100 ? 'badge-debit' : 'badge-credit'}">${statusText} (${pct}%)</span>
          </div>
          <div class="budget-spent-ratio">
            <span>${formatINR(spent)}</span> of ${formatINR(target)}
          </div>
          <div class="budget-progress-track">
            <div class="budget-progress-fill ${statusClass}" style="width: ${Math.min(100, pct)}%;"></div>
          </div>
          <div class="budget-card-footer">
            <span>Remaining: ${formatINR(Math.max(0, target - spent))}</span>
            <button class="btn btn-sm btn-secondary btn-edit-budget" data-cat="${catId}" data-target="${target}">Edit Limit</button>
          </div>
        </div>
      `;
    }).join('');

    grid.querySelectorAll('.btn-edit-budget').forEach(btn => {
      btn.addEventListener('click', async () => {
        const cat = btn.getAttribute('data-cat');
        const current = btn.getAttribute('data-target');
        const newTarget = prompt(`Enter new monthly budget for ${cat}:`, current);
        if (newTarget && !isNaN(newTarget)) {
          await store.updateBudget(cat, newTarget);
          this.showToast(`Budget for ${cat} saved to SQLite: ${formatINR(newTarget)}`, 'success');
        }
      });
    });
  }

  // Database Console Viewer
  async renderDbConsole() {
    try {
      const status = await api.getDbStatus();
      if (status) {
        document.getElementById('db-file-size').textContent = `File Size: ${status.db_size_kb} KB`;
        document.getElementById('db-count-transactions').textContent = status.tables.transactions;
        document.getElementById('db-count-accounts').textContent = status.tables.accounts;
        document.getElementById('db-count-users').textContent = status.tables.users;
      }

      const tables = await api.getDbTables();
      const tbody = document.getElementById('db-raw-table-body');
      if (tbody && tables && tables.transactions) {
        tbody.innerHTML = tables.transactions.map(tx => `
          <tr style="border-bottom: 1px solid var(--border-subtle);">
            <td style="padding: 0.5rem 0.8rem; font-family: var(--font-mono); color: var(--text-muted);">${tx.id}</td>
            <td style="padding: 0.5rem 0.8rem;">${new Date(tx.timestamp).toLocaleString('en-IN')}</td>
            <td style="padding: 0.5rem 0.8rem;"><span class="badge ${tx.type === 'debit' ? 'badge-debit' : 'badge-credit'}">${tx.type}</span></td>
            <td style="padding: 0.5rem 0.8rem; font-weight: 700; font-family: var(--font-mono);">${formatINR(tx.amount)}</td>
            <td style="padding: 0.5rem 0.8rem; font-weight: 600;">${tx.merchant}</td>
            <td style="padding: 0.5rem 0.8rem;">${tx.category}</td>
            <td style="padding: 0.5rem 0.8rem;">${tx.bank} (••${tx.account_last4})</td>
            <td style="padding: 0.5rem 0.8rem; font-family: var(--font-mono); font-size: 0.7rem; color: var(--accent-blue);">${tx.upi_ref}</td>
          </tr>
        `).join('');
      }
    } catch (e) {
      console.warn('Failed to load DB table viewer:', e);
    }
  }

  // Bill Splitter Integration
  initBillSplitter() {
    const qrCanvas = document.getElementById('split-qr-canvas');
    this.billSplitter = new BillSplitterController(store, qrCanvas);
  }

  // SMS Parser UI Logic (Save to DB)
  bindSmsParserEvents() {
    const textarea = document.getElementById('sms-input-textarea');
    const previewBox = document.getElementById('sms-parsed-preview-box');
    const presetsContainer = document.getElementById('sms-presets-chips');
    const btnImport = document.getElementById('btn-import-parsed-sms');

    if (presetsContainer) {
      presetsContainer.innerHTML = SAMPLE_BANK_SMS.map((s, idx) => `
        <button class="sms-preset-btn" data-idx="${idx}">
          <span class="sms-preset-bank">${s.bank}</span>
          <span>${s.label}</span>
        </button>
      `).join('');

      presetsContainer.querySelectorAll('.sms-preset-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const s = SAMPLE_BANK_SMS[btn.getAttribute('data-idx')];
          if (textarea) {
            textarea.value = s.text;
            this.handleSmsTextChange(s.text);
          }
        });
      });
    }

    if (textarea) {
      textarea.addEventListener('input', (e) => {
        this.handleSmsTextChange(e.target.value);
      });
    }

    if (btnImport) {
      btnImport.addEventListener('click', async () => {
        const text = textarea ? textarea.value : '';
        const parsed = parseBankSms(text);
        if (!parsed || parsed.amount <= 0) {
          this.showToast('Please provide a valid Indian bank SMS with an amount.', 'error');
          return;
        }

        const account = store.state.accounts.find(a =>
          a.bank.toLowerCase().includes(parsed.bank.toLowerCase()) ||
          a.account_last4 === parsed.accountLast4 ||
          a.accountLast4 === parsed.accountLast4
        ) || store.state.accounts[0];

        await store.addTransaction({
          type: parsed.type,
          amount: parsed.amount,
          merchant: parsed.merchant,
          category: parsed.category,
          accountId: account ? account.id : 'acc_primary',
          bank: parsed.bank,
          accountLast4: parsed.accountLast4,
          upiRef: parsed.upiRef,
          note: `Imported via ${parsed.bank} SMS`
        });

        audioService.playUpiSuccessChime();
        audioService.speakPayment(parsed.amount, parsed.merchant, parsed.type);
        this.showToast(`SMS parsed and saved to SQLite! ₹${parsed.amount} ${parsed.type}`, 'success');
        this.closeAllModals();
        if (textarea) textarea.value = '';
      });
    }

    // Modal SMS Parser
    const modalTextarea = document.getElementById('modal-sms-textarea');
    const modalPreview = document.getElementById('modal-sms-preview');
    modalTextarea?.addEventListener('input', (e) => {
      const parsed = parseBankSms(e.target.value);
      if (modalPreview) {
        if (!parsed || !parsed.amount) {
          modalPreview.innerHTML = '<div style="color: var(--text-muted); text-align: center;">Paste a message above to preview extraction</div>';
        } else {
          modalPreview.innerHTML = `
            <div class="parsed-item">
              <span class="parsed-label">Amount:</span>
              <span class="parsed-val" style="color: ${parsed.type === 'debit' ? 'var(--danger-red)' : 'var(--success-green)'};">
                ${parsed.type === 'debit' ? '-' : '+'}${formatINR(parsed.amount)}
              </span>
            </div>
            <div class="parsed-item">
              <span class="parsed-label">Merchant:</span>
              <span class="parsed-val">${parsed.merchant}</span>
            </div>
            <div class="parsed-item">
              <span class="parsed-label">Bank:</span>
              <span class="parsed-val">${parsed.bank} (••${parsed.accountLast4})</span>
            </div>
          `;
        }
      }
    });

    document.getElementById('btn-modal-import-sms')?.addEventListener('click', async () => {
      const txt = modalTextarea ? modalTextarea.value : '';
      const parsed = parseBankSms(txt);
      if (parsed && parsed.amount > 0) {
        const account = store.state.accounts[0];
        await store.addTransaction({
          type: parsed.type,
          amount: parsed.amount,
          merchant: parsed.merchant,
          category: parsed.category,
          accountId: account ? account.id : 'acc_primary',
          bank: parsed.bank,
          accountLast4: parsed.accountLast4,
          upiRef: parsed.upiRef,
          note: 'Imported via SMS'
        });
        audioService.playUpiSuccessChime();
        audioService.speakPayment(parsed.amount, parsed.merchant, parsed.type);
        this.showToast('Transaction saved to SQLite database!', 'success');
        this.closeAllModals();
        if (modalTextarea) modalTextarea.value = '';
      } else {
        this.showToast('Could not extract valid amount from SMS', 'error');
      }
    });
  }

  handleSmsTextChange(text) {
    const previewBox = document.getElementById('sms-parsed-preview-box');
    if (!previewBox) return;

    const parsed = parseBankSms(text);
    if (!parsed || !parsed.amount) {
      previewBox.innerHTML = '<div style="color: var(--text-muted); text-align: center;">Paste a bank SMS above to extract details</div>';
      return;
    }

    const cat = CATEGORIES[parsed.category.toUpperCase()] || CATEGORIES.OTHER;

    previewBox.innerHTML = `
      <div class="parsed-item">
        <span class="parsed-label">Amount:</span>
        <span class="parsed-val" style="color: ${parsed.type === 'debit' ? 'var(--danger-red)' : 'var(--success-green)'}; font-size: 1.1rem;">
          ${parsed.type === 'debit' ? '-' : '+'}${formatINR(parsed.amount)}
        </span>
      </div>
      <div class="parsed-item">
        <span class="parsed-label">Type:</span>
        <span class="parsed-val"><span class="badge ${parsed.type === 'debit' ? 'badge-debit' : 'badge-credit'}">${parsed.type.toUpperCase()}</span></span>
      </div>
      <div class="parsed-item">
        <span class="parsed-label">Merchant / Payee:</span>
        <span class="parsed-val">${parsed.merchant}</span>
      </div>
      <div class="parsed-item">
        <span class="parsed-label">Bank & Account:</span>
        <span class="parsed-val">${parsed.bank} (••${parsed.accountLast4})</span>
      </div>
      <div class="parsed-item">
        <span class="parsed-label">UPI Ref / UTR:</span>
        <span class="parsed-val">${parsed.upiRef}</span>
      </div>
      <div class="parsed-item">
        <span class="parsed-label">Detected Category:</span>
        <span class="parsed-val">${cat.icon} ${cat.name}</span>
      </div>
    `;
  }

  // UPI Simulator Logic
  openUpiSimulator() {
    this.pinEntered = '';
    this.updatePinDots();
    this.openModal('modal-upi-sim');
  }

  bindUpiSimulatorEvents() {
    document.querySelectorAll('.upi-key-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const val = btn.getAttribute('data-val');
        if (val === 'back') {
          this.pinEntered = this.pinEntered.slice(0, -1);
        } else if (val === 'submit') {
          this.handleUpiSimulatorSubmit();
          return;
        } else if (this.pinEntered.length < 4) {
          this.pinEntered += val;
        }
        this.updatePinDots();

        if (this.pinEntered.length === 4) {
          setTimeout(() => this.handleUpiSimulatorSubmit(), 200);
        }
      });
    });

    document.getElementById('sim-preset-swiggy')?.addEventListener('click', () => this.setSimDetails(350, 'Swiggy', 'food'));
    document.getElementById('sim-preset-uber')?.addEventListener('click', () => this.setSimDetails(180, 'Uber', 'transit'));
    document.getElementById('sim-preset-blinkit')?.addEventListener('click', () => this.setSimDetails(480, 'Blinkit', 'grocery'));
    document.getElementById('sim-preset-chai')?.addEventListener('click', () => this.setSimDetails(20, 'Chai Point', 'food'));
  }

  setSimDetails(amount, merchant, category) {
    const amtEl = document.getElementById('sim-input-amount');
    const merchEl = document.getElementById('sim-input-merchant');
    const catEl = document.getElementById('sim-select-category');
    if (amtEl) amtEl.value = amount;
    if (merchEl) merchEl.value = merchant;
    if (catEl) catEl.value = category;
  }

  updatePinDots() {
    for (let i = 1; i <= 4; i++) {
      const dot = document.getElementById(`sim-pin-${i}`);
      if (dot) {
        dot.classList.toggle('filled', i <= this.pinEntered.length);
      }
    }
  }

  async handleUpiSimulatorSubmit() {
    const amtEl = document.getElementById('sim-input-amount');
    const merchEl = document.getElementById('sim-input-merchant');
    const catEl = document.getElementById('sim-select-category');
    const accEl = document.getElementById('sim-select-account');

    const amount = Number(amtEl ? amtEl.value : 100);
    const merchant = merchEl && merchEl.value.trim() ? merchEl.value.trim() : 'Swiggy';
    const category = catEl ? catEl.value : 'food';
    const accountId = accEl ? accEl.value : store.state.accounts[0]?.id;
    const account = store.state.accounts.find(a => a.id === accountId) || store.state.accounts[0];

    if (!amount || amount <= 0) {
      this.showToast('Please enter a valid amount', 'error');
      return;
    }

    const tx = await store.addTransaction({
      type: 'debit',
      amount,
      merchant,
      category,
      accountId: account ? account.id : 'acc_primary',
      bank: account ? account.bank : 'UPI Bank',
      accountLast4: account ? (account.account_last4 || account.accountLast4) : '1234',
      note: `Simulated UPI payment to ${merchant}`,
      isLite: (account && account.type === 'wallet') || amount <= 500
    });

    audioService.playUpiSuccessChime();
    audioService.speakPayment(amount, merchant, 'debit');

    this.showToast(`₹${amount} paid to ${merchant}! Saved to SQLite`, 'success');
    this.closeAllModals();
    this.openReceiptModal(tx.id);
  }

  // Add Manual Transaction (with Date Picker)
  async handleAddTransactionSubmit() {
    const typeEl = document.getElementById('input-tx-type');
    const amtEl = document.getElementById('input-tx-amount');
    const merchEl = document.getElementById('input-tx-merchant');
    const catEl = document.getElementById('input-tx-category');
    const accEl = document.getElementById('input-tx-account');
    const dateEl = document.getElementById('input-tx-datetime');
    const noteEl = document.getElementById('input-tx-note');
    const liteEl = document.getElementById('input-tx-lite');

    const amount = Number(amtEl ? amtEl.value : 0);
    if (!amount || amount <= 0) {
      this.showToast('Please enter an amount', 'error');
      return;
    }

    const account = store.state.accounts.find(a => a.id === accEl.value) || store.state.accounts[0];
    const timestamp = dateEl && dateEl.value ? new Date(dateEl.value).toISOString() : new Date().toISOString();

    const tx = await store.addTransaction({
      type: typeEl.value,
      amount,
      merchant: merchEl.value.trim() || 'UPI Payee',
      category: catEl.value,
      accountId: account ? account.id : 'acc_primary',
      bank: account ? account.bank : 'UPI Bank',
      accountLast4: account ? (account.account_last4 || account.accountLast4) : '1234',
      timestamp,
      note: noteEl ? noteEl.value.trim() : '',
      isLite: liteEl ? liteEl.checked : false
    });

    audioService.playUpiSuccessChime();
    audioService.speakPayment(amount, tx.merchant, tx.type);
    this.showToast(`Transaction saved to SQLite with date: ${new Date(timestamp).toLocaleDateString()}`, 'success');
    this.closeAllModals();
    document.getElementById('form-add-tx')?.reset();
  }

  openReceiptModal(txId) {
    const tx = store.state.transactions.find(t => t.id === txId);
    if (!tx) return;

    const cat = CATEGORIES[(tx.category || 'other').toUpperCase()] || CATEGORIES.OTHER;
    const isDebit = tx.type === 'debit';
    const isLite = tx.is_lite || tx.isLite;
    const ref = tx.upi_ref || tx.upiRef;
    const last4 = tx.account_last4 || tx.accountLast4;

    const modalBody = document.getElementById('receipt-modal-content');
    if (modalBody) {
      modalBody.innerHTML = `
        <div style="text-align: center; padding: 1rem 0; border-bottom: 1px dashed var(--border-default);">
          <div style="width: 56px; height: 56px; border-radius: var(--radius-full); background: ${isDebit ? 'var(--danger-soft)' : 'var(--success-soft)'}; color: ${isDebit ? 'var(--danger-red)' : 'var(--success-green)'}; display: flex; align-items: center; justify-content: center; margin: 0 auto 0.75rem; font-size: 1.6rem;">
            ${isDebit ? '↗️' : '↙️'}
          </div>
          <div style="font-size: 1.8rem; font-weight: 800; font-family: var(--font-sans); color: ${isDebit ? 'var(--danger-red)' : 'var(--success-green)'};">
            ${isDebit ? '-' : '+'}${formatINR(tx.amount)}
          </div>
          <div style="font-size: 1.05rem; font-weight: 700; color: var(--text-primary); margin-top: 0.25rem;">
            ${tx.merchant || 'UPI Payee'}
          </div>
          <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 0.2rem;">
            Saved in SQLite on ${new Date(tx.timestamp).toLocaleString('en-IN')}
          </div>
        </div>

        <div style="display: flex; flex-direction: column; gap: 0.65rem; padding: 1rem 0; font-size: 0.85rem;">
          <div class="parsed-item">
            <span class="parsed-label">Database Record:</span>
            <span class="parsed-val" style="color: var(--success-green);">✓ Stored in upi_tracker.db</span>
          </div>
          <div class="parsed-item">
            <span class="parsed-label">Payment Mode:</span>
            <span class="parsed-val">${isLite ? '⚡ UPI Lite (PIN-less)' : 'Unified Payments Interface (UPI)'}</span>
          </div>
          <div class="parsed-item">
            <span class="parsed-label">Debited From:</span>
            <span class="parsed-val">${tx.bank} Account ••${last4}</span>
          </div>
          <div class="parsed-item">
            <span class="parsed-label">UPI Reference (UTR):</span>
            <span class="parsed-val" style="color: var(--accent-blue);">${ref}</span>
          </div>
          <div class="parsed-item">
            <span class="parsed-label">Category:</span>
            <span class="parsed-val">${cat.icon} ${cat.name}</span>
          </div>
          ${tx.note ? `
            <div class="parsed-item">
              <span class="parsed-label">Note:</span>
              <span class="parsed-val">${tx.note}</span>
            </div>
          ` : ''}
        </div>
      `;
    }

    this.openModal('modal-receipt');
  }
}

// Immediate + DOMContentLoaded resilient startup
function startApp() {
  if (!window.app) {
    window.app = new UpiExpenseApp();
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startApp);
} else {
  startApp();
}
