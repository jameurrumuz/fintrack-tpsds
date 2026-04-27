'use client';

import React, { Suspense, useEffect, useMemo, useState, use, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { getDoc, doc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Transaction, Party, Account, AppSettings, TransactionVia, SheetRow } from '@/types';
import { subscribeToAccounts } from '@/services/accountService';
import { subscribeToTransactionsForParty, addTransaction, updateTransaction, toggleTransaction } from '@/services/transactionService';
import { getAppSettings } from '@/services/settingsService';
import { fetchSheetData } from '@/services/smsSyncService';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { formatAmount, formatDate, getPartyBalanceEffect, cn, cleanUndefined } from '@/lib/utils';
import { Loader2, ArrowLeft, Printer, Banknote, ArrowDown, ArrowUp, Trash2, Edit, MoreVertical, Plus, ShoppingCart, Wallet, Receipt, HandCoins, ArrowDownToLine, Share2, Landmark, FileText, History, Search, Save, X, ChevronLeft, ChevronRight, FileUp, Check, Phone, Mail, Eye } from 'lucide-react';
import Link from 'next/link';
import Image from 'next/image';
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
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Checkbox } from '@/components/ui/checkbox';
import QRCode from 'qrcode';

const partyTransactionSchema = z.object({
  date: z.date(),
  description: z.string().min(1, 'Description is required'),
  amount: z.coerce.number().positive('Amount must be positive'),
  accountId: z.string().optional(),
  type: z.enum(['receive', 'give', 'credit_sale', 'purchase', 'spent', 'income', 'credit_purchase', 'sale', 'credit_give', 'credit_income']),
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
  const printAreaRef = useRef<HTMLDivElement>(null);

  const [party, setParty] = useState<Party | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ 
    dateFrom: '', 
    dateTo: '', 
    via: 'all',
    nature: 'all' as 'all' | 'inc' | 'exp'
  });
  const [showAllTransactions, setShowAllTransactions] = useState(false);
  const [showIncomeExpenseInPrint, setShowIncomeExpenseInPrint] = useState(false);
  const [isDateFilterEnabled, setIsDateFilterEnabled] = useState(false);
  const [activeTab, setActiveTab] = useState("transactions");
  
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [formType, setFormType] = useState<'give' | 'receive' | 'spent' | 'credit_give' | 'credit_income'>('give');
  const [isReceiveOptionsOpen, setIsReceiveOptionsOpen] = useState(false);
  const [isGiveOptionsOpen, setIsGiveOptionsOpen] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
  const [viewingReceipt, setViewingReceipt] = useState<Transaction | null>(null);
  const [viewingInvoice, setViewingInvoice] = useState<Transaction | null>(null);
  
  const [isSmsDialogOpen, setIsSmsDialogOpen] = useState(false);
  const [smsData, setSmsData] = useState<SheetRow[]>([]);
  const [smsLoading, setSmsLoading] = useState(false);
  const [sendSms, setSendSms] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState('');

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
    if (!loading && transactions.length > 0) {
      const enabledTxs = transactions.filter(t => t.enabled).sort((a,b) => b.date.localeCompare(a.date));
      if (enabledTxs.length > 0) {
        const today = new Date();
        const todayStr = formatFns(today, 'yyyy-MM-dd');
        const sevenDaysAgo = formatFns(subDays(today, 7), 'yyyy-MM-dd');
        
        const hasTxsInLast7Days = enabledTxs.some(t => t.date >= sevenDaysAgo && t.date <= todayStr);
        
        if (hasTxsInLast7Days) {
          setFilters(prev => ({ ...prev, dateFrom: sevenDaysAgo, dateTo: todayStr }));
        } else {
          const latestDateStr = enabledTxs[0].date;
          const latestDate = parseISO(latestDateStr);
          const sevenDaysBeforeLatest = formatFns(subDays(latestDate, 7), 'yyyy-MM-dd');
          setFilters(prev => ({ ...prev, dateFrom: sevenDaysBeforeLatest, dateTo: latestDateStr }));
        }
        setIsDateFilterEnabled(true);
      }
    }
  }, [loading, transactions.length]);

  const { groupedTransactions, currentBalance, openingBalance, finalBalanceInTable } = useMemo(() => {
    const enabledTxs = transactions.filter(t => t.enabled);
    
    const sortedTimeline = [...enabledTxs].sort((a, b) => {
        const dateA = new Date(a.date).getTime();
        const dateB = new Date(b.date).getTime();
        if (dateA !== dateB) return dateA - dateB;
        const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return timeA - timeB;
    });
    
    let running = 0;
    const withRunning = sortedTimeline.map(t => {
        running += getPartyBalanceEffect(t);
        return { ...t, runningBalance: running };
    });

    const opening = (isDateFilterEnabled && !showAllTransactions) ? withRunning
        .filter(t => t.date < filters.dateFrom)
        .pop()?.runningBalance || 0 : 0;

    let filtered = withRunning.filter(t => {
        if (filters.via !== 'all' && t.via !== filters.via) return false;
        
        const effect = getPartyBalanceEffect(t);
        if (filters.nature === 'inc' && effect <= 0) return false;
        if (filters.nature === 'exp' && effect >= 0) return false;

        if (showAllTransactions) return true;
        if (!isDateFilterEnabled) return true;
        return t.date >= filters.dateFrom && t.date <= filters.dateTo;
    });

    // Sort by date ASC (Oldest first) as per RULES.md
    const grouped: { [key: string]: any[] } = {};
    filtered.forEach(t => { if(!grouped[t.date]) grouped[t.date] = []; grouped[t.date].push(t); });
    
    const groupedArray = Object.entries(grouped).sort(([dateA], [dateB]) => new Date(dateA).getTime() - new Date(dateB).getTime());

    return { 
        groupedTransactions: groupedArray, 
        currentBalance: running, 
        openingBalance: opening, 
        finalBalanceInTable: running
    };
  }, [transactions, filters, isDateFilterEnabled, showAllTransactions]);

  const businessProfile = useMemo(() => {
      return appSettings?.businessProfiles.find(p => p.name === party?.group) || appSettings?.businessProfiles[0];
  }, [appSettings, party]);

  useEffect(() => {
    if (party && businessProfile) {
        const qrText = `Party: ${party.name}\nBalance: ${formatAmount(currentBalance)}\nFrom: ${businessProfile.name}`;
        QRCode.toDataURL(qrText, { width: 100, margin: 1, errorCorrectionLevel: 'H' }, (err, url) => {
            if (err) return;
            setQrCodeDataUrl(url);
        });
    }
  }, [party, businessProfile, currentBalance]);

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
        toast({ variant: 'destructive', title: "Error", description: error.message });
    } finally {
        setIsSaving(false);
    }
  };

  const handleUpdateTransaction = async (data: Omit<Transaction, 'id' | 'enabled'>) => {
    if (!editingTransaction) return;
    try {
      await updateTransaction(editingTransaction.id, data);
      toast({ title: "Success" });
      setEditingTransaction(null);
    } catch (error: any) { toast({ variant: 'destructive', title: "Error", description: error.message }); }
  };

  const handleDeleteTransaction = async (txId: string) => {
    try {
        await toggleTransaction(txId, false);
        toast({ title: "Disabled" });
    } catch (error: any) { toast({ variant: 'destructive', title: "Error", description: error.message }); }
  };

  const handleSmsSearch = async () => {
      setSmsLoading(true);
      setIsSmsDialogOpen(true);
      try {
          const data = await fetchSheetData();
          setSmsData(data);
      } catch (e: any) {
          toast({ variant: 'destructive', title: 'SMS Fetch Failed', description: e.message });
      } finally {
          setSmsLoading(false);
      }
  };

  const handleSelectSms = (sms: SheetRow) => {
      const amountRegex = /((?:tk|taka|bdt|rs|৳)\.?\s*([\d,]+\.?\d*)|([\d,]+\.?\d*)\s*(?:tk|taka|bdt|rs|৳))/i;
      const match = sms.message.match(amountRegex);
      if (match) {
          const amountStr = (match[2] || match[3]).replace(/,/g, '');
          transactionForm.setValue('amount', parseFloat(amountStr));
      }
      transactionForm.setValue('description', sms.message);
      setIsSmsDialogOpen(false);
  };

  const openReceiveForm = (type: 'receive' | 'credit_income' | 'advance') => {
      if (type === 'advance') {
          setIsReceiveOptionsOpen(false);
          router.push(`/transactions/receive?partyId=${party?.id}&partyName=${encodeURIComponent(party?.name || '')}`);
          return;
      }
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

  const getAccountName = (accountId?: string) => accounts.find(a => a.id === accountId)?.name || '';

  if (loading || !party) return <div className="flex justify-center items-center h-screen"><Loader2 className="animate-spin h-12 w-12 text-primary" /></div>;

  return (
    <div className="flex flex-col bg-gray-50 dark:bg-gray-900 min-h-screen pb-24">
        <PartyTransactionEditDialog transaction={editingTransaction} onOpenChange={(open) => !open && setEditingTransaction(null)} onSave={handleUpdateTransaction} parties={[party]} accounts={accounts} inventoryItems={[]} appSettings={appSettings} />
        <PaymentReceiptDialog isOpen={!!viewingReceipt} onOpenChange={(open) => !open && setViewingReceipt(null)} transaction={viewingReceipt} party={party} appSettings={appSettings} accounts={accounts} allTransactions={transactions} />
        <InvoiceDialog isOpen={!!viewingInvoice} onOpenChange={(open) => !open && setViewingInvoice(null)} invoice={viewingInvoice} party={party} parties={[party]} appSettings={appSettings} onPrint={() => window.print()} accounts={accounts} allTransactions={transactions} />

        <Dialog open={isSmsDialogOpen} onOpenChange={setIsSmsDialogOpen}>
            <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
                <DialogHeader><DialogTitle>Search SMS for Quick Entry</DialogTitle></DialogHeader>
                <div className="flex-grow overflow-y-auto p-2">
                    {smsLoading ? <div className="flex justify-center p-8"><Loader2 className="animate-spin" /></div> : (
                        <Table>
                            <TableBody>
                                {smsData.map((sms, i) => (
                                    <TableRow key={i} className="cursor-pointer hover:bg-muted" onClick={() => handleSelectSms(sms)}>
                                        <TableCell className="text-xs">
                                            <p className="font-bold">{sms.name}</p>
                                            <p>{sms.message}</p>
                                            <p className="text-[10px] text-muted-foreground">{sms.date}</p>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                </div>
            </DialogContent>
        </Dialog>

        <Dialog open={isReceiveOptionsOpen} onOpenChange={setIsReceiveOptionsOpen}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Select "Receive" Type</DialogTitle>
                    <DialogDescription>Choose how you received the money or goods.</DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <Button variant="outline" className="h-16 flex items-center justify-start gap-4 px-6" onClick={() => openReceiveForm('receive')}>
                        <div className="p-2 rounded-full bg-green-100 text-green-600"><Wallet className="h-6 w-6"/></div>
                        <div className="text-left"><p className="font-bold text-sm">Receive Payment</p><p className="text-[10px] text-muted-foreground">Cash/Bank entry for existing due</p></div>
                    </Button>
                    <Button variant="outline" className="h-16 flex items-center justify-start gap-4 px-6" onClick={() => openReceiveForm('credit_income')}>
                        <div className="p-2 rounded-full bg-purple-100 text-purple-600"><HandCoins className="h-6 w-6"/></div>
                        <div className="text-left"><p className="font-bold text-sm">Credit Income (Due)</p><p className="text-[10px] text-muted-foreground">Record income without cash entry</p></div>
                    </Button>
                    <Button variant="outline" className="h-16 flex items-center justify-start gap-4 px-6" onClick={() => openReceiveForm('advance')}>
                        <div className="p-2 rounded-full bg-blue-100 text-blue-600"><ArrowDownToLine className="h-6 w-6"/></div>
                        <div className="text-left"><p className="font-bold text-sm">Advance Receive</p><p className="text-[10px] text-muted-foreground">Pre-payment for future business</p></div>
                    </Button>
                </div>
            </DialogContent>
        </Dialog>

        <Dialog open={isGiveOptionsOpen} onOpenChange={setIsGiveOptionsOpen}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Select "Give" Type</DialogTitle>
                    <DialogDescription>Choose the type of payment or due record.</DialogDescription>
                </DialogHeader>
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
                <DialogHeader>
                    <DialogTitle>Record {formType === 'give' ? 'Payment Given' : 'Payment Received'}</DialogTitle>
                </DialogHeader>
                <form onSubmit={transactionForm.handleSubmit(handleAddTransaction)} className="space-y-4 py-2">
                    <div className="flex justify-end">
                        <Button type="button" variant="outline" size="sm" onClick={handleSmsSearch}>
                            <Search className="h-4 w-4 mr-2"/> Search SMS
                        </Button>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                            <Label>Amount</Label>
                            <Input type="number" step="0.01" {...transactionForm.register('amount')} autoFocus />
                        </div>
                        <div className="space-y-1">
                            <Label>Date</Label>
                            <Controller control={transactionForm.control} name="date" render={({ field }) => (<DatePicker value={field.value} onChange={(d) => field.onChange(d as Date)} />)} />
                        </div>
                    </div>
                    <div className="space-y-1">
                        <Label>Description</Label>
                        <Input {...transactionForm.register('description')} placeholder="Reason for transaction" />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        {!['credit_give', 'credit_income'].includes(transactionForm.watch('type')) && (
                            <div className="space-y-1">
                                <Label>Account</Label>
                                <Controller name="accountId" control={transactionForm.control} render={({ field }) => (
                                    <Select onValueChange={field.onChange} value={field.value}>
                                        <SelectTrigger><SelectValue placeholder="Account..." /></SelectTrigger>
                                        <SelectContent>
                                            {accounts.map(acc => <SelectItem key={acc.id} value={acc.id}>{acc.name} ({formatAmount(acc.balance)})</SelectItem>)}
                                        </SelectContent>
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
                    
                    <Separator />
                    
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                            <Label>Charge</Label>
                            <Input type="number" step="0.01" {...transactionForm.register('charge')} placeholder="0.00" />
                        </div>
                        <div className="space-y-1">
                            <Label>Charge Via</Label>
                             <Controller name="chargeVia" control={transactionForm.control} render={({ field }) => (
                                <Select onValueChange={field.onChange} value={field.value}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        {appSettings?.businessProfiles.map(p => <SelectItem key={p.name} value={p.name}>{p.name}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            )} />
                        </div>
                    </div>

                    <div className="flex items-center space-x-2 py-2">
                        <Switch id="send-sms-ledger" checked={sendSms} onCheckedChange={setSendSms} />
                        <Label htmlFor="send-sms-ledger">Send SMS</Label>
                    </div>

                    <DialogFooter className="gap-2">
                        <DialogClose asChild><Button type="button" variant="ghost">Cancel</Button></DialogClose>
                        <Button type="submit" disabled={isSaving}>
                            {isSaving ? <Loader2 className="animate-spin mr-2 h-4 w-4"/> : <Save className="mr-2 h-4 w-4"/>}
                            Save
                        </Button>
                    </DialogFooter>
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
                            
                            <div className="flex justify-center gap-4 mt-4 pt-3 border-t border-gray-200 dark:border-gray-700">
                                <button onClick={() => setActiveTab('loan')} className="flex flex-col items-center gap-1 group">
                                    <div className="p-2 rounded-full bg-purple-100 text-purple-600 group-hover:bg-purple-200 transition-colors"><Landmark className="h-4 w-4"/></div>
                                    <span className="text-[10px] font-bold text-gray-500 uppercase">LOAN</span>
                                </button>
                                <button onClick={() => setActiveTab('old_ledger')} className="flex flex-col items-center gap-1 group">
                                    <div className="p-2 rounded-full bg-blue-100 text-blue-600 group-hover:bg-blue-200 transition-colors"><History className="h-4 w-4"/></div>
                                    <span className="text-[10px] font-bold text-gray-500 uppercase">OLD</span>
                                </button>
                                <button onClick={() => setActiveTab('party-details')} className="flex flex-col items-center gap-1 group">
                                    <div className="p-2 rounded-full bg-orange-100 text-orange-600 group-hover:bg-orange-200 transition-colors"><FileText className="h-4 w-4"/></div>
                                    <span className="text-[10px] font-bold text-gray-500 uppercase">EXP</span>
                                </button>
                                <Link href={`/pos?partyId=${partyId}`} className="flex flex-col items-center gap-1 group">
                                    <div className="p-2 rounded-full bg-green-100 text-green-600 group-hover:bg-green-200 transition-colors"><ShoppingCart className="h-4 w-4"/></div>
                                    <span className="text-[10px] font-bold text-gray-500 uppercase">POS</span>
                                </Link>
                                <button onClick={() => window.print()} className="flex flex-col items-center gap-1 group">
                                    <div className="p-2 rounded-full bg-gray-100 text-gray-600 group-hover:bg-gray-200 transition-colors"><Printer className="h-4 w-4"/></div>
                                    <span className="text-[10px] font-bold text-gray-500 uppercase">PRINT</span>
                                </button>
                                <button onClick={() => toast({ title: "Sharing not implemented" })} className="flex flex-col items-center gap-1 group">
                                    <div className="p-2 rounded-full bg-teal-100 text-teal-600 group-hover:bg-teal-200 transition-colors"><Share2 className="h-4 w-4"/></div>
                                    <span className="text-[10px] font-bold text-gray-500 uppercase">SHARE</span>
                                </button>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </header>

        <main className="container mx-auto p-3 flex-1 overflow-auto">
            <div className="flex flex-col gap-3 bg-background p-3 rounded-lg border shadow-sm no-print mb-4">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-2 items-end">
                    <div className="md:col-span-2 flex items-center gap-2">
                        <div className="flex-1 space-y-1">
                            <Label className="text-[10px] font-bold uppercase text-muted-foreground">Start Date</Label>
                            <Input type="date" value={filters.dateFrom} onChange={e => setFilters({...filters, dateFrom: e.target.value})} className="h-9 text-xs" disabled={showAllTransactions}/>
                        </div>
                        <span className="mt-6 text-muted-foreground">-</span>
                        <div className="flex-1 space-y-1">
                            <Label className="text-[10px] font-bold uppercase text-muted-foreground">End Date</Label>
                            <Input type="date" value={filters.dateTo} onChange={e => setFilters({...filters, dateTo: e.target.value})} className="h-9 text-xs" disabled={showAllTransactions}/>
                        </div>
                    </div>
                    <div className="space-y-1">
                        <Label className="text-[10px] font-bold uppercase text-muted-foreground">Business Profile</Label>
                        <Select value={filters.via} onValueChange={v => setFilters({...filters, via: v})}>
                            <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="All Profiles" /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Profiles</SelectItem>
                                {appSettings?.businessProfiles.map(p => <SelectItem key={p.name} value={p.name}>{p.name}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-1">
                        <Label className="text-[10px] font-bold uppercase text-muted-foreground">Nature</Label>
                        <Select value={filters.nature} onValueChange={v => setFilters({...filters, nature: v as any})}>
                            <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Transactions</SelectItem>
                                <SelectItem value="inc">INC (Credits)</SelectItem>
                                <SelectItem value="exp">EXP (Debits)</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </div>
                <div className="flex items-center justify-between gap-4 border-t pt-2">
                    <div className="flex items-center gap-2">
                        <Switch id="all-tx-switch" checked={showAllTransactions} onCheckedChange={setShowAllTransactions} />
                        <Label htmlFor="all-tx-switch" className="text-xs font-bold uppercase cursor-pointer">All Transactions</Label>
                    </div>
                    <div className="flex items-center gap-2">
                        <Checkbox id="print-inc-exp" checked={showIncomeExpenseInPrint} onCheckedChange={c => setShowIncomeExpenseInPrint(!!c)} />
                        <Label htmlFor="print-inc-exp" className="text-xs font-bold uppercase cursor-pointer">Income/Expense In Print</Label>
                    </div>
                </div>
            </div>

          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="hidden">
                <TabsTrigger value="transactions">Transactions</TabsTrigger>
                <TabsTrigger value="party-details">Analysis</TabsTrigger>
                <TabsTrigger value="loan">Loans</TabsTrigger>
                <TabsTrigger value="old_ledger">Old Data</TabsTrigger>
            </TabsList>
            
            <TabsContent value="transactions" className="space-y-3">
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
                         {isDateFilterEnabled && !showAllTransactions && (
                            <TableRow className="bg-slate-50 italic">
                                <TableCell colSpan={4} className="text-right font-medium text-xs">Opening Balance</TableCell>
                                <TableCell className="text-right font-bold text-xs">{formatAmount(openingBalance)}</TableCell>
                                <TableCell className="no-print"></TableCell>
                            </TableRow>
                        )}
                        {groupedTransactions.map(([date, txs]) => (
                          <React.Fragment key={date}>
                            <TableRow className="bg-primary/5 hover:bg-primary/10">
                              <TableCell colSpan={6} className="py-1 px-3 font-bold text-[10px] text-primary">{formatDate(date)}</TableCell>
                            </TableRow>
                            {txs.map((t) => {
                              const effect = getPartyBalanceEffect(t);
                              const isInternal = effect === 0;
                              
                              const printHiddenClass = isInternal && !showIncomeExpenseInPrint ? 'print:hidden' : '';

                              const isCredit = ['receive', 'credit_purchase', 'sale_return', 'credit_income', 'income', 'sale', 'purchase_return'].includes(t.type) || effect > 0;
                              const isDebit = ['give', 'credit_sale', 'purchase', 'spent', 'credit_give', 'purchase_return'].includes(t.type) || effect < 0;

                              return (
                                <TableRow key={t.id} className={cn("group hover:bg-muted/30", printHiddenClass)}>
                                    <TableCell className="text-[10px]">{formatDate(date)}</TableCell>
                                    <TableCell>
                                        <div className="flex flex-col">
                                            <span className="text-xs font-semibold">{t.description}</span>
                                            <div className="flex flex-wrap gap-1 mt-1">
                                                <Badge variant="outline" className="text-[8px] h-4 uppercase">{t.type.replace('_', ' ')}</Badge>
                                                {t.accountId && <Badge variant="secondary" className="text-[8px] h-4">{getAccountName(t.accountId)}</Badge>}
                                                {t.payments && t.payments.map((p, pIdx) => (
                                                    <Badge key={pIdx} variant="secondary" className="text-[8px] h-4">
                                                        {getAccountName(p.accountId)} {p.amount > 0 && `(${formatAmount(p.amount, false)})`}
                                                    </Badge>
                                                ))}
                                                {t.via && <Badge variant="outline" className="text-[8px] h-4 border-primary/20 text-primary">{t.via}</Badge>}
                                            </div>
                                        </div>
                                    </TableCell>
                                    <TableCell className="text-right text-red-600 text-[10px] font-mono">{isDebit ? formatAmount(t.amount) : '-'}</TableCell>
                                    <TableCell className="text-right text-green-600 text-[10px] font-mono">{isCredit ? formatAmount(t.amount) : '-'}</TableCell>
                                    <TableCell className="text-right font-bold text-[10px] font-mono">{formatAmount(t.runningBalance)}</TableCell>
                                    <TableCell className="text-right no-print">
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                                <Button variant="ghost" size="icon" className="h-6 w-6"><MoreVertical className="h-3 w-3" /></Button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent align="end">
                                                {(t.type === 'sale' || t.type === 'credit_sale') && (
                                                    <DropdownMenuItem onClick={() => setViewingInvoice(t)}><Eye className="mr-2 h-4 w-4"/> View Invoice</DropdownMenuItem>
                                                )}
                                                {(t.type === 'receive' || t.type === 'give') && (
                                                    <DropdownMenuItem onClick={() => setViewingReceipt(t)}><Receipt className="mr-2 h-4 w-4"/> View Receipt</DropdownMenuItem>
                                                )}
                                                <DropdownMenuItem onClick={() => setEditingTransaction(t)}><Edit className="mr-2 h-4 w-4"/> Edit</DropdownMenuItem>
                                                <DropdownMenuItem className="text-destructive" onClick={() => handleDeleteTransaction(t.id)}><Trash2 className="mr-2 h-4 w-4"/> Disable</DropdownMenuItem>
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    </TableCell>
                                </TableRow>
                              );
                            })}
                          </React.Fragment>
                        ))}
                      </TableBody>
                      <TableFooter>
                        <TableRow>
                          <TableCell colSpan={4} className="text-right font-bold text-xs uppercase">Closing Balance</TableCell>
                          <TableCell className="text-right font-bold text-xs font-mono">{formatAmount(finalBalanceInTable)}</TableCell>
                          <TableCell className="no-print"></TableCell>
                        </TableRow>
                      </TableFooter>
                    </Table>
                </div>
            </TabsContent>

            <TabsContent value="party-details">
                <Card>
                    <CardHeader><CardTitle>Party Analysis</CardTitle></CardHeader>
                    <CardContent>
                        <p className="text-muted-foreground text-center py-12">Analysis data coming soon...</p>
                    </CardContent>
                </Card>
            </TabsContent>

            <TabsContent value="loan">
                 <Card>
                    <CardHeader><CardTitle>Loan Management</CardTitle></CardHeader>
                    <CardContent>
                        <p className="text-muted-foreground text-center py-12">Loan tracking for this party coming soon...</p>
                    </CardContent>
                </Card>
            </TabsContent>

            <TabsContent value="old_ledger">
                 <Card>
                    <CardHeader className="flex-row items-center justify-between">
                        <CardTitle>Old Ledger Data</CardTitle>
                        <Button variant="outline" size="sm" asChild>
                            <Link href={`/old-data?partyId=${partyId}`}><FileUp className="mr-2 h-4 w-4"/> Import PDF</Link>
                        </Button>
                    </CardHeader>
                    <CardContent>
                        <p className="text-muted-foreground text-center py-12">Imported historical data will be listed here.</p>
                    </CardContent>
                </Card>
            </TabsContent>
          </Tabs>
        </main>

        <footer className="fixed bottom-0 left-0 right-0 z-30 bg-background border-t p-3 shadow-[0_-4px_10px_rgba(0,0,0,0.05)] no-print">
            <div className="container mx-auto flex gap-3 max-w-4xl">
                <div className="grid grid-cols-2 gap-3 w-full">
                    <Button 
                        size="lg" 
                        className="h-12 bg-red-600 hover:bg-red-700 text-white font-bold shadow-sm"
                        onClick={() => setIsGiveOptionsOpen(true)}
                    >
                        <ArrowUp className="mr-2 h-5 w-5" /> I Gave (৳)
                    </Button>
                    <Button 
                        size="lg" 
                        className="h-12 bg-green-600 hover:bg-green-700 text-white font-bold shadow-sm"
                        onClick={() => setIsReceiveOptionsOpen(true)}
                    >
                        <ArrowDown className="mr-2 h-5 w-5" /> I Received (৳)
                    </Button>
                </div>
            </div>
        </footer>

        <div ref={printAreaRef} className="hidden print:block w-full bg-white text-black p-0">
             <style>{`
                @media print {
                  @page { size: A4; margin: 1cm; }
                  body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                }
            `}</style>
            
            <div className="flex justify-between items-start mb-8">
                <div className="flex gap-4">
                     {businessProfile?.logoUrl && (
                        <div className="relative h-16 w-16">
                            <Image src={businessProfile.logoUrl} alt="Logo" width={64} height={64} className="object-contain" />
                        </div>
                     )}
                     <div>
                        <h1 className="text-2xl font-bold text-red-600">{businessProfile?.name || 'Rushaib Traders'}</h1>
                        <p className="text-xs text-gray-500 max-w-[300px] leading-tight">{businessProfile?.address}</p>
                        <p className="text-xs text-gray-500">{businessProfile?.phone}</p>
                        <p className="text-xs text-gray-500">{businessProfile?.email || 'jameurrumuz@gmail.com'}</p>
                     </div>
                </div>
                <div className="text-right">
                    <h2 className="text-2xl font-black text-slate-800 tracking-tighter">PARTY STATEMENT</h2>
                    <p className="text-[10px] text-gray-400 mt-1 uppercase">Generated on: {formatFns(new Date(), 'dd/MM/yyyy hh:mm a')}</p>
                </div>
            </div>

            <Separator className="bg-slate-200 mb-8" />

            <div className="flex justify-between items-end mb-8 bg-slate-50/50 p-6 rounded-3xl border border-slate-100">
                <div className="space-y-1.5">
                    <h3 className="text-2xl font-black text-slate-800 mb-2">{party.name}</h3>
                    <div className="flex items-center gap-2 text-sm">
                        <span className="font-bold text-slate-500 uppercase text-[10px] w-16">Phone:</span>
                        <span className="font-medium text-slate-700">{party.phone || 'N/A'}</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                        <span className="font-bold text-slate-500 uppercase text-[10px] w-16">Address:</span>
                        <span className="font-medium text-slate-700">{party.address || 'N/A'}</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                        <span className="font-bold text-slate-500 uppercase text-[10px] w-16">Group:</span>
                        <span className="font-medium text-slate-700">{party.group || 'Personal'}</span>
                    </div>
                </div>
                <div className="text-center space-y-1">
                    {qrCodeDataUrl && <img src={qrCodeDataUrl} alt="QR Code" className="h-20 w-20 mx-auto" />}
                    <p className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">Scan for details</p>
                </div>
            </div>

            <Table className="border-collapse">
                <TableHeader>
                    <TableRow className="bg-slate-50 border-y border-slate-200">
                        <TableHead className="h-10 text-slate-800 font-bold">Date</TableHead>
                        <TableHead className="h-10 text-slate-800 font-bold">Description</TableHead>
                        <TableHead className="h-10 text-slate-800 font-bold text-right">Debit (Dr)</TableHead>
                        <TableHead className="h-10 text-slate-800 font-bold text-right">Credit (Cr)</TableHead>
                        <TableHead className="h-10 text-slate-800 font-bold text-right">Balance</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                     {isDateFilterEnabled && !showAllTransactions && (
                        <TableRow className="border-b border-slate-100 italic bg-slate-50/30">
                            <TableCell colSpan={4} className="text-right py-3 font-bold text-slate-600">Opening Balance</TableCell>
                            <TableCell className="text-right py-3 font-black text-slate-700">{formatAmount(openingBalance)}</TableCell>
                        </TableRow>
                    )}
                    {groupedTransactions.map(([date, txs]) => (
                        <React.Fragment key={`print-${date}`}>
                            {txs.map((t) => {
                                const effect = getPartyBalanceEffect(t);
                                const isInternal = effect === 0;
                                if (isInternal && !showIncomeExpenseInPrint) return null;

                                const isCredit = ['receive', 'credit_purchase', 'sale_return', 'credit_income', 'income', 'sale', 'purchase_return'].includes(t.type) || effect > 0;
                                const isDebit = ['give', 'credit_sale', 'purchase', 'spent', 'credit_give', 'purchase_return'].includes(t.type) || effect < 0;

                                return (
                                    <TableRow key={`print-${t.id}`} className="border-b border-slate-100">
                                        <TableCell className="py-4 text-xs text-slate-600">{formatDate(date)}</TableCell>
                                        <TableCell className="py-4">
                                            <div className="flex flex-col gap-0.5">
                                                <span className="font-bold text-slate-800 text-sm">{t.description}</span>
                                                <span className="text-[10px] text-slate-400 font-medium uppercase tracking-tighter">
                                                    {t.type.replace('_', ' ')} | {getAccountName(t.accountId)} | via {t.via || 'Personal'}
                                                </span>
                                            </div>
                                        </TableCell>
                                        <TableCell className="py-4 text-right font-medium text-slate-700">{isDebit ? `৳${formatAmount(t.amount, false)}` : '-'}</TableCell>
                                        <TableCell className="py-4 text-right font-medium text-slate-700">{isCredit ? `৳${formatAmount(t.amount, false)}` : '-'}</TableCell>
                                        <TableCell className="py-4 text-right font-black text-slate-900">৳{formatAmount(t.runningBalance, false)}</TableCell>
                                    </TableRow>
                                );
                            })}
                        </React.Fragment>
                    ))}
                </TableBody>
                <TableFooter>
                    <TableRow className="border-t-2 border-slate-200">
                        <TableCell colSpan={4} className="py-6 text-right text-lg font-black text-slate-800 uppercase tracking-tighter">Closing Balance</TableCell>
                        <TableCell className="py-6 text-right text-xl font-black text-red-600">৳{formatAmount(finalBalanceInTable, false)}</TableCell>
                    </TableRow>
                </TableFooter>
            </Table>
            
            <div className="mt-16 flex justify-end">
                <div className="text-center w-48">
                    <div className="border-t border-black pt-2">
                        <p className="font-bold text-xs uppercase tracking-widest">Authorized Signature</p>
                    </div>
                </div>
            </div>
        </div>
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
