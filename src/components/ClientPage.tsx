"use client"

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import type { Party, Transaction, Account, AppSettings, InventoryItem } from '@/types';
import TransactionForm from '@/components/TransactionForm';
import TransactionTable, { type GroupedTransaction } from '@/components/TransactionTable';
import TransactionFilters from '@/components/TransactionFilters';
import EditTransactionDialog from '@/components/EditTransactionDialog';
import InvoiceDialog from '@/components/pos/InvoiceDialog';
import { cn, getEffectiveAmount, formatBalance, formatAmount } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Printer, Loader2, Download, Upload, Share2, Wifi, WifiOff, AlertCircle, Plus, AlertTriangle, ShoppingCart, Landmark, ArrowRightLeft, Archive } from 'lucide-react';
import { subscribeToAllTransactions, addTransaction, deleteFilteredTransactions, restoreData, updateTransaction, toggleTransaction, getAllTransactions } from '@/services/transactionService';
import { subscribeToParties } from '@/services/partyService';
import { subscribeToAccounts } from '@/services/accountService';
import { subscribeToInventoryItems } from '@/services/inventoryService';
import { getAppSettings } from '@/services/settingsService';
import { db } from '@/lib/firebase';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useIsMobile } from '@/hooks/use-mobile';
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert"
import { Terminal } from "lucide-react"
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { format as formatFns } from 'date-fns';
import BalanceSummary from './BalanceSummary';


export interface Filters {
  type: string;
  accountId: string;
  partyId: string;
  dateFrom: string;
  dateTo: string;
  via: string;
  status: 'all' | 'enabled' | 'disabled';
}

export interface Sort {
  sortKey: keyof Transaction | 'sl' | 'balance';
  sortBy: {
    [key in keyof Transaction | 'sl' | 'balance']?: 'asc' | 'desc';
  }
}

type FirebaseStatus = 'initializing' | 'not_configured' | 'connecting' | 'connected' | 'error';
type FirebaseErrorType = 'unavailable' | 'other';

// --- Sample Data for Demo ---
const sampleParties: Party[] = [
  { id: 'sample-party-1', name: 'City Groceries', balance: 0, phone: '555-0101', address: '123 Market St' },
  { id: 'sample-party-2', name: 'Tech Solutions Inc.', balance: 0, phone: '555-0102', address: '456 Tech Park' },
];

const sampleTransactions: Transaction[] = [
    { id: 'sample-tx-1', date: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], description: 'Initial Salary', amount: 50000, type: 'income', accountId: 'bank', enabled: true },
    { id: 'sample-tx-2', date: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], description: 'Office Rent', amount: 15000, type: 'spent', accountId: 'bank', enabled: true },
    { id: 'sample-tx-3', date: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], description: 'Groceries', amount: 2500, type: 'purchase', accountId: 'cash', enabled: true, partyId: 'sample-party-1' },
    { id: 'sample-tx-4', date: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], description: 'Project Advance', amount: 10000, type: 'receive', accountId: 'bank', enabled: true, partyId: 'sample-party-2' },
    { id: 'sample-tx-5', date: new Date().toISOString().split('T')[0], description: 'Lunch meeting', amount: 1200, type: 'spent', accountId: 'cash', enabled: false },
];
const sampleAccounts: Account[] = [
    { id: 'cash', name: 'Cash', balance: 31300 },
    { id: 'bank', name: 'Bank Account', balance: 45000 },
];
// ----------------------------


const FirebaseStatusIndicator = ({ status }: { status: FirebaseStatus }) => {
  const statusInfo = {
    initializing: { text: "Initializing...", icon: <Loader2 className="animate-spin" />, variant: "outline" as const },
    not_configured: { text: "Offline Mode (Sample Data)", icon: <AlertCircle />, variant: "destructive" as const },
    connecting: { text: "Connecting...", icon: <Loader2 className="animate-spin" />, variant: "outline" as const },
    connected: { text: "Connected", icon: <Wifi />, variant: "secondary" as const, className: "text-green-600 border-green-500"},
    error: { text: "Connection Error দেখাচ্ছে এটি ঠিক করে দাও", icon: <WifiOff />, variant: "destructive" as const },
  };

  const { text, icon, variant, className } = statusInfo[status];
  
  return (
    <Badge variant={variant} className={cn("flex items-center gap-2", className)}>
      {icon}
      <span>{text}</span>
    </Badge>
  );
};


export default function ClientPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [allTransactions, setAllTransactions] = useState<Transaction[]>([]);
  const [parties, setParties] = useState<Party[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [firebaseStatus, setFirebaseStatus] = useState<FirebaseStatus>('initializing');
  const [firebaseErrorType, setFirebaseErrorType] = useState<FirebaseErrorType | null>(null);
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
  const [viewingInvoice, setViewingInvoice] = useState<Transaction | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);
  const [canShare, setCanShare] = useState(false);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const invoiceRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();
  const { toast } = useToast();
  const router = useRouter();


  const [filters, setFilters] = useState<Filters>(() => {
    const today = new Date();
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(today.getDate() - 7);
    return {
      type: 'all',
      accountId: 'all',
      partyId: 'all',
      dateFrom: formatFns(sevenDaysAgo, 'yyyy-MM-dd'),
      dateTo: formatFns(today, 'yyyy-MM-dd'),
      via: 'all',
      status: 'enabled',
    }
  });

  const [sort, setSort] = useState<Sort>({
    sortKey: 'date',
    sortBy: { date: 'desc' }
  });
  
  const handleDateToChange = (dateTo: string) => {
    const toDate = new Date(dateTo);
    const fromDate = new Date(toDate);
    fromDate.setDate(toDate.getDate() - 7);
    setFilters(prevFilters => ({
        ...prevFilters,
        dateTo: dateTo,
        dateFrom: formatFns(fromDate, 'yyyy-MM-dd')
    }));
  };

  useEffect(() => {
    const loadSampleDataAndToast = (reason: 'not_configured' | 'error') => {
        const title = reason === 'not_configured' ? "Firebase Not Configured" : "Firebase Connection Error";
        if (reason === 'other') {
            toast({
                variant: 'destructive',
                title: title,
                description: "Displaying sample data. Changes will not be saved.",
            });
        }
        setTransactions(sampleTransactions);
        setAllTransactions(sampleTransactions);
        setParties(sampleParties);
        setAccounts(sampleAccounts);
        getAppSettings().then(setAppSettings);
        setLoading(false);
    };
    
    if (!db) {
        setFirebaseStatus('not_configured');
        loadSampleDataAndToast('not_configured');
        return;
    }

    setFirebaseStatus('connecting');
    setLoading(true);

    const onSubscriptionError = (error: Error, serviceName: string) => {
        console.error(`Firebase subscription failed for ${serviceName}:`, error);
        setFirebaseStatus('error');
        if (error.message.includes('unavailable') || error.message.includes('Could not reach')) {
            setFirebaseErrorType('unavailable');
        } else {
            setFirebaseErrorType('other');
        }
        loadSampleDataAndToast('error');
    };

    let initialLoad = true;
    const onTransactionsUpdate = (latestTransactions: Transaction[]) => {
        if (initialLoad && latestTransactions.length === 0) {
           console.log("Successfully connected to Firebase. Your database is empty. Add a new transaction to get started.");
        }
        // This subscription now fetches all transactions, so it can be our source of truth.
        setAllTransactions(latestTransactions);
        setTransactions(latestTransactions); 
        if (firebaseStatus !== 'connected') {
            setFirebaseStatus('connected');
        }
        setLoading(false);
        initialLoad = false;
        setFirebaseErrorType(null);
    };
    
    const onPartiesUpdate = (latestParties: Party[]) => {
        setParties(latestParties);
    };

    const onAccountsUpdate = (latestAccounts: Account[]) => {
        setAccounts(latestAccounts);
    }
    
    const onInventoryUpdate = (latestItems: InventoryItem[]) => {
        setInventoryItems(latestItems);
    }
    
    const unsubscribeTransactions = subscribeToAllTransactions(onTransactionsUpdate, (e) => onSubscriptionError(e, 'transactions'));
    const unsubscribeParties = subscribeToParties(onPartiesUpdate, (e) => onSubscriptionError(e, 'parties'));
    const unsubscribeAccounts = subscribeToAccounts(onAccountsUpdate, (e) => onSubscriptionError(e, 'accounts'));
    const unsubscribeInventory = subscribeToInventoryItems(onInventoryUpdate, (e) => onSubscriptionError(e, 'inventory'));
    getAppSettings().then(setAppSettings);

    return () => {
        unsubscribeTransactions();
        unsubscribeParties();
        unsubscribeAccounts();
        unsubscribeInventory();
    };
  }, [toast]);
  
  useEffect(() => {
    if (typeof navigator !== 'undefined' && navigator.share) {
        const dummyFile = new File(["dummy"], "dummy.json", { type: "application/json" });
        if (navigator.canShare && navigator.canShare({ files: [dummyFile] })) {
            setCanShare(true);
        }
    }
  }, []);

  const handleAddTransaction = async (data: Omit<Transaction, 'id' | 'enabled'>[], mode: 'saveAndClose' | 'saveAndNext') => {
    if (firebaseStatus !== 'connected') {
        data.forEach(d => {
            const newTransaction: Transaction = {
                ...d,
                id: `local-${Date.now()}-${Math.random()}`,
                enabled: true,
            };
            setTransactions(prev => [newTransaction, ...prev]);
            setAllTransactions(prev => [newTransaction, ...prev]);
        });
        toast({ title: "Sample transaction(s) added", description: "This is for demonstration and will not be saved." });
        return;
    }
    try {
      for (const transactionData of data) {
          await addTransaction(transactionData);
      }
      toast({ title: "Success", description: `${data.length} transaction(s) added successfully.` });
      if (mode === 'saveAndClose' && isMobile) {
        setIsFormOpen(false);
      }
    } catch (error) {
      console.error("Failed to add transaction(s)", error);
      toast({ variant: 'destructive', title: "Error", description: "Could not add transaction(s). Is Firebase configured?" });
    }
  };
  
  const handleEditTransaction = (transaction: Transaction) => {
    setEditingTransaction(transaction);
  };
  
  const handleUpdateTransaction = async (data: Omit<Transaction, 'id' | 'enabled'>) => {
      if (!editingTransaction) return;
      if (firebaseStatus !== 'connected') {
          const updater = (prev: Transaction[]) => prev.map(t => t.id === editingTransaction.id ? { ...t, ...data, enabled: t.enabled, id: t.id } : t)
          setTransactions(updater);
          setAllTransactions(updater);
          toast({ title: "Sample transaction updated" });
          setEditingTransaction(null);
          return;
      }
      try {
        await updateTransaction(editingTransaction.id, data);
        toast({ title: "Success", description: "Transaction updated successfully." });
        setEditingTransaction(null);
      } catch (error) {
        console.error("Failed to update transaction", error);
        toast({ variant: 'destructive', title: "Error", description: "Could not update transaction." });
      }
    };

  const handleDeleteTransaction = async (id: string) => {
    try {
      // "Deleting" from the main UI now means disabling the transaction (soft delete)
      await toggleTransaction(id, false);
      toast({ title: "Transaction Disabled", description: "The transaction has been disabled and can be restored from the Activity Log." });
    } catch (error) {
      console.error("Failed to disable transaction", error);
      toast({ variant: 'destructive', title: "Error", description: "Could not disable the transaction." });
    }
  };
  
  const handleToggleTransaction = async (id: string, enabled: boolean) => {
    if (firebaseStatus !== 'connected') {
        const updater = (prev: Transaction[]) => prev.map(t => t.id === id ? { ...t, enabled } : t);
        setTransactions(updater);
        setAllTransactions(updater);
        toast({ title: "Sample transaction toggled", description: "This will not be saved." });
        return;
    }
    try {
      await toggleTransaction(id, enabled);
    } catch (error) {
      console.error("Failed to toggle transaction", error);
      toast({ variant: 'destructive', title: "Error", description: "Could not toggle transaction." });
    }
  };
  
  const { groupedTransactions, filteredIds, openingBalance } = useMemo(() => {
    const transactionSource = firebaseStatus === 'connected' ? allTransactions : sampleTransactions;

    const firstDateInFilter = filters.dateFrom || '1970-01-01';
    
    // 1. Calculate running balances on ALL transactions first.
    let runningBalance = 0;
    const allTransactionsWithBalance = [...transactionSource]
        .sort((a,b) => {
            const dateA = new Date(a.date).getTime();
            const dateB = new Date(b.date).getTime();
            if (dateA !== dateB) return dateA - dateB;
            // If dates are the same, sort by creation time
            const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
            const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
            return timeA - timeB;
        })
        .map(t => {
            runningBalance += getEffectiveAmount(t);
            return { ...t, closingBalance: runningBalance };
        });

    // 2. Determine opening balance based on the date filter.
    const openingBalanceCalc = allTransactionsWithBalance
        .filter(t => t.date < firstDateInFilter && t.enabled)
        .pop()?.closingBalance || 0;
        
    // 3. Filter the transactions for display.
    const filteredTransactions = allTransactionsWithBalance.filter(t => {
      if (filters.type !== 'all' && t.type !== filters.type) return false;
      if (filters.accountId !== 'all' && t.accountId !== filters.accountId) return false;
      if (filters.partyId !== 'all' && t.partyId !== filters.partyId) return false;
      if (filters.via !== 'all' && t.via !== filters.via) return false;

      if (filters.status === 'enabled' && !t.enabled) return false;
      if (filters.status === 'disabled' && t.enabled) return false;
      
      if (filters.dateFrom && t.date < filters.dateFrom) return false;
      if (filters.dateTo && t.date > filters.dateTo) return false;
      
      return true;
    });

    const filteredIdsSet = new Set(filteredTransactions.map(t => t.id));
    
    // 4. Group the filtered transactions by date.
    const grouped: { [date: string]: GroupedTransaction } = {};
    filteredTransactions.forEach(t => {
      if (!grouped[t.date]) {
        grouped[t.date] = { date: t.date, transactions: [] };
      }
      grouped[t.date].transactions.push(t);
    });

    const groupedTransactionsArray = Object.values(grouped).sort((a, b) => {
        if (sort.sortBy.date === 'asc') return new Date(a.date).getTime() - new Date(b.date).getTime();
        return new Date(b.date).getTime() - new Date(a.date).getTime();
    });
    
    return { 
        groupedTransactions: groupedTransactionsArray, 
        filteredIds: filteredIdsSet, 
        openingBalance: openingBalanceCalc,
    };
  }, [allTransactions, filters, sort, firebaseStatus]);
  
  const handleDeleteFiltered = async () => {
    if (filteredIds.size === 0) {
      toast({ variant: 'destructive', title: "No transactions to delete", description: "Your current filters do not match any transactions." });
      return;
    }
    
    if (firebaseStatus !== 'connected') {
        const updater = (prev: Transaction[]) => prev.filter(t => !filteredIds.has(t.id));
        setTransactions(updater);
        setAllTransactions(updater);
        toast({ title: `Deleted ${filteredIds.size} sample transaction(s).`, description: "This will not be saved." });
        return;
    }
  
    try {
      await deleteFilteredTransactions(Array.from(filteredIds));
      toast({ title: `Successfully disabled ${filteredIds.size} transaction(s).` });
    } catch (err) {
      console.error("Failed to delete filtered transactions", err);
      toast({ variant: 'destructive', title: "Error", description: "Could not disable transactions." });
    }
  };
  
  const handleViewInvoice = (transaction: Transaction) => {
    setViewingInvoice(transaction);
  };
  
  const handlePrint = () => {
    const printable = invoiceRef.current;
    if (printable) {
      const printWindow = window.open('', '_blank');
      printWindow?.document.write('<html><head><title>Print Invoice</title>');
      printWindow?.document.write('<link rel="stylesheet" href="https://unpkg.com/tailwindcss@^2/dist/tailwind.min.css">');
      printWindow?.document.write('</head><body class="p-4">');
      printWindow?.document.write(printable.innerHTML);
      printWindow?.document.write('</body></html>');
      printWindow?.document.close();
      printWindow?.print();
    }
  };

  const handleDownloadBackup = () => {
    const source = firebaseStatus === 'connected' ? allTransactions : transactions;
    if (source.length === 0 && parties.length === 0) {
      toast({ variant: 'destructive', title: "No data to backup", description: "There are no transactions or parties to include in the backup." });
      return;
    }

    const backupData = {
      transactions: source,
      parties,
      accounts,
    };

    const jsonString = JSON.stringify(backupData, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const today = new Date().toISOString().split('T')[0];
    
    link.href = url;
    link.download = `fin-plan-backup-${today}.json`;
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    URL.revokeObjectURL(url);
    toast({ title: "Success", description: "Backup JSON file is being downloaded." });
  };
  
  const handleShareBackup = async () => {
    const source = firebaseStatus === 'connected' ? allTransactions : transactions;
    if (source.length === 0 && parties.length === 0) {
      toast({ variant: 'destructive', title: "No data to backup", description: "There are no transactions or parties to include in the backup." });
      return;
    }

    const backupData = {
      transactions: source,
      parties,
      accounts,
    };

    const jsonString = JSON.stringify(backupData, null, 2);
    const today = new Date().toISOString().split('T')[0];
    const fileName = `fin-plan-backup-${today}.json`;
    const file = new File([jsonString], fileName, { type: 'application/json' });

    try {
        await navigator.share({
          files: [file],
          title: 'Fin Plan Backup',
          text: `Fin Plan data backup from ${today}`,
        });
        toast({ title: "Success", description: "Backup shared successfully." });
    } catch (error) {
        console.error('Error sharing backup:', error);
        if (error instanceof DOMException && error.name === 'AbortError') {
            toast({
                title: "Share Canceled",
                description: "The share dialog was closed.",
            });
        } else {
            toast({
                variant: 'destructive',
                title: "Share Failed",
                description: "This browser may not support sharing files.",
            });
        }
    }
  };

  const handleRestoreClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!window.confirm("Are you sure you want to restore from this backup? This will delete all current data and replace it with the data from the file. This action cannot be undone.")) {
        if (fileInputRef.current) {
            fileInputRef.current.value = "";
        }
        return;
    }

    setIsRestoring(true);
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const text = e.target?.result;
            if (typeof text !== 'string') {
                throw new Error("Failed to read file.");
            }
            const data = JSON.parse(text);

            if (!data.parties || !data.transactions || !data.accounts ||!Array.isArray(data.parties) || !Array.isArray(data.transactions) || !Array.isArray(data.accounts)) {
                throw new Error("Invalid backup file format. The file must contain 'parties', 'transactions', and 'accounts' arrays.");
            }

            await restoreData(data);
            toast({ title: "Success", description: "Data restored successfully." });
        } catch (error) {
            console.error("Failed to restore data", error);
            const errorMessage = error instanceof Error ? error.message : "Could not restore data.";
            toast({ variant: 'destructive', title: "Error", description: errorMessage });
        } finally {
            setIsRestoring(false);
            if (fileInputRef.current) {
                fileInputRef.current.value = "";
            }
        }
    };
    reader.onerror = () => {
        toast({ variant: 'destructive', title: "Error", description: "Failed to read the backup file." });
        setIsRestoring(false);
    }
    reader.readAsText(file);
  };
  
  const renderTransactionForm = () => (
    <TransactionForm parties={parties} accounts={accounts} onAddTransaction={handleAddTransaction} appSettings={appSettings} />
  );

  const todayBalances = useMemo(() => {
    const source = firebaseStatus === 'connected' ? accounts : sampleAccounts;
    return source.reduce((acc, account) => {
        const lowerCaseName = account.name.toLowerCase();
        if (lowerCaseName.includes('cash')) {
            acc.cash += account.balance;
        } else {
            acc.bank += account.balance;
        }
        acc.total += account.balance;
        return acc;
    }, { cash: 0, bank: 0, total: 0 });
  }, [accounts, firebaseStatus]);
  
  const stockInfo = useMemo(() => {
    if (filters.via === 'all' || !appSettings) return null;
    
    const profile = appSettings.businessProfiles.find(p => p.name === filters.via);
    if (!profile || !profile.location) return null;
    
    const locationName = profile.location;
    let locationStockValue = 0;
    let totalStockValue = 0;

    inventoryItems.forEach(item => {
        const locationQty = item.stock?.[locationName] || 0;
        locationStockValue += locationQty * item.cost;
        totalStockValue += item.quantity * item.cost;
    });

    return {
        title: `${profile.name} Stock`,
        balances: {
            cash: locationStockValue,
            bank: totalStockValue,
            total: totalStockValue - locationStockValue,
        },
        icon: Archive
    };
  }, [filters.via, inventoryItems, appSettings]);


  return (
    <>
        <EditTransactionDialog
            transaction={editingTransaction}
            parties={parties}
            accounts={accounts}
            appSettings={appSettings}
            onOpenChange={(isOpen) => !isOpen && setEditingTransaction(null)}
            onSave={handleUpdateTransaction}
        />
        <InvoiceDialog
          isOpen={!!viewingInvoice}
          onOpenChange={(open) => !open && setViewingInvoice(null)}
          invoice={viewingInvoice}
          party={parties.find(p => p.id === viewingInvoice?.partyId)}
          parties={parties}
          appSettings={appSettings}
          onPrint={handlePrint}
          ref={invoiceRef}
          accounts={accounts}
          allTransactions={allTransactions}
        />
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileChange}
          accept="application/json"
          className="hidden"
        />
        <div className="flex flex-wrap items-center gap-4 mb-6">
          <FirebaseStatusIndicator status={firebaseStatus} />
          <div className="flex-grow">
            {stockInfo ? (
                <BalanceSummary title={stockInfo.title} balances={stockInfo.balances} />
            ) : (
                <BalanceSummary title="Today's Balance" balances={todayBalances} />
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={() => window.print()} variant="outline"><Printer className="mr-2 h-4 w-4" /> Print History</Button>
            <Button onClick={handleDownloadBackup} variant="outline" disabled={firebaseStatus !== 'connected'}><Download className="mr-2 h-4 w-4" /> Download Backup</Button>
            {canShare && (
              <Button onClick={handleShareBackup} variant="outline" disabled={firebaseStatus !== 'connected'}><Share2 className="mr-2 h-4 w-4" /> Share Backup</Button>
            )}
            <Button onClick={handleRestoreClick} variant="outline" disabled={firebaseStatus !== 'connected' || isRestoring}>
              {isRestoring ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Upload className="mr-2 h-4 w-4" />
              )}
              Restore Backup
            </Button>
          </div>
        </div>
        
        {firebaseStatus === 'not_configured' && (
          <Alert variant="destructive" className="mb-6">
            <Terminal className="h-4 w-4" />
            <AlertTitle>Action Required: Firebase Not Configured</AlertTitle>
            <AlertDescription>
              <p>Your application is running in offline mode with sample data.</p>
              <p>To connect to your database and save your data, please follow these steps:</p>
              <ol className="list-decimal list-inside mt-2 space-y-1">
                <li>Create a file named <strong>.env.local</strong> in the root directory of the project.</li>
                <li>Copy the content from <strong>.env.example</strong> and paste it into <strong>.env.local</strong>.</li>
                <li>Replace the placeholder values with your actual Firebase project credentials.</li>
              </ol>
            </AlertDescription>
          </Alert>
        )}

        {firebaseStatus === 'error' && firebaseErrorType === 'unavailable' && (
           <Alert variant="destructive" className="mb-6">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>ফায়ারবেস সেটআপ প্রয়োজন (Firebase Setup Required)</AlertTitle>
            <AlertDescription>
              <p className="font-bold">আপনার অ্যাপটি ডেটাবেসের সাথে সংযোগ করতে পারছে না।</p>
              <p className="mt-1">এর কারণ হতে পারে আপনার ফায়ারবেস প্রজেক্টে এখনও ডাটাবেসটি তৈরি করা হয়নি বা নিরাপত্তা নিয়মাবলী (Security Rules) ঠিকভাবে সেট করা নেই। অথবা, আপনার `.env.local` ফাইলে দেওয়া ক্রেডেনশিয়ালগুলো সঠিক নয়।</p>
              <p className="mt-2">অনুগ্রহ করে নিচের গাইডটি অনুসরণ করে আপনার ডেটাবেস সেটআপ সম্পন্ন করুন। এটি একটি এককালীন প্রক্রিয়া।</p>
               <Button asChild variant="secondary" className="mt-3">
                    <a href="/explanation.html" target="_blank" rel="noopener noreferrer">
                        সেটআপ গাইড দেখুন (View Setup Guide)
                    </a>
                </Button>
            </AlertDescription>
          </Alert>
        )}

        
        {isMobile ? (
          <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
            <DialogContent>
               <DialogHeader>
                  <DialogTitle>Add New Transaction</DialogTitle>
                </DialogHeader>
              {renderTransactionForm()}
            </DialogContent>
          </Dialog>
        ) : (
          renderTransactionForm()
        )}
        
        <h2 className="text-2xl font-semibold mb-4 mt-8 text-gray-800 dark:text-gray-200">Transaction History</h2>
        <TransactionFilters 
          filters={filters}
          setFilters={setFilters}
          onDateToChange={handleDateToChange}
          accounts={accounts}
          parties={parties}
          appSettings={appSettings}
          onDeleteFiltered={handleDeleteFiltered}
          sort={sort}
          setSort={setSort}
          filteredCount={filteredIds.size}
        />
        {loading ? (
          <div className="flex justify-center items-center h-48">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : (
          <TransactionTable 
            groupedTransactions={groupedTransactions}
            accounts={accounts} 
            parties={parties}
            onEdit={handleEditTransaction}
            onDelete={handleDeleteTransaction}
            onToggle={handleToggleTransaction}
            onViewInvoice={handleViewInvoice}
            openingBalance={openingBalance}
            isDateFilterActive={filters.dateFrom !== '' || filters.dateTo !== '' || filters.status !== 'enabled'}
          />
        )}
       {isMobile && (
        <div className="fixed bottom-24 right-6 z-50">
          <Button 
            className="h-14 w-14 rounded-full shadow-lg"
            onClick={() => setIsFormOpen(true)}
          >
            <Plus className="h-6 w-6" />
          </Button>
        </div>
      )}
    </>
  );
}
