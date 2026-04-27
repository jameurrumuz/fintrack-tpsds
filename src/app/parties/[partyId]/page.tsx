
'use client';

import React, { Suspense, useEffect, useMemo, useState, use, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { getDoc, doc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Transaction, Party, Account, AppSettings, TransactionVia, Loan, AmortizationEntry } from '@/types';
import { subscribeToAccounts } from '@/services/accountService';
import { subscribeToTransactionsForParty, addTransaction, updateTransaction, toggleTransaction } from '@/services/transactionService';
import { getAppSettings } from '@/services/settingsService';
import { markEmiAsPaid, deleteLoan, updateLoanDetails } from '@/services/partyService';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { formatAmount, formatDate, getPartyBalanceEffect, cn, cleanUndefined } from '@/lib/utils';
import { 
  Loader2, ArrowLeft, Printer, Banknote, ArrowDown, ArrowUp, Trash2, Edit, 
  MoreVertical, Plus, ShoppingCart, Wallet, Receipt, HandCoins, ArrowDownToLine, 
  Share2, Landmark, FileText, History, Search, Save, X, ChevronLeft, ChevronRight, 
  Check, Phone, Mail, Eye, BarChart2, MinusCircle, LayoutDashboard, Calculator, 
  Package, ChevronDown, ChevronUp, Zap, Circle, CheckCircle, Repeat 
} from 'lucide-react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription as AlertDialogDescriptionComponent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { DatePicker } from '@/components/ui/date-picker';
import { format as formatFns, subDays, parseISO, isValid } from 'date-fns';
import PartyTransactionEditDialog from '@/components/PartyTransactionEditDialog';
import PaymentReceiptDialog from '@/components/PaymentReceiptDialog';
import InvoiceDialog from '@/components/pos/InvoiceDialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose, DialogDescription } from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import QRCode from 'qrcode';
import html2canvas from 'html2canvas';
import { motion, AnimatePresence } from 'framer-motion';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';

const partyTransactionSchema = z.object({
  date: z.date(),
  description: z.string().min(1, 'Description is required'),
  amount: z.coerce.number().positive('Amount must be positive'),
  accountId: z.string().optional(),
  type: z.enum(['receive', 'give', 'credit_sale', 'purchase', 'spent', 'income', 'credit_purchase', 'sale_return', 'purchase_return', 'credit_give', 'credit_income']),
  via: z.string().optional(),
  charge: z.coerce.number().optional(),
  chargeVia: z.string().optional(),
}).superRefine((data, ctx) => {
    if (['give', 'receive', 'sale', 'purchase', 'spent', 'income'].includes(data.type)) {
        if (!data.accountId) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'Account is required for this transaction type.',
                path: ['accountId'],
            });
        }
    }
});

type FormValues = z.infer<typeof partyTransactionSchema>;

function PartyLedgerPage({ params }: { params: Promise<{ partyId: string }> }) {
  const { partyId } = use(params);
  const router = useRouter();
  const { toast } = useToast();
  const statementPrintRef = useRef<HTMLDivElement>(null);

  const [party, setParty] = useState<Party | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [isHydrated, setIsHydrated] = useState(false);
  
  const [filters, setFilters] = useState({ 
    dateFrom: '', 
    dateTo: '', 
    via: 'all'
  });
  const [isDateFilterEnabled, setIsDateFilterEnabled] = useState(true);
  const [includeInternalTx, setIncludeInternalTx] = useState(true);
  const [activeTab, setActiveTab] = useState("transactions");
  
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [formType, setFormType] = useState<'give' | 'receive' | 'spent'>('give');
  const [isReceiveOptionsOpen, setIsReceiveOptionsOpen] = useState(false);
  const [isGiveOptionsOpen, setIsGiveOptionsOpen] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
  const [viewingReceipt, setViewingReceipt] = useState<Transaction | null>(null);
  const [viewingInvoice, setViewingInvoice] = useState<Transaction | null>(null);
  
  const [sendSms, setSendSms] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState('');
  const [isHeaderActionsExpanded, setIsHeaderActionsExpanded] = useState(false);

  const [payingInstallment, setPayingInstallment] = useState<{ loanId: string; installment: AmortizationEntry; index: number } | null>(null);

  const transactionForm = useForm<FormValues>({
    resolver: zodResolver(partyTransactionSchema),
    defaultValues: {
      date: new Date(),
      description: '',
      type: 'receive',
      amount: '' as any,
      accountId: '',
      via: '',
      charge: 0,
      chargeVia: '',
    },
  });

  useEffect(() => {
    setIsHydrated(true);
  }, []);

  useEffect(() => {
    if (partyId) {
      setLoading(true);
      const fetchInitial = async () => {
          const snap = await getDoc(doc(db, 'parties', partyId));
          if (snap.exists()) {
              const data = snap.data();
              setParty({ id: snap.id, ...data } as Party);
              transactionForm.setValue('via', data.group || 'Personal');
              transactionForm.setValue('chargeVia', data.group || 'Personal');
          }
          const settings = await getAppSettings();
          setAppSettings(settings);
      };
      
      fetchInitial();
      
      const unsubTx = subscribeToTransactionsForParty(partyId, (data) => setTransactions(data), (err) => toast({ variant: 'destructive', title: 'Error', description: err.message }));
      const unsubAcc = subscribeToAccounts(setAccounts, console.error);
      
      const timer = setTimeout(() => setLoading(false), 500);
      
      return () => {
          unsubTx();
          unsubAcc();
          clearTimeout(timer);
      };
    }
  }, [partyId, toast, transactionForm]);

  useEffect(() => {
    if (isHeaderActionsExpanded) {
        const timer = setTimeout(() => {
            setIsHeaderActionsExpanded(false);
        }, 5000);
        return () => clearTimeout(timer);
    }
  }, [isHeaderActionsExpanded]);

  useEffect(() => {
    if (!loading && transactions.length > 0) {
      const today = new Date();
      const todayStr = formatFns(today, 'yyyy-MM-dd');
      const sevenDaysAgo = formatFns(subDays(today, 7), 'yyyy-MM-dd');
      setFilters(prev => ({ ...prev, dateFrom: sevenDaysAgo, dateTo: todayStr }));
    }
  }, [loading, transactions.length]);

  const { groupedTransactions, currentBalance, openingBalance, finalBalanceInTable, analysis } = useMemo(() => {
    const enabledTxs = transactions.filter(t => t.enabled);
    
    // Sort oldest to newest for consistent running balance calculation (as per RULES.md)
    const sortedTimeline = [...enabledTxs].sort((a, b) => {
        const dateA = new Date(a.date).getTime();
        const dateB = new Date(b.date).getTime();
        if (dateA !== dateB) return dateA - dateB;
        const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return timeA - timeB;
    });
    
    let running = 0;
    let totalReceive = 0; // Cr Total
    let totalGive = 0;    // Dr Total

    const withRunning = sortedTimeline.map(t => {
        const effect = getPartyBalanceEffect(t);
        running += effect;
        
        // Match the columns logic for totals in Analysis
        if (['receive', 'credit_purchase', 'sale_return', 'credit_income', 'sale', 'income'].includes(t.type)) {
            totalReceive += t.amount;
        }
        if (['give', 'credit_sale', 'purchase_return', 'credit_give', 'spent', 'purchase'].includes(t.type)) {
            totalGive += t.amount;
        }

        return { ...t, runningBalance: running };
    });

    const opening = isDateFilterEnabled ? withRunning
        .filter(t => t.date < filters.dateFrom)
        .pop()?.runningBalance || 0 : 0;

    let filtered = withRunning.filter(t => {
        if (!includeInternalTx) {
            const effect = getPartyBalanceEffect(t);
            if (effect === 0) return false;
        }
        if (filters.via !== 'all' && t.via !== filters.via) return false;
        if (!isDateFilterEnabled) return true;
        return t.date >= filters.dateFrom && t.date <= filters.dateTo;
    });

    // Grouping by date but keeping older entries on top (RULES.md)
    const grouped: { [key: string]: any[] } = {};
    filtered.forEach(t => { if(!grouped[t.date]) grouped[t.date] = []; grouped[t.date].push(t); });
    
    const groupedArray = Object.entries(grouped).sort(([dateA], [dateB]) => new Date(dateA).getTime() - new Date(dateB).getTime());

    return { 
        groupedTransactions: groupedArray, 
        currentBalance: running, 
        openingBalance: opening, 
        finalBalanceInTable: running,
        analysis: { totalReceive, totalGive }
    };
  }, [transactions, filters, isDateFilterEnabled, includeInternalTx]);

  const stats = useMemo(() => {
    const enabledTxs = transactions.filter(t => t.enabled);
    if (enabledTxs.length === 0) return null;

    const sortedByDate = [...enabledTxs].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    
    const startDate = sortedByDate[0].date;
    const totalCount = enabledTxs.length;
    
    const latestTx = [...enabledTxs].sort((a,b) => {
        const dateDiff = new Date(b.date).getTime() - new Date(a.date).getTime();
        if (dateDiff !== 0) return dateDiff;
        const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return timeB - timeA;
    })[0];

    const productSalesMap = new Map<string, { quantity: number, totalValue: number }>();
    const productReturnsMap = new Map<string, number>();

    enabledTxs.forEach(tx => {
        if (tx.type === 'sale' || tx.type === 'credit_sale') {
            tx.items?.forEach(item => {
                const existing = productSalesMap.get(item.id) || { quantity: 0, totalValue: 0 };
                existing.quantity += item.quantity;
                existing.totalValue += (item.price * item.quantity);
                productSalesMap.set(item.id, existing);
            });
        } else if (tx.type === 'sale_return') {
            tx.items?.forEach(item => {
                const existing = productReturnsMap.get(item.id) || 0;
                productReturnsMap.set(item.id, existing + item.quantity);
            });
        }
    });

    const productStats = Array.from(productSalesMap.entries()).map(([id, data]) => ({
        id,
        name: (enabledTxs.find(tx => tx.items?.some(i => i.id === id))?.items?.find(i => i.id === id)?.name || 'Unknown'),
        quantity: data.quantity,
        avgPrice: data.quantity > 0 ? data.totalValue / data.quantity : 0,
        returns: productReturnsMap.get(id) || 0
    }));

    return { startDate, totalCount, latestTx, productStats };
  }, [transactions]);

  const businessProfile = useMemo(() => {
      return appSettings?.businessProfiles.find(p => p.name === party?.group) || appSettings?.businessProfiles[0];
  }, [appSettings, party]);

  useEffect(() => {
    if (party && businessProfile && isHydrated) {
        const qrText = `Party: ${party.name}\nBalance: ${formatAmount(currentBalance)}\nFrom: ${businessProfile.name}`;
        QRCode.toDataURL(qrText, { width: 100, margin: 1, errorCorrectionLevel: 'H' }, (err, url) => {
            if (err) return;
            setQrCodeDataUrl(url);
        });
    }
  }, [party, businessProfile, currentBalance, isHydrated]);

  const handleShareStatement = async () => {
    const element = statementPrintRef.current;
    if (!element) return;

    toast({ title: "Generating image...", description: "Please wait while we prepare your statement." });

    try {
      element.style.display = 'block';
      await new Promise(resolve => setTimeout(resolve, 500));
      
      const canvas = await html2canvas(element, { 
        scale: 2, 
        useCORS: true, 
        backgroundColor: '#ffffff',
        logging: false,
      });

      if (!window.matchMedia('print').matches) {
          element.style.display = 'none';
      }

      canvas.toBlob(async (blob) => {
        if (!blob) return;
        const file = new File([blob], `Statement_${party?.name}_${Date.now()}.png`, { type: 'image/png' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({
            files: [file],
            title: 'Party Statement',
            text: `Statement for ${party?.name} from ${businessProfile?.name}`
          });
        } else {
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = `Statement_${party?.name}.png`;
          link.click();
          toast({ title: "Sharing not supported", description: "Statement image has been downloaded instead." });
        }
      }, 'image/png');
    } catch (e) {
      console.error(e);
      toast({ variant: 'destructive', title: "Error", description: "Failed to generate statement image." });
    }
  };

  const handleAddTransaction = async (data: FormValues) => {
    if (!party) return;
    setIsSaving(true);
    try {
        const dateStr = formatFns(data.date, 'yyyy-MM-dd');
        
        await addTransaction({
            ...data,
            date: dateStr,
            partyId: party.id,
            enabled: true,
            via: data.via || 'Personal',
            sendSms: sendSms,
        });

        if (data.charge && data.charge > 0) {
            await addTransaction({
                date: dateStr,
                description: `Charge for: ${data.description}`,
                amount: data.charge,
                type: 'spent',
                accountId: data.accountId,
                via: data.chargeVia || data.via || 'Personal',
                enabled: true,
            });
        }

        toast({ title: "Success", description: "Transaction added successfully." });
        setIsFormOpen(false);
        transactionForm.reset();
    } catch (error: any) {
        toast({ variant: "destructive", title: "Error", description: error.message });
    } finally {
        setIsSaving(false);
    }
  };

  const openReceiveForm = (type: 'receive' | 'credit_income') => {
      setFormType('receive');
      transactionForm.setValue('type', type);
      transactionForm.setValue('description', `Received from ${party?.name}`);
      setIsReceiveOptionsOpen(false);
      setIsFormOpen(true);
  }

  const openGiveForm = (type: 'give' | 'credit_give') => {
      setFormType('give');
      transactionForm.setValue('type', type);
      transactionForm.setValue('description', `Paid to ${party?.name}`);
      setIsGiveOptionsOpen(false);
      setIsFormOpen(true);
  }
  
  const openExpenseForm = () => {
      setFormType('spent');
      transactionForm.setValue('type', 'spent');
      transactionForm.setValue('description', `Expense for ${party?.name}`);
      const cashAcc = accounts.find(a => a.name.toLowerCase().includes('cash')) || accounts[0];
      if (cashAcc) transactionForm.setValue('accountId', cashAcc.id);
      setIsFormOpen(true);
  }

  const handleMarkEmiAsPaid = async (loanId: string, index: number, paymentDetails: any) => {
    if (!party) return;
    try {
        await markEmiAsPaid(party.id, loanId, index, paymentDetails);
        setPayingInstallment(null);
        toast({ title: 'Success', description: 'EMI payment recorded.' });
    } catch (e: any) {
        toast({ variant: 'destructive', title: 'Error', description: e.message });
    }
  };

  const getAccountName = (accountId?: string) => accounts.find(a => a.id === accountId)?.name || '';

  const getTxAccountDetails = (t: Transaction) => {
    if (t.type === 'transfer') {
        return `${getAccountName(t.fromAccountId)} → ${getAccountName(t.toAccountId)}`;
    }
    if (t.payments && t.payments.length > 0) {
        return t.payments.map(p => getAccountName(p.accountId)).join(', ');
    }
    return getAccountName(t.accountId);
  };

  if (loading || !party || !isHydrated) return <div className="flex justify-center items-center h-screen"><Loader2 className="animate-spin h-12 w-12 text-primary" /></div>;

  return (
    <div className="flex flex-col bg-gray-50 dark:bg-gray-900 min-h-screen pb-24">
        <style>{`
            @media print {
              body * { 
                visibility: hidden !important; 
                font-weight: 400 !important;
                color: black !important;
              }
              #printable-area-wrapper, #printable-area-wrapper * { 
                visibility: visible !important; 
              }
              h1, h2, h3, .font-bold, .font-black { font-weight: 600 !important; }
              @page { size: A4; margin: 0.5in; }
              #printable-area-wrapper { position: absolute !important; left: 0 !important; top: 0 !important; width: 100% !important; z-index: 9999 !important; display: block !important; }
              table { border-collapse: collapse !important; width: 100% !important; }
              table th, table td { border: 1px solid #ddd !important; padding: 6px !important; }
              .no-print { display: none !important; }
              .print-ink-save { font-weight: 400 !important; }
            }
        `}</style>
        
        <PartyTransactionEditDialog transaction={editingTransaction} onOpenChange={(open) => !open && setEditingTransaction(null)} onSave={async (data) => { await updateTransaction(editingTransaction!.id, data); setEditingTransaction(null); }} parties={[party]} accounts={accounts} inventoryItems={[]} appSettings={appSettings} />
        <PaymentReceiptDialog isOpen={!!viewingReceipt} onOpenChange={(open) => !open && setViewingReceipt(null)} transaction={viewingReceipt} party={party} appSettings={appSettings} accounts={accounts} allTransactions={transactions} />
        <InvoiceDialog isOpen={!!viewingInvoice} onOpenChange={(open) => !open && setViewingInvoice(null)} invoice={viewingInvoice} party={party} parties={[party]} appSettings={appSettings} onPrint={() => window.print()} accounts={accounts} allTransactions={transactions} />

        <Dialog open={isReceiveOptionsOpen} onOpenChange={setIsReceiveOptionsOpen}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader><DialogTitle>Select "Receive" Type</DialogTitle></DialogHeader>
                <div className="grid gap-4 py-4">
                    <Button variant="outline" className="h-16 flex items-center justify-start gap-4 px-6" onClick={() => openReceiveForm('receive')}>
                        <div className="p-2 rounded-full bg-green-100 text-green-600"><Wallet className="h-6 w-6"/></div>
                        <div className="text-left"><p className="font-bold text-sm">Receive Payment</p><p className="text-[10px] text-muted-foreground">Cash/Bank entry for existing due</p></div>
                    </Button>
                    <Button variant="outline" className="h-16 flex items-center justify-start gap-4 px-6" onClick={() => openReceiveForm('credit_income')}>
                        <div className="p-2 rounded-full bg-purple-100 text-purple-600"><HandCoins className="h-6 w-6"/></div>
                        <div className="text-left"><p className="font-bold text-sm">Credit Income (Due)</p><p className="text-[10px] text-muted-foreground">Record income without cash entry</p></div>
                    </Button>
                </div>
            </DialogContent>
        </Dialog>

        <Dialog open={isGiveOptionsOpen} onOpenChange={setIsGiveOptionsOpen}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader><DialogTitle>Select "Give" Type</DialogTitle></DialogHeader>
                <div className="grid gap-4 py-4">
                    <Button variant="outline" className="h-16 flex items-center justify-start gap-4 px-6" onClick={() => openGiveForm('give')}>
                        <div className="p-2 rounded-full bg-red-100 text-red-600"><Wallet className="h-6 w-6"/></div>
                        <div className="text-left"><p className="font-bold text-sm">Give (Paid)</p><p className="text-[10px] text-muted-foreground">Cash/Bank payment to party</p></div>
                    </Button>
                    <Button variant="outline" className="h-16 flex items-center justify-start gap-4 px-6" onClick={() => openGiveForm('credit_give')}>
                        <div className="p-2 rounded-full bg-orange-100 text-orange-600"><HandCoins className="h-6 w-6"/></div>
                        <div className="text-left"><p className="font-bold text-sm">Credit Give (Due)</p><p className="text-[10px] text-muted-foreground">Record due without cash entry</p></div>
                    </Button>
                </div>
            </DialogContent>
        </Dialog>

        <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
            <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
                <DialogHeader><DialogTitle>Record {formType === 'give' ? 'Payment Given' : formType === 'spent' ? 'Expense' : 'Payment Received'}</DialogTitle></DialogHeader>
                <form onSubmit={transactionForm.handleSubmit(handleAddTransaction)} className="space-y-4 py-2">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1"><Label>Amount</Label><Input type="number" step="0.01" {...transactionForm.register('amount')} autoFocus /></div>
                        <div className="space-y-1"><Label>Date</Label><Controller control={transactionForm.control} name="date" render={({ field }) => (<DatePicker value={field.value} onChange={(d) => field.onChange(d as Date)} />)} /></div>
                    </div>
                    <div className="space-y-1"><Label>Description</Label><Input {...transactionForm.register('description')} /></div>
                    <div className="grid grid-cols-2 gap-4">
                        {!['credit_give', 'credit_income'].includes(transactionForm.watch('type')) && (
                            <div className="space-y-1">
                                <Label>Account</Label>
                                <Controller name="accountId" control={transactionForm.control} render={({ field }) => (
                                    <Select onValueChange={field.onChange} value={field.value}>
                                        <SelectTrigger><SelectValue placeholder="Account..." /></SelectTrigger>
                                        <SelectContent>{accounts.map(acc => <SelectItem key={acc.id} value={acc.id}>{acc.name}</SelectItem>)}</SelectContent>
                                    </Select>
                                )} />
                            </div>
                        )}
                         <div className="space-y-1">
                            <Label>Profile (Via)</Label>
                             <Controller name="via" control={transactionForm.control} render={({ field }) => (
                                <Select onValueChange={field.onChange} value={field.value}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>{appSettings?.businessProfiles.map(p => <SelectItem key={p.name} value={p.name}>{p.name}</SelectItem>)}</SelectContent>
                                </Select>
                            )} />
                        </div>
                    </div>
                    <DialogFooter><Button type="submit" disabled={isSaving}>{isSaving ? <Loader2 className="animate-spin mr-2 h-4 w-4"/> : <Save className="mr-2 h-4 w-4"/>}Save</Button></DialogFooter>
                </form>
            </DialogContent>
        </Dialog>

        <header className="bg-background border-b sticky top-0 z-20 shadow-sm no-print">
            <div className="container mx-auto px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                        <Button variant="ghost" size="icon" asChild className="h-8 w-8"><Link href="/parties"><ArrowLeft className="h-4 w-4" /></Link></Button>
                        <Avatar className="h-8 w-8"><AvatarFallback className="bg-primary text-white font-bold text-xs">{party.name?.charAt(0)}</AvatarFallback></Avatar>
                        <div><h1 className="text-sm font-bold truncate max-w-[150px]">{party.name}</h1><p className="text-[10px] text-muted-foreground">{party.phone || 'No Phone'}</p></div>
                    </div>
                </div>
                <div className="mt-2">
                    <Card className="bg-gray-100 dark:bg-gray-800 border-0 shadow-sm relative overflow-hidden">
                        <CardContent className="p-3 text-center">
                            <p className="text-[10px] uppercase font-black text-gray-500 tracking-widest mb-1">{currentBalance >= 0 ? 'NET PAYABLE' : 'NET RECEIVABLE'}</p>
                            <p className={cn("text-3xl font-black", currentBalance >= 0 ? "text-red-600" : "text-green-600")}>৳{formatAmount(Math.abs(currentBalance), false)}</p>
                            
                            <motion.div 
                                initial={false}
                                animate={{ height: isHeaderActionsExpanded ? 'auto' : 0, opacity: isHeaderActionsExpanded ? 1 : 0 }}
                                className="overflow-hidden"
                            >
                                <div className="flex justify-center gap-4 mt-4 pt-3 border-t border-gray-200 dark:border-gray-700">
                                    <button onClick={openExpenseForm} className="flex flex-col items-center gap-1 group">
                                        <div className="p-2 rounded-full bg-red-100 text-red-600 group-hover:bg-red-200 transition-colors"><MinusCircle className="h-4 w-4"/></div>
                                        <span className="text-[10px] font-bold text-gray-500 uppercase">EXPENSE</span>
                                    </button>
                                    <Link href={`/pos?partyId=${partyId}`} className="flex flex-col items-center gap-1 group">
                                        <div className="p-2 rounded-full bg-green-100 text-green-600 group-hover:bg-green-200 transition-colors"><ShoppingCart className="h-4 w-4"/></div>
                                        <span className="text-[10px] font-bold text-gray-500 uppercase">POS</span>
                                    </Link>
                                    <button onClick={() => window.print()} className="flex flex-col items-center gap-1 group">
                                        <div className="p-2 rounded-full bg-gray-100 text-gray-600 group-hover:bg-gray-200 transition-colors"><Printer className="h-4 w-4"/></div>
                                        <span className="text-[10px] font-bold text-gray-500 uppercase">PRINT</span>
                                    </button>
                                    <button onClick={handleShareStatement} className="flex flex-col items-center gap-1 group">
                                        <div className="p-2 rounded-full bg-teal-100 text-teal-600 group-hover:bg-teal-200 transition-colors"><Share2 className="h-4 w-4"/></div>
                                        <span className="text-[10px] font-bold text-gray-500 uppercase">SHARE</span>
                                    </button>
                                </div>
                            </motion.div>
                            
                            <button 
                                onClick={() => setIsHeaderActionsExpanded(!isHeaderActionsExpanded)}
                                className="mx-auto mt-2 flex h-6 w-12 items-center justify-center rounded-full bg-gray-200 dark:bg-gray-700 text-gray-500 hover:bg-gray-300 transition-colors"
                            >
                                {isHeaderActionsExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                            </button>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </header>

        <main className="container mx-auto p-3 flex-1 overflow-auto">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <div className="flex justify-center border-b mb-4 no-print">
                <TabsList className="bg-transparent h-12 gap-6 px-4">
                    <TabsTrigger value="transactions" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none font-bold uppercase text-xs text-muted-foreground data-[state=active]:text-foreground">Transactions</TabsTrigger>
                    <TabsTrigger value="analysis" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none font-bold uppercase text-xs text-muted-foreground data-[state=active]:text-foreground">Analysis</TabsTrigger>
                    <TabsTrigger value="loan" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none font-bold uppercase text-xs text-muted-foreground data-[state=active]:text-foreground">Loan</TabsTrigger>
                </TabsList>
            </div>

            <TabsContent value="transactions" className="space-y-3 m-0">
                <div className="flex flex-wrap items-end gap-4 bg-background p-3 rounded-lg border shadow-sm no-print mb-4">
                    <div className="space-y-1">
                        <Label className="text-[10px] font-bold uppercase text-muted-foreground">Start Date</Label>
                        <Input type="date" value={filters.dateFrom} onChange={e => setFilters({...filters, dateFrom: e.target.value})} className="h-9 text-sm w-[140px]" />
                    </div>
                    <div className="space-y-1">
                        <Label className="text-[10px] font-bold uppercase text-muted-foreground">End Date</Label>
                        <Input type="date" value={filters.dateTo} onChange={e => setFilters({...filters, dateTo: e.target.value})} className="h-9 text-sm w-[140px]" />
                    </div>
                    <div className="space-y-1 min-w-[140px]">
                        <Label className="text-[10px] font-bold uppercase text-muted-foreground">Profile</Label>
                        <Select value={filters.via} onValueChange={v => setFilters({...filters, via: v})}>
                            <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="All Profiles" /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Profiles</SelectItem>
                                {appSettings?.businessProfiles.map(p => <SelectItem key={p.name} value={p.name}>{p.name}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="flex items-center space-x-2 pb-2">
                        <Switch id="all-tx-switch" checked={!isDateFilterEnabled} onCheckedChange={(checked) => setIsDateFilterEnabled(!checked)} />
                        <Label htmlFor="all-tx-switch" className="text-[10px] font-bold uppercase text-muted-foreground cursor-pointer">All Transaction</Label>
                    </div>
                    <div className="flex items-center space-x-2 pb-2">
                        <Checkbox id="inc-exp-check" checked={includeInternalTx} onCheckedChange={(checked) => setIncludeInternalTx(!!checked)} />
                        <Label htmlFor="inc-exp-check" className="text-[10px] font-bold uppercase text-muted-foreground cursor-pointer">INC/EXP</Label>
                    </div>
                </div>

                <div className="rounded-lg border bg-card shadow-sm overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/50">
                          <TableHead className="text-xs">Date</TableHead>
                          <TableHead>Description</TableHead>
                          <TableHead className="text-right text-xs">Dr (Gave)</TableHead>
                          <TableHead className="text-right text-xs">Cr (Recv)</TableHead>
                          <TableHead className="text-right text-xs">Balance</TableHead>
                          <TableHead className="w-[40px] no-print"></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {isDateFilterEnabled && (
                            <TableRow className="bg-slate-50 italic">
                                <TableCell colSpan={4} className="text-right font-medium text-xs">Opening Balance</TableCell>
                                <TableCell className="text-right font-bold text-xs">{formatAmount(openingBalance)}</TableCell>
                                <TableCell className="no-print"></TableCell>
                            </TableRow>
                        )}
                        {groupedTransactions.map(([date, txs]) => (
                          <React.Fragment key={date}>
                            <TableRow className="bg-primary/5">
                              <TableCell colSpan={6} className="py-1 px-3 font-bold text-[10px] text-primary">{formatDate(date)}</TableCell>
                            </TableRow>
                            {txs.map((t) => {
                              const effect = getPartyBalanceEffect(t);
                              
                              const isDebit = ['give', 'credit_sale', 'purchase_return', 'credit_give', 'spent', 'purchase'].includes(t.type);
                              const isCredit = ['receive', 'credit_purchase', 'sale_return', 'credit_income', 'sale', 'income'].includes(t.type);
                              
                              const accountDetails = getTxAccountDetails(t);

                              return (
                                <TableRow key={t.id} className="group hover:bg-muted/30">
                                    <TableCell className="text-[10px]">{formatDate(date)}</TableCell>
                                    <TableCell>
                                        <div className="flex flex-col">
                                            <span className="text-xs font-semibold">{t.description}</span>
                                            <div className="flex flex-wrap gap-1 mt-1">
                                                <Badge variant="outline" className="text-[8px] h-4 uppercase">{t.type.replace('_', ' ')}</Badge>
                                                {accountDetails && <Badge variant="secondary" className="text-[8px] h-4">{accountDetails}</Badge>}
                                                {t.via && <Badge variant="outline" className="text-[8px] h-4 border-primary/20 text-primary">{t.via}</Badge>}
                                            </div>
                                        </div>
                                    </TableCell>
                                    <TableCell className="text-right text-red-600 text-[10px] font-mono">{isDebit ? formatAmount(t.amount, false) : '-'}</TableCell>
                                    <TableCell className="text-right text-green-600 text-[10px] font-mono">{isCredit ? formatAmount(t.amount, false) : '-'}</TableCell>
                                    <TableCell className="text-right font-bold text-[10px] font-mono">{formatAmount(t.runningBalance)}</TableCell>
                                    <TableCell className="text-right no-print">
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-6 w-6"><MoreVertical className="h-3 w-3" /></Button></DropdownMenuTrigger>
                                            <DropdownMenuContent align="end">
                                                {(t.type === 'sale' || t.type === 'credit_sale') && (<DropdownMenuItem onClick={() => setViewingInvoice(t)}><Eye className="mr-2 h-4 w-4"/> View Invoice</DropdownMenuItem>)}
                                                {(t.type === 'receive' || t.type === 'give') && (<DropdownMenuItem onClick={() => setViewingReceipt(t)}><Receipt className="mr-2 h-4 w-4"/> View Receipt</DropdownMenuItem>)}
                                                <DropdownMenuItem onClick={() => setEditingTransaction(t)}><Edit className="mr-2 h-4 w-4"/> Edit</DropdownMenuItem>
                                                <DropdownMenuItem className="text-destructive" onClick={() => toggleTransaction(t.id, false)}><Trash2 className="mr-2 h-4 w-4"/> Disable</DropdownMenuItem>
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    </TableCell>
                                </TableRow>
                              );
                            })}
                          </React.Fragment>
                        ))}
                      </TableBody>
                    </Table>
                </div>
            </TabsContent>

            <TabsContent value="analysis" className="m-0 text-foreground">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Card>
                        <CardHeader><CardTitle className="text-lg flex items-center gap-2"><BarChart2/> Transaction Overview</CardTitle></CardHeader>
                        <CardContent className="space-y-4">
                            <div className="flex justify-between border-b pb-2"><span>Start Date</span><span className="font-bold">{stats?.startDate ? formatDate(stats.startDate) : 'N/A'}</span></div>
                            <div className="flex justify-between border-b pb-2"><span>Total Transactions</span><span className="font-bold">{stats?.totalCount || 0}</span></div>
                            <div className="flex justify-between border-b pb-2"><span>Total Received (Cr)</span><span className="font-bold text-green-600">{formatAmount(analysis.totalReceive)}</span></div>
                            <div className="flex justify-between border-b pb-2"><span>Total Given (Dr)</span><span className="font-bold text-red-600">{formatAmount(analysis.totalGive)}</span></div>
                            <div className="flex justify-between pt-2"><span>Latest Transaction</span><span className="font-bold">{stats?.latestTx ? `${formatAmount(stats.latestTx.amount)} (${formatDate(stats.latestTx.date)})` : 'N/A'}</span></div>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardHeader><CardTitle className="text-lg flex items-center gap-2"><Package/> Product & Returns</CardTitle></CardHeader>
                        <CardContent>
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Product</TableHead>
                                        <TableHead className="text-center">Qty</TableHead>
                                        <TableHead className="text-right">Avg Price</TableHead>
                                        <TableHead className="text-right">Returns</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {stats?.productStats.map(ps => (
                                        <TableRow key={ps.id}>
                                            <TableCell className="text-xs font-medium">{ps.name}</TableCell>
                                            <TableCell className="text-center font-bold">{ps.quantity}</TableCell>
                                            <TableCell className="text-right font-mono">{formatAmount(ps.avgPrice)}</TableCell>
                                            <TableCell className="text-right text-red-600 font-bold">{ps.returns}</TableCell>
                                        </TableRow>
                                    ))}
                                    {(!stats || stats.productStats.length === 0) && <TableRow><TableCell colSpan={4} className="text-center py-4 opacity-50">No sales data found.</TableCell></TableRow>}
                                </TableBody>
                            </Table>
                        </CardContent>
                    </Card>
                </div>
            </TabsContent>

            <TabsContent value="loan" className="m-0 text-foreground">
                <Card>
                    <CardHeader className="flex-row justify-between items-center">
                        <div>
                            <CardTitle className="flex items-center gap-2"><Landmark/> Loan Management</CardTitle>
                            <CardDescription>View and manage loans for this party.</CardDescription>
                        </div>
                        <Button asChild variant="outline" size="sm"><Link href={`/parties/${partyId}/loans/new`}>+ Add Loan</Link></Button>
                    </CardHeader>
                    <CardContent>
                        {party.loans && party.loans.length > 0 ? (
                            <div className="space-y-6">
                                {party.loans.map(loan => (
                                    <Card key={loan.id} className="border-l-4 border-l-primary">
                                        <CardHeader className="p-4 flex-row justify-between">
                                            <div>
                                                <CardTitle className="text-base">Loan #{loan.loanNumber}</CardTitle>
                                                <CardDescription>{formatAmount(loan.principal)} @ {loan.interestRate}% ({loan.interestType})</CardDescription>
                                            </div>
                                            <Badge variant={loan.isActive ? 'default' : 'secondary'}>{loan.isActive ? 'Active' : 'Closed'}</Badge>
                                        </CardHeader>
                                        <CardContent className="p-4 pt-0 overflow-x-auto">
                                            <Table>
                                                <TableHeader>
                                                    <TableRow>
                                                        <TableHead>Inst.</TableHead>
                                                        <TableHead>Due Date</TableHead>
                                                        <TableHead className="text-right">Amount</TableHead>
                                                        <TableHead>Status</TableHead>
                                                        <TableHead className="text-right">Action</TableHead>
                                                    </TableRow>
                                                </TableHeader>
                                                <TableBody>
                                                    {loan.schedule.map((emi, i) => (
                                                        <TableRow key={i}>
                                                            <TableCell>{emi.installment}</TableCell>
                                                            <TableCell className="text-xs">{formatDate(emi.dueDate)}</TableCell>
                                                            <TableCell className="text-right font-mono">{formatAmount(emi.payment)}</TableCell>
                                                            <TableCell>
                                                                <Badge variant={emi.status === 'paid' ? 'default' : 'outline'} className={cn(emi.status === 'paid' && 'bg-green-100 text-green-700')}>
                                                                    {emi.status.toUpperCase()}
                                                                </Badge>
                                                            </TableCell>
                                                            <TableCell className="text-right">
                                                                {emi.status !== 'paid' && (
                                                                    <Button size="sm" onClick={() => setPayingInstallment({ loanId: loan.id, installment: emi, index: i })}>Pay</Button>
                                                                )}
                                                            </TableCell>
                                                        </TableRow>
                                                    ))}
                                                </TableBody>
                                            </Table>
                                        </CardContent>
                                    </Card>
                                ))}
                            </div>
                        ) : (
                            <div className="text-center py-12 opacity-30"><Landmark className="h-12 w-12 mx-auto mb-2"/><p>No loans found.</p></div>
                        )}
                    </CardContent>
                </Card>
            </TabsContent>
          </Tabs>
        </main>

        <footer className="fixed bottom-0 left-0 right-0 z-30 bg-background border-t p-3 shadow-[0_-4px_10px_rgba(0,0,0,0.05)] no-print">
            <div className="container mx-auto flex gap-3 max-w-4xl">
                <div className="grid grid-cols-2 gap-3 w-full">
                    <Button size="lg" className="h-12 bg-red-600 hover:bg-red-700 text-white font-bold" onClick={() => openGiveForm('give')}><ArrowUp className="mr-2 h-5 w-5" /> I Gave (৳)</Button>
                    <Button size="lg" className="h-12 bg-green-600 hover:bg-green-700 text-white font-bold" onClick={() => openReceiveForm('receive')}><ArrowDown className="mr-2 h-5 w-5" /> I Received (৳)</Button>
                </div>
            </div>
        </footer>

        {/* --- PRINT AREA --- */}
        <div id="printable-area-wrapper" className="hidden print:block">
          <div id="printable-statement-container" ref={statementPrintRef} className="w-full bg-white text-black p-0">
              <div className="p-4 min-h-screen">
                  <div className="flex justify-between items-start mb-8">
                      <div className="flex gap-4">
                          {businessProfile?.logoUrl && (<img src={businessProfile.logoUrl} alt="Logo" width="80" height="80" className="object-contain" />)}
                          <div className="space-y-1">
                              <h1 className="text-3xl font-bold text-red-600 leading-none">{businessProfile?.name || 'Rushaib Traders'}</h1>
                              <p className="text-[10px] text-gray-500 font-normal uppercase tracking-tighter">{businessProfile?.address}</p>
                              <div className="flex items-center gap-4 text-[10px] font-normal text-gray-600">
                                  <span className="flex items-center gap-1"><Phone className="h-2.5 w-2.5"/> {businessProfile?.phone}</span>
                                  <span className="flex items-center gap-1"><Mail className="h-2.5 w-2.5"/> {businessProfile?.email || 'jameurrumuz@gmail.com'}</span>
                              </div>
                          </div>
                      </div>
                      <div className="text-right">
                          <h2 className="text-3xl font-bold text-slate-800 tracking-tighter leading-none">PARTY STATEMENT</h2>
                          <p className="text-[9px] text-gray-400 mt-2 font-normal uppercase tracking-widest">Printed on: {formatFns(new Date(), 'dd/MM/yyyy | hh:mm a')}</p>
                      </div>
                  </div>
                  <Separator className="bg-slate-200 mb-6" />
                  <div className="flex justify-between items-end mb-6 bg-slate-50 p-6 rounded-3xl border border-slate-100">
                      <div className="space-y-2">
                          <p className="text-[9px] font-bold text-blue-500 uppercase tracking-widest">Statement For</p>
                          <h3 className="text-2xl font-bold text-slate-800 leading-tight">{party.name}</h3>
                          <div className="grid grid-cols-1 gap-1 text-xs">
                              <div className="flex items-center gap-2"><span className="font-normal text-slate-400 uppercase text-[9px] w-14">Mobile:</span><span className="font-bold text-slate-700">{party.phone || 'N/A'}</span></div>
                              <div className="flex items-center gap-2"><span className="font-normal text-slate-400 uppercase text-[9px] w-14">Address:</span><span className="font-normal text-slate-600">{party.address || 'N/A'}</span></div>
                          </div>
                      </div>
                      <div className="text-center space-y-1">
                          {qrCodeDataUrl && <img src={qrCodeDataUrl} alt="QR Code" className="h-24 w-24 mx-auto border-4 border-white shadow-sm rounded-xl" />}
                      </div>
                  </div>
                  <div className="w-full">
                      <Table>
                          <TableHeader>
                              <TableRow className="bg-slate-100 border-y-2 border-slate-300">
                                  <TableHead className="h-10 text-slate-800 font-bold uppercase text-[10px]">Date</TableHead>
                                  <TableHead className="h-10 text-slate-800 font-bold uppercase text-[10px]">Description</TableHead>
                                  <TableHead className="h-10 text-slate-800 font-bold uppercase text-[10px] text-right">Debit (Dr)</TableHead>
                                  <TableHead className="h-10 text-slate-800 font-bold uppercase text-[10px] text-right">Credit (Cr)</TableHead>
                                  <TableHead className="h-10 text-slate-800 font-bold uppercase text-[10px] text-right">Balance</TableHead>
                              </TableRow>
                          </TableHeader>
                          <TableBody>
                              {groupedTransactions.map(([date, txs]) => (
                                  <React.Fragment key={`print-${date}`}>
                                      {txs.map((t) => {
                                          const isDebit = ['give', 'credit_sale', 'purchase_return', 'credit_give', 'spent', 'purchase'].includes(t.type);
                                          const isCredit = ['receive', 'credit_purchase', 'sale_return', 'credit_income', 'sale', 'income'].includes(t.type);
                                          
                                          return (
                                              <TableRow key={`print-${t.id}`} className="border-b border-slate-100">
                                                  <TableCell className="py-4 text-[10px]">{formatDate(date)}</TableCell>
                                                  <TableCell className="py-4 text-xs font-bold text-slate-800">{t.description}</TableCell>
                                                  <TableCell className="py-4 text-right text-red-600 text-xs">{isDebit ? formatAmount(t.amount, false) : '-'}</TableCell>
                                                  <TableCell className="py-4 text-right text-green-600 text-xs">{isCredit ? formatAmount(t.amount, false) : '-'}</TableCell>
                                                  <TableCell className="py-4 text-right font-bold text-slate-900 text-xs">{formatAmount(t.runningBalance, false)}</TableCell>
                                              </TableRow>
                                          );
                                      })}
                                  </React.Fragment>
                              ))}
                          </TableBody>
                          <TableFooter>
                              <TableRow className="border-t-4 border-slate-800 bg-slate-50">
                                  <TableCell colSpan={4} className="py-6 text-right text-base font-bold text-slate-800 uppercase">Net Closing Balance</TableCell>
                                  <TableCell className="py-6 text-right text-xl font-bold text-red-600">৳{formatAmount(finalBalanceInTable, false)}</TableCell>
                              </TableRow>
                          </TableFooter>
                      </Table>
                  </div>
              </div>
          </div>
        </div>
        
        {payingInstallment && (
            <Dialog open={!!payingInstallment} onOpenChange={(o) => !o && setPayingInstallment(null)}>
                <DialogContent>
                    <DialogHeader><DialogTitle>Pay Installment #{payingInstallment.installment.installment}</DialogTitle></DialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="grid grid-cols-2 gap-4">
                             <div><Label>Amount</Label><Input value={formatAmount(payingInstallment.installment.payment)} readOnly className="bg-muted"/></div>
                             <div><Label>Account</Label>
                                <Select onValueChange={(v) => setPayingInstallment(p => p ? ({...p, accountId: v}) : null)}>
                                    <SelectTrigger><SelectValue placeholder="Select Account"/></SelectTrigger>
                                    <SelectContent>{accounts.map(acc => <SelectItem key={acc.id} value={acc.id}>{acc.name}</SelectItem>)}</SelectContent>
                                </Select>
                             </div>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="ghost" onClick={() => setPayingInstallment(null)}>Cancel</Button>
                        <Button onClick={() => handleMarkEmiAsPaid(payingInstallment.loanId, payingInstallment.index, { 
                            paymentDate: new Date().toISOString().split('T')[0],
                            accountId: (payingInstallment as any).accountId,
                            principal: payingInstallment.installment.principal,
                            interest: payingInstallment.installment.interest,
                            installment: payingInstallment.installment.installment,
                            loanNumber: party.loans?.find(l => l.id === payingInstallment.loanId)?.loanNumber
                        })}>Confirm Payment</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        )}
    </div>
  );
}

export default function PartyLedgerPageWrapper(props: { params: Promise<{ partyId: string }> }) {
  return (
    <Suspense fallback={<div className="flex justify-center items-center h-screen"><Loader2 className="animate-spin h-12 w-12 text-primary" /></div>}>
      <PartyLedgerPage {...props} />
    </Suspense>
  );
}
