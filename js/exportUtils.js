/**
 * Data Export & Backup Utilities (CSV & JSON)
 */

export function exportTransactionsToCsv(transactions = []) {
  if (!transactions.length) {
    alert('No transactions to export.');
    return;
  }

  const headers = ['Transaction ID', 'Date & Time', 'Type', 'Amount (INR)', 'Merchant/Payee', 'Category', 'Bank', 'Account (Last 4)', 'UPI Ref / UTR', 'Note', 'UPI Lite'];

  const rows = transactions.map(tx => [
    `"${tx.id || ''}"`,
    `"${new Date(tx.timestamp).toLocaleString('en-IN')}"`,
    `"${tx.type || 'debit'}"`,
    tx.amount || 0,
    `"${(tx.merchant || '').replace(/"/g, '""')}"`,
    `"${tx.category || 'other'}"`,
    `"${tx.bank || 'UPI'}"`,
    `"${tx.accountLast4 || ''}"`,
    `"${tx.upiRef || ''}"`,
    `"${(tx.note || '').replace(/"/g, '""')}"`,
    tx.isLite ? 'Yes' : 'No'
  ]);

  const csvContent = 'data:text/csv;charset=utf-8,\uFEFF' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement('a');
  link.setAttribute('href', encodedUri);
  link.setAttribute('download', `upi_transactions_${new Date().toISOString().split('T')[0]}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export function exportBackupJson(state) {
  const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(state, null, 2));
  const link = document.createElement('a');
  link.setAttribute('href', dataStr);
  link.setAttribute('download', `upi_tracker_backup_${new Date().toISOString().split('T')[0]}.json`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export function importBackupJson(file, store, onSuccess, onError) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      if (data && Array.isArray(data.transactions) && Array.isArray(data.accounts)) {
        store.state.accounts = data.accounts;
        store.state.transactions = data.transactions;
        if (data.budgets) store.state.budgets = data.budgets;
        if (data.friends) store.state.friends = data.friends;
        store.saveState();
        if (onSuccess) onSuccess();
      } else {
        throw new Error('Invalid backup file structure.');
      }
    } catch (err) {
      if (onError) onError(err.message);
    }
  };
  reader.readAsText(file);
}
