import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"
import type { Transaction, TransactionType, ColorTheme } from "@/types";
import React from "react";
import { format as formatFns, parseISO, isValid } from 'date-fns';
import { 
  ArrowDownCircle, ArrowUpCircle, CreditCard, FileText, MinusCircle, 
  ShoppingCart, Wallet, Banknote, ArrowRightLeft, Users, HandCoins
} from "lucide-react";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(dateString: string | Date): string {
    if (!dateString) return '';
    try {
        let date: Date;
        if (typeof dateString === 'object' && dateString instanceof Date) {
            date = dateString;
        } else if (typeof dateString === 'object' && 'toDate' in (dateString as any)) {
            date = (dateString as any).toDate();
        } else if (typeof dateString === 'string') {
            if (dateString.includes('T')) {
                date = parseISO(dateString);
            } else {
                const [year, month, day] = dateString.split('-').map(Number);
                if (year && month && day) {
                    date = new Date(year, month - 1, day);
                } else {
                    date = parseISO(dateString);
                }
            }
        } else {
            return String(dateString);
        }
        if (isValid(date)) return formatFns(date, "dd/MM/yyyy");
        return String(dateString);
    } catch (e) {
        return String(dateString);
    }
}

export function formatAmount(amount: number, includeSymbol = true) {
  if (typeof amount !== 'number' || isNaN(amount)) {
    return includeSymbol ? '৳0.00' : '0.00';
  }
  const formatted = Math.abs(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const symbol = includeSymbol ? '৳' : '';
  return `${symbol}${amount < 0 ? '-' : ''}${formatted}`;
}

export function formatBalance(amount: number) {
  if (typeof amount !== 'number' || isNaN(amount)) {
    return '0.00';
  }
  return amount.toLocaleString('en-US', { 
    minimumFractionDigits: 2, 
    maximumFractionDigits: 2,
    signDisplay: 'always' 
  });
}

/**
 * Returns the impact of a transaction on the overall BUSINESS cash/bank balance.
 */
export function getEffectiveAmount(transaction: Pick<Transaction, 'type' | 'amount' | 'enabled'>): number {
  if (!transaction.enabled) return 0;
  switch (transaction.type) {
    case 'purchase':
    case 'spent':
    case 'give':
    case 'sale_return':
      return -transaction.amount;
    case 'sale':
    case 'receive':
    case 'income':
    case 'purchase_return':
      return transaction.amount;
    default:
      return 0;
  }
}

/**
 * Returns the impact of a transaction on the specific PARTY ledger balance.
 * Follows standard accounting: Balance = Total Credits - Total Debits
 * Negative = Receivable (Customer owes us)
 * Positive = Payable (We owe Supplier/Friend)
 */
export function getPartyBalanceEffect(transaction: Pick<Transaction, 'type' | 'amount' | 'enabled' | 'partyId'>, forDisplay: boolean = false): number {
  if (!transaction.enabled || !transaction.partyId) return 0;
  
  const type = transaction.type;
  const amount = transaction.amount;

  // Cash/Internal Transactions do NOT affect the running debt/due balance per RULES.md
  if (['sale', 'purchase', 'income', 'spent'].includes(type)) {
      return 0;
  }

  // Credit Types: Decreases Customer Debt (Receivable) / Increases Supplier Liability (Payable)
  // receive, credit_purchase, sale_return, credit_income
  const isCredit = ['receive', 'credit_purchase', 'sale_return', 'credit_income'].includes(type);
  
  // Debit Types: Increases Customer Debt (Receivable) / Increases Supplier Liability (Payable)
  // give, credit_sale, purchase_return, credit_give
  const isDebit = ['give', 'credit_sale', 'purchase_return', 'credit_give'].includes(type);

  if (isCredit) return amount;
  if (isDebit) return -amount;

  return 0;
}

export const transactionTypeOptions: { value: TransactionType, label: string, icon: React.ReactNode }[] = [
  { value: 'sale', label: 'Sale', icon: React.createElement(Banknote) },
  { value: 'purchase', label: 'Purchase', icon: React.createElement(ShoppingCart) },
  { value: 'income', label: 'Income', icon: React.createElement(Wallet) },
  { value: 'spent', label: 'Spent', icon: React.createElement(CreditCard) },
  { value: 'receive', label: 'Receive', icon: React.createElement(ArrowDownCircle) },
  { value: 'give', label: 'Give', icon: React.createElement(ArrowUpCircle) },
  { value: 'credit_sale', label: 'Credit Sale', icon: React.createElement(FileText) },
  { value: 'credit_purchase', label: 'Credit Purchase', icon: React.createElement(FileText) },
  { value: 'credit_give', label: 'Credit Give', icon: React.createElement(Users) },
  { value: 'credit_income', label: 'Credit Income', icon: React.createElement(HandCoins) },
  { value: 'transfer', label: 'Transfer', icon: React.createElement(ArrowRightLeft) },
  { value: 'sale_return', label: 'Sale Return', icon: React.createElement(ArrowRightLeft) },
  { value: 'purchase_return', label: 'Purchase Return', icon: React.createElement(ArrowRightLeft) },
];

export function amountToWords(amount: number): string {
    const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
    const teens = ['Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
    const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
    const scales = ['', 'Thousand', 'Lakh', 'Crore'];

    function numberToWords(n: number): string {
        if (n < 10) return ones[n];
        if (n < 20) return teens[n - 10];
        if (n < 100) return `${tens[Math.floor(n / 10)]} ${ones[n % 10]}`;
        if (n < 1000) return `${ones[Math.floor(n / 100)]} Hundred ${numberToWords(n % 100)}`;
        return '';
    }

    if (amount === 0) return 'Zero';
    let words = '';
    let num = Math.floor(Math.abs(amount));
    let scaleIndex = 0;
    while (num > 0) {
        if (num % 1000 !== 0) {
            let chunk = num % 1000;
            const chunkWords = numberToWords(chunk);
            words = `${chunkWords} ${scales[scaleIndex]} ${words}`;
        }
        num = Math.floor(num / 1000);
        scaleIndex++;
    }
    return words.trim().replace(/\s+/g, ' ');
}

export function cleanUndefined(obj: any): any {
  if (obj === null || obj === undefined) return undefined;
  if (Array.isArray(obj)) return obj.map(cleanUndefined).filter(v => v !== undefined);
  if (typeof obj === 'object' && obj.constructor === Object) {
    const newObj: { [key: string]: any } = {};
    for (const key in obj) {
      const value = cleanUndefined(obj[key]);
      if (value !== undefined) newObj[key] = value;
    }
    return newObj;
  }
  return obj;
}

export function applyTheme(theme: ColorTheme | undefined) {
    if (!theme) return;
    const { primary, secondary, accent } = theme.colors;
    document.documentElement.style.setProperty('--primary', `${primary.h} ${primary.s}% ${primary.l}%`);
    document.documentElement.style.setProperty('--secondary', `${secondary.h} ${secondary.s}% ${secondary.l}%`);
    document.documentElement.style.setProperty('--accent', `${accent.h} ${accent.s}% ${accent.l}%`);
}
