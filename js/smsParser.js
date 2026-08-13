/**
 * Indian Bank SMS & UPI Notification Parser
 * Robust extraction engine supporting SBI, HDFC, ICICI, Axis, Kotak, PNB, BOB, Paytm, CRED etc.
 */

export const CATEGORIES = {
  FOOD: { id: 'food', name: 'Food & Dining', icon: '🍔', color: '#F59E0B' },
  GROCERY: { id: 'grocery', name: 'Groceries & Mart', icon: '🛒', color: '#10B981' },
  TRANSIT: { id: 'transit', name: 'Transit & Fuel', icon: '🚕', color: '#3B82F6' },
  SHOPPING: { id: 'shopping', name: 'Shopping', icon: '🛍️', color: '#EC4899' },
  BILLS: { id: 'bills', name: 'Bills & Utilities', icon: '⚡', color: '#8B5CF6' },
  ENTERTAINMENT: { id: 'entertainment', name: 'Entertainment', icon: '🎬', color: '#6366F1' },
  HEALTH: { id: 'health', name: 'Health & Pharmacy', icon: '💊', color: '#14B8A6' },
  TRANSFER: { id: 'transfer', name: 'P2P / Transfer', icon: '💸', color: '#06B6D4' },
  INVESTMENT: { id: 'investment', name: 'Investments', icon: '📈', color: '#84CC16' },
  OTHER: { id: 'other', name: 'General & Others', icon: '🏷️', color: '#64748B' }
};

const MERCHANT_CATEGORY_MAP = [
  { pattern: /swiggy|zomato|starbucks|chai point|chaayos|mcdonald|kfc|burger king|domino|pizza hut|haldiram|subway|biryani|cafe|baker|dhaba|restaurant/i, category: 'food' },
  { pattern: /blinkit|zepto|instamart|bigbasket|bbnow|dmart|d-mart|nature basket|milk basket|jiomart|kirana|supermarket|grofer|vegetable|fruits/i, category: 'grocery' },
  { pattern: /uber|ola|rapido|metro|dmrc|bmrc|irctc|redbus|makemytrip|indigo|air india|fuel|petrol|indian oil|bharat petroleum|hpcl|shell|fastag|parking/i, category: 'transit' },
  { pattern: /amazon|flipkart|myntra|meesho|nykaa|ajio|tata cliq|zara|h&m|decathlon|uniqlo|lenskart|croma|reliance digital/i, category: 'shopping' },
  { pattern: /bescom|electricity|jio|airtel|vi |vodafone|tata play|tata power|igl|adani gas|billdesk|recharge|dth|broadband|water board/i, category: 'bills' },
  { pattern: /netflix|spotify|bookmyshow|pvr|inox|prime video|disney|hotstar|youtube|gaming|steam|playstation/i, category: 'entertainment' },
  { pattern: /apollo|1mg|pharmeasy|netmeds|medplus|practo|hospital|clinic|diagnostic|pharmacy|dr\b/i, category: 'health' },
  { pattern: /zerodha|groww|kuvera|indmoney|smallcase|angel one|upstox|mf central|uti|lic|mutual fund/i, category: 'investment' }
];

export function categorizeMerchant(merchantName = '') {
  if (!merchantName) return 'other';
  for (const item of MERCHANT_CATEGORY_MAP) {
    if (item.pattern.test(merchantName)) {
      return item.category;
    }
  }
  return 'transfer'; // default to transfer if it's a person/unknown UPI ID
}

/**
 * Parses single or multi-line Indian Bank SMS message
 */
export function parseBankSms(smsText) {
  if (!smsText || typeof smsText !== 'string') return null;

  const text = smsText.trim();
  const lower = text.toLowerCase();

  // 1. Transaction Type (Debit vs Credit)
  let type = 'debit';
  if (/credited|received|deposit|refund|cashback|added/i.test(text) && !/debited/i.test(text)) {
    type = 'credit';
  } else if (/debited|sent|spent|paid|withdrawn|purchase/i.test(text)) {
    type = 'debit';
  }

  // 2. Extract Amount (Rs. 1,450.00 / INR 350 / ₹500)
  let amount = null;
  const amountPatterns = [
    /(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d{1,2})?)/i,
    /debited\s+by\s+(?:rs\.?|inr|₹)?\s*([\d,]+(?:\.\d{1,2})?)/i,
    /for\s+(?:rs\.?|inr|₹)?\s*([\d,]+(?:\.\d{1,2})?)/i,
    /([\d,]+(?:\.\d{1,2})?)\s*(?:rs\.?|inr|₹)/i
  ];

  for (const pattern of amountPatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const numStr = match[1].replace(/,/g, '');
      const parsed = parseFloat(numStr);
      if (!isNaN(parsed) && parsed > 0) {
        amount = parsed;
        break;
      }
    }
  }

  // 3. Extract Bank Name
  let bank = 'UPI Bank';
  if (/sbi|state bank/i.test(text)) bank = 'SBI';
  else if (/hdfc/i.test(text)) bank = 'HDFC';
  else if (/icici/i.test(text)) bank = 'ICICI';
  else if (/axis/i.test(text)) bank = 'Axis';
  else if (/kotak/i.test(text)) bank = 'Kotak';
  else if (/paytm/i.test(text)) bank = 'Paytm';
  else if (/pnb|punjab national/i.test(text)) bank = 'PNB';
  else if (/bob|baroda/i.test(text)) bank = 'BOB';
  else if (/indusind/i.test(text)) bank = 'IndusInd';
  else if (/canara/i.test(text)) bank = 'Canara';
  else if (/cred|rupay/i.test(text)) bank = 'RuPay CC';

  // 4. Extract Account Number (e.g. *1234, XX4321, ending 9988)
  let accountLast4 = '1234';
  const accountPatterns = [
    /(?:a\/c|acct|account|card)\s*(?:no\.?)?\s*(?:[*xX]+|ending\s+in\s+)?(\d{3,4})/i,
    /[*xX]+(\d{3,4})/,
    /(?:A\/C|A\/c)\s*(\d{4})/
  ];

  for (const pattern of accountPatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      accountLast4 = match[1];
      break;
    }
  }

  // 5. Extract Payee / Merchant
  let merchant = 'UPI Payee';
  const merchantPatterns = [
    /(?:transfer to|transferred to|sent to|paid to|to VPA|to)\s+([A-Za-z0-9\s&._@'-]{2,30}?)(?:\s+(?:on|via|UPI|Ref|ref|using|avail|bal|\.))/i,
    /(?:at|info:)\s+([A-Za-z0-9\s&._@'-]{2,30}?)(?:\s+(?:on|via|UPI|Ref|ref|\.))/i,
    /UPI[:\/]([A-Za-z0-9\s&._@'-]{2,25}?)(?:[\/.\s]|Ref)/i,
    /Payee:\s*([A-Za-z0-9\s&._@'-]{2,30})/i,
    /from\s+([A-Za-z0-9\s&._@'-]{2,25}?)(?:\s+(?:on|via|UPI|Ref|\.))/i
  ];

  for (const pattern of merchantPatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const candidate = match[1].trim()
        .replace(/^(vpa|upi|ref|no|the)\s+/i, '')
        .replace(/\s+(vpa|upi|ref|no|on|via)$/i, '');
      if (candidate.length >= 2 && !/^(rs|inr|account|bank|your|dear)$/i.test(candidate)) {
        merchant = candidate;
        break;
      }
    }
  }

  // 6. Extract UPI Reference / UTR
  let upiRef = '';
  const refPatterns = [
    /(?:upi\s*ref(?:\s*no\.?)?|ref\s*no\.?|utr\s*no\.?|utr|rrn)\s*[:#]?\s*([0-9]{8,14})/i,
    /ref\s+([0-9]{8,14})/i
  ];

  for (const pattern of refPatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      upiRef = match[1];
      break;
    }
  }

  if (!upiRef) {
    // Generate pseudo UTR if not found in SMS
    upiRef = '422' + Math.floor(100000000 + Math.random() * 900000000);
  }

  // 7. Auto Category
  const categoryId = categorizeMerchant(merchant);

  return {
    rawSms: text,
    type,
    amount: amount || 0,
    merchant: cleanMerchantName(merchant),
    bank,
    accountLast4,
    upiRef,
    category: categoryId,
    timestamp: new Date().toISOString(),
    confidence: amount ? 0.95 : 0.6
  };
}

function cleanMerchantName(name) {
  if (!name) return 'UPI Payee';
  let cleaned = name.trim().replace(/^[-:._\s]+|[-:._\s]+$/g, '');
  // Capitalize nicely
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

/**
 * Pre-built sample SMS templates for 1-click test simulation
 */
export const SAMPLE_BANK_SMS = [
  {
    bank: 'SBI',
    label: 'Swiggy Dinner (SBI)',
    text: 'Dear SBI User, A/c *4921 debited by Rs 380.00 on 14Aug26 transfer to SWIGGY UPI Ref No 422789123456 - SBI'
  },
  {
    bank: 'HDFC',
    label: 'Blinkit Groceries (HDFC)',
    text: 'Sent Rs.649.00 from HDFC Bank A/C *7890 to BLINKIT on 14-08-26 via UPI. Ref 422891234567. Avail Bal: Rs 42,350.00'
  },
  {
    bank: 'ICICI',
    label: 'Uber Ride (ICICI)',
    text: 'ICICI Bank Acct XX3456 debited for Rs 240.00 on 14-Aug-26. UPI:UBER INDIA. Ref No:4228912345. Call 18001080 for dispute.'
  },
  {
    bank: 'Axis',
    label: 'Zomato Lunch (Axis)',
    text: 'Axis Bank: INR 310.00 debited from A/c no. XX9900 on 14-08-2026 13:30:15 for UPI/ZOMATO/Ref 42299881122.'
  },
  {
    bank: 'Kotak',
    label: 'Chai Point (Kotak)',
    text: 'Rs 80.00 debited from Kotak Bank A/C XX5511 on 14-Aug-26. UPI Ref 42233114455. Payee: CHAI POINT.'
  },
  {
    bank: 'HDFC',
    label: 'Salary Credit (HDFC)',
    text: 'HDFC Bank: Rs 75,000.00 credited to A/C *7890 on 01-Aug-26 by ACH/SALARY/TECH SOLUTIONS. Bal Rs 1,18,500.00'
  },
  {
    bank: 'Paytm',
    label: 'Metro Recharge (Paytm)',
    text: 'Rs 200.00 debited from Paytm Payments Bank A/c XX4321 to DMRC Metro UPI Ref 42211998844'
  },
  {
    bank: 'RuPay CC',
    label: 'Amazon Shopping (RuPay CC)',
    text: 'Rs 1,899.00 spent on your ICICI RuPay Credit Card XX8899 on 14-Aug-26 at AMAZON INDIA UPI. Limit left: Rs 82,400.'
  }
];
