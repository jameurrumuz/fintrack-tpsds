
"use client"

import { useState, useMemo, useEffect, useRef } from 'react';
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

const FirebaseStatusIndicator = ({ status }: { status: FirebaseStatus }) => {
  const statusInfo = {
    initializing: { text: "Initializing...", icon: <Loader2 className="animate-spin" />, variant: "outline" as const },
    not_configured: { text: "Offline Mode (Sample Data)", icon: <AlertCircle />, variant: "destructive" as const },
    connecting: { text: "Connecting...", icon: <Loader2 className="animate-spin" />, variant: "outline" as const },
    connected: { text: "Connected", icon: <Wifi />, variant: "secondary" as const, className: "text-green-600 border-green-500"},
    error: { text: "এই ইররটি ঠিক করে দাও", icon: <WifiOff />, variant: "destructive" as const },
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
  const [isFormOpen, setIsFormOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const invoiceRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();
  const { toast } = useToast();


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
    if (!db) {
        setFirebaseStatus('not_configured');
        setLoading(false);
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
        setLoading(false);
    };

    const unsubscribeTransactions = subscribeToAllTransactions((latestTransactions) => {
        setAllTransactions(latestTransactions);
        setTransactions(latestTransactions); 
        setFirebaseStatus('connected');
        setFirebaseErrorType(null);
        setLoading(false);
    }, (e) => onSubscriptionError(e, 'transactions'));
    
    const unsubscribeParties = subscribeToParties((latestParties) => {
        setParties(latestParties);
    }, (e) => onSubscriptionError(e, 'parties'));

    const unsubscribeAccounts = subscribeToAccounts((latestAccounts) => {
        setAccounts(latestAccounts);
    }, (e) => onSubscriptionError(e, 'accounts'));

    const unsubscribeInventory = subscribeToInventoryItems((latestItems) => {
        setInventoryItems(latestItems);
    }, (e) => onSubscriptionError(e, 'inventory'));

    getAppSettings().then(setAppSettings);

    return () => {
        unsubscribeTransactions();
        unsubscribeParties();
        unsubscribeAccounts();
        unsubscribeInventory();
    };
  }, [toast]);
  

  const handleAddTransaction = async (data: Omit<Transaction, 'id' | 'enabled'>[], mode: 'saveAndClose' | 'saveAndNext') => {
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
      toast({ variant: 'destructive', title: "Error", description: "Could not add transaction(s)." });
    }
  };
  
  const handleEditTransaction = (transaction: Transaction) => {
    setEditingTransaction(transaction);
  };
  
  const handleUpdateTransaction = async (data: Omit<Transaction, 'id' | 'enabled'>) => {
      if (!editingTransaction) return;
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
      await toggleTransaction(id, false);
      toast({ title: "Transaction Disabled", description: "The transaction has been disabled and can be restored from the Activity Log." });
    } catch (error) {
      console.error("Failed to disable transaction", error);
      toast({ variant: 'destructive', title: "Error", description: "Could not disable the transaction." });
    }
  };
  
  const handleToggleTransaction = async (id: string, enabled: boolean) => {
    try {
      await toggleTransaction(id, enabled);
    } catch (error) {
      console.error("Failed to toggle transaction", error);
      toast({ variant: 'destructive', title: "Error", description: "Could not toggle transaction." });
    }
  };
  
  const { groupedTransactions, filteredIds, openingBalance } = useMemo(() => {
    const firstDateInFilter = filters.dateFrom || '1970-01-01';
    
    let runningBalance = 0;
    const allTransactionsWithBalance = [...allTransactions]
        .sort((a,b) => {
            const dateA = new Date(a.date).getTime();
            const dateB = new Date(b.date).getTime();
            if (dateA !== dateB) return dateA - dateB;
            const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
            const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
            return timeA - timeB;
        })
        .map(t => {
            runningBalance += getEffectiveAmount(t);
            return { ...t, closingBalance: runningBalance };
        });

    const openingBalanceCalc = allTransactionsWithBalance
        .filter(t => t.date < firstDateInFilter && t.enabled)
        .pop()?.closingBalance || 0;
        
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
  }, [allTransactions, filters, sort]);
  
  const handleDeleteFiltered = async () => {
    if (filteredIds.size === 0) {
      toast({ variant: 'destructive', title: "No transactions to delete", description: "Your current filters do not match any transactions." });
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

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!window.confirm("Are you sure you want to restore from this backup? This will delete all current data and replace it with the data from the file. This action cannot be undone.")) {
        if (fileInputRef.current) fileInputRef.current.value = "";
        return;
    }

    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const text = e.target?.result;
            if (typeof text !== 'string') throw new Error("Failed to read file.");
            const data = JSON.parse(text);
            await restoreData(data);
            toast({ title: "Success", description: "Data restored successfully." });
        } catch (error: any) {
            toast({ variant: 'destructive', title: "Error", description: error.message });
        } finally {
            if (fileInputRef.current) fileInputRef.current.value = "";
        }
    };
    reader.readAsText(file);
  };
  
  const todayBalances = useMemo(() => {
    return accounts.reduce((acc, account) => {
        const lowerCaseName = account.name.toLowerCase();
        if (lowerCaseName.includes('cash')) acc.cash += account.balance;
        else acc.bank += account.balance;
        acc.total += account.balance;
        return acc;
    }, { cash: 0, bank: 0, total: 0 });
  }, [accounts]);

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
        <input type="file" ref={fileInputRef} onChange={handleFileChange} accept="application/json" className="hidden" />
        
        <div className="flex flex-wrap items-center gap-4 mb-6">
          <FirebaseStatusIndicator status={firebaseStatus} />
          <div className="flex-grow">
            <BalanceSummary title="Today's Balance" balances={todayBalances} />
          </div>
        </div>
        
        {isMobile ? (
          <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
            <DialogContent>
               <DialogHeader><DialogTitle>Add New Transaction</DialogTitle></DialogHeader>
               <TransactionForm parties={parties} accounts={accounts} onAddTransaction={handleAddTransaction} appSettings={appSettings} />
            </DialogContent>
          </Dialog>
        ) : (
          <TransactionForm parties={parties} accounts={accounts} onAddTransaction={handleAddTransaction} appSettings={appSettings} />
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
          <Button className="h-14 w-14 rounded-full shadow-lg" onClick={() => setIsFormOpen(true)}><Plus className="h-6 w-6" /></Button>
        </div>
      )}
    </>
  );
}
