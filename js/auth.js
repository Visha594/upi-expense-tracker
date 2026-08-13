/**
 * UPI Authentication & Session Manager
 * Connected directly with SQLite Backend (`users` table).
 */

import { api } from './api.js';

class AuthService {
  constructor() {
    this.currentUser = this.loadSession();
    if (!this.currentUser) {
      // Default auto-login into Vishal Sharma demo account
      const demoUser = {
        id: 'usr_demo',
        name: 'Vishal Sharma',
        phone: '9876543210',
        email: 'vishal@example.com',
        upi_id: 'vishal@okhdfcbank',
        avatar: '👨‍💼'
      };
      this.setSession(demoUser);
    }
  }

  loadSession() {
    try {
      const session = localStorage.getItem('upi_current_user');
      return session ? JSON.parse(session) : null;
    } catch (e) {
      return null;
    }
  }

  isLoggedIn() {
    return this.currentUser !== null;
  }

  getCurrentUser() {
    return this.currentUser;
  }

  async login(identifier, pin) {
    try {
      const res = await api.login(identifier, pin);
      if (res.success && res.user) {
        this.setSession(res.user);
        return { success: true, user: res.user };
      }
      return { success: false, message: res.message || 'Login failed' };
    } catch (e) {
      return { success: false, message: e.message || 'Failed to connect to database' };
    }
  }

  async loginDemo() {
    try {
      const res = await api.loginDemo();
      if (res.success && res.user) {
        this.setSession(res.user);
        return { success: true, user: res.user };
      }
      return { success: false, message: 'Could not load demo user' };
    } catch (e) {
      // Fallback
      const demoUser = {
        id: 'usr_demo',
        name: 'Vishal Sharma',
        phone: '9876543210',
        email: 'vishal@example.com',
        upiId: 'vishal@okhdfcbank',
        avatar: '👨‍💼'
      };
      this.setSession(demoUser);
      return { success: true, user: demoUser };
    }
  }

  async register({ name, phone, email, upiId, pin }) {
    try {
      const res = await api.register({ name, phone, email, upi_id: upiId, pin });
      if (res.success && res.user) {
        this.setSession(res.user);
        return { success: true, user: res.user };
      }
      return { success: false, message: res.message || 'Registration failed' };
    } catch (e) {
      return { success: false, message: e.message || 'Failed to save to database' };
    }
  }

  logout() {
    this.currentUser = null;
    localStorage.removeItem('upi_current_user');
  }

  setSession(user) {
    this.currentUser = user;
    localStorage.setItem('upi_current_user', JSON.stringify(user));
  }
}

export const authService = new AuthService();
