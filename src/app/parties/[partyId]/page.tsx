
'use client';

import React, { Suspense, useEffect, useMemo, useState, use } from 'react';
import { useRouter } from 'next/navigation';
import { getDoc, doc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Transaction, Party, Account, AppSettings } from '@/types';
import { subscribeToAccounts } from '@/services/accountService';
import { subscribeToTransactionsForParty, addTransaction as addTxService, updateTransaction, toggleTransaction } from '@/services/transactionService';
import { getAppSettings } from '@/services/settingsService';
import { subscribeToParties } from '@/services/partyService';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { formatAmount, formatDate, getPartyBalanceEffect, cn, cleanUndefined } from '@/lib/utils';
import { 
  Loader2, ArrowLeft, Printer, Banknote, ArrowDown, ArrowUp, Trash2, Edit, 
  MoreVertical, Plus, ShoppingCart, Wallet, Receipt, HandCoins, 
  Share2, Landmark, FileText, History, Search, Save, X, ChevronDown, ChevronUp, 
  Repeat, Check, ChevronsUpDown, MinusCircle, BarChart2, Package, TrendingUp
} from 'lucide-react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { DatePicker } from '@/components/ui/date-picker';
import { format as formatFns, parseISO, isValid } from 'date-fns';
import PartyTransactionEditDialog from '@/components/PartyTransactionEditDialog';
import PaymentReceiptDialog from '@/components/PaymentReceiptDialog';
import InvoiceDialog from '@/components/pos/InvoiceDialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { fetchSheetData } from '@/services/smsSyncService';
import type { SheetRow } from '@/types';
import { motion } from 'framer-motion';

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
    const isCreditType = ['credit_sale', 'credit_purchase', 'credit_give', 'credit_income'].includes(data.type);
    if (!isCreditType && !data.accountId) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Account is required for this transaction type.',
            path: ['accountId'],
        });
    }
});

type FormValues = z.infer<typeof partyTransactionSchema>;

const PartySearchSwitcher = ({ parties, currentPartyId }: { parties: Party[], currentPartyId: string }) => {
    const router = useRouter();
    const [open, setOpen] = useState(false);
    const selectedParty = parties.find(p => p.id === currentPartyId);

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={open}
                    className="w-full justify-between h-10 border-0 bg-transparent hover:bg-muted/50 p-0 px-2"
                >
                    <div className="flex flex-col items-start text-left overflow-hidden">
                        <span className="text-sm font-bold truncate w-full">{selectedParty?.name || 'Select Party...'}</span>
                        <span className="text-[10px] text-muted-foreground">{selectedParty?.phone || 'No Phone'}</span>
                    </div>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[320px] p-0" align="start">
                <Command>
                    <CommandInput placeholder="Search party..." />
                    <CommandList>
                        <CommandEmpty>No party found.</CommandEmpty>
                        <CommandGroup>
                            {parties.map((party) => (
                                <CommandItem
                                    key={party.id}
                                    value={`${party.name} ${party.phone}`}
                                    onSelect={() => {
                                        router.push(`/parties/${party.id}`);
                                        setOpen(false);
                                    }}
                                >
                                    <Check className={cn("mr-2 h-4 w-4", currentPartyId === party.id ? "opacity-100" : "opacity-0")} />
                                    <div className="flex flex-col">
                                        <span className="font-medium">{party.name}</span>
                                        <span className="text-xs text-muted-foreground">{party.phone || 'No phone'}</span>
                                    </div>
                                </CommandItem>
                            ))}
                        </CommandGroup>
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    );
};

function PartyLedgerPage({ params }: { params: Promise<{ partyId: string }> }) {
  const { partyId } = use(params);
  const router = useRouter();
  const { toast } = useToast();
  
  const [party, setParty] = useState<Party | null>(null);
  const [parties, setParties] = useState<Party[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);
  
  const [filters, setFilters] = useState({ dateFrom: '', dateTo: '', via: 'all' });
  const [isDateFilterEnabled, setIsDateFilterEnabled] = useState(true);
  const [includeInternalTx, setIncludeInternalTx] = useState(true);
  const [activeTab, setActiveTab] = useState("transactions");
  
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isGiveOptionsOpen, setIsGiveOptionsOpen] = useState(false);
  const [isReceiveOptionsOpen, setIsReceiveOptionsOpen] = useState(false);
  const [isAdvanceOptionsOpen, setIsAdvanceOptionsOpen] = useState(false);
  
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
  const [viewingReceipt, setViewingReceipt] = useState<Transaction | null>(null);
  const [viewingInvoice, setViewingInvoice] = useState<Transaction | null>(null);
  
  const [sendSms, setSendSms] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isHeaderActionsExpanded, setIsHeaderActionsExpanded] = useState(false);
  
  const [smsData, setSmsData] = useState<SheetRow[]>([]);
  const [smsLoading, setSmsLoading] = useState(false);
  const [isSmsSearchOpen, setIsSmsSearchOpen] = useState(false);

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
      
      const unsubTx = subscribeToTransactionsForParty(partyId, setTransactions, (err) => toast({ variant: 'destructive', title: 'Error', description: err.message }));
      const unsubAcc = subscribeToAccounts(setAccounts, console.error);
      const unsubParties = subscribeToParties(setParties, console.error);
      
      const timer = setTimeout(() => setLoading(false), 500);
      return () => { unsubTx(); unsubAcc(); unsubParties(); clearTimeout(timer); };
    }
  }, [partyId, toast, transactionForm]);

  const { groupedTransactions, currentBalance, openingBalance, analysis, stats } = useMemo(() => {
    const enabledTxs = transactions.filter(t => t.enabled);
    
    // Sort oldest first for running balance calculation
    const sortedTimeline = [...enabledTxs].sort((a, b) => {
        const dateA = new Date(a.date).getTime();
        const dateB = new Date(b.date).getTime();
        if (dateA !== dateB) return dateA - dateB;
        const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return timeA - timeB;
    });
    
    let running = 0;
    let totalReceive = 0;
    let totalGive = 0;

    const withRunning = sortedTimeline.map(t => {
        const effect = getPartyBalanceEffect(t);
        const shouldAffectBalance = !['sale', 'purchase', 'income', 'spent'].includes(t.type);
        if (shouldAffectBalance) {
            running += effect;
        }
        
        if (['receive', 'credit_purchase', 'sale_return', 'credit_income', 'sale', 'income'].includes(t.type)) totalReceive += t.amount;
        if (['give', 'credit_sale', 'purchase_return', 'credit_give', 'spent', 'purchase'].includes(t.type)) totalGive += t.amount;
        
        return { ...t, runningBalance: running };
    });

    const opening = isDateFilterEnabled ? withRunning.filter(t => t.date < filters.dateFrom).pop()?.runningBalance || 0 : 0;

    let filtered = withRunning.filter(t => {
        if (!includeInternalTx && !['credit_sale', 'credit_purchase', 'credit_give', 'credit_income', 'receive', 'give'].includes(t.type)) return false;
        if (filters.via !== 'all' && t.via !== filters.via) return false;
        if (!isDateFilterEnabled) return true;
        return t.date >= filters.dateFrom && t.date <= filters.dateTo;
    });

    const grouped: { [key: string]: any[] } = {};
    filtered.forEach(t => { 
        if(!grouped[t.date]) grouped[t.date] = []; 
        grouped[t.date].push(t); 
    });
    
    // AS PER RULES.MD: Oldest to Newest sorting for the ledger (Oldest dates at top, Newest dates at bottom)
    const groupedArray = Object.entries(grouped).sort(([dateA], [dateB]) => new Date(dateA).getTime() - new Date(dateB).getTime());

    const productStats = Array.from(enabledTxs.reduce((acc, tx) => {
        if (tx.type === 'sale' || tx.type === 'credit_sale') {
            tx.items?.forEach(item => {
                const existing = acc.get(item.id) || { id: item.id, name: item.name, quantity: 0, totalValue: 0, returns: 0 };
                existing.quantity += item.quantity;
                existing.totalValue += (item.price * item.quantity);
                acc.set(item.id, existing);
            });
        } else if (tx.type === 'sale_return') {
            tx.items?.forEach(item => {
                const existing = acc.get(item.id) || { id: item.id, name: item.name, quantity: 0, totalValue: 0, returns: 0 };
                existing.returns += item.quantity;
                acc.set(item.id, existing);
            });
        }
        return acc;
    }, new Map<string, any>()).values());

    return { 
        groupedTransactions: groupedArray, 
        currentBalance: running, 
        openingBalance: opening, 
        analysis: { totalReceive, totalGive },
        stats: { 
            startDate: sortedTimeline[0]?.date, 
            endDate: sortedTimeline[sortedTimeline.length - 1]?.date,
            totalCount: enabledTxs.length, 
            latestTx: sortedTimeline[sortedTimeline.length - 1], 
            productStats 
        }
    };
  }, [transactions, filters, isDateFilterEnabled, includeInternalTx]);

  const handleFetchSms = async () => {
      setSmsLoading(true);
      try {
          const data = await fetchSheetData();
          setSmsData(data);
          setIsSmsSearchOpen(true);
      } catch (e: any) {
          toast({ variant: 'destructive', title: 'SMS Fetch Failed', description: e.message });
      } finally {
          setSmsLoading(false);
      }
  }

  const selectSms = (sms: SheetRow) => {
      transactionForm.setValue('description', sms.message);
      const match = sms.message.match(/Tk\s*([\d,]+\.?\d*)/i);
      if (match) transactionForm.setValue('amount', parseFloat(match[1].replace(/,/g, '')));
      setIsSmsSearchOpen(false);
  }

  const handleAddTransaction = async (data: FormValues) => {
    if (!party) return;
    setIsSaving(true);
    try {
        const dateStr = formatFns(data.date, 'yyyy-MM-dd');
        await addTxService({ ...data, date: dateStr, partyId: party.id, enabled: true, via: data.via || 'Personal', sendSms });
        if (data.charge && data.charge > 0) {
            await addTxService({ date: dateStr, description: `Charge for: ${data.description}`, amount: data.charge, type: 'spent', accountId: data.accountId, via: data.chargeVia || data.via || 'Personal', enabled: true });
        }
        toast({ title: "Success", description: "Transaction recorded." });
        setIsFormOpen(false);
        transactionForm.reset();
    } catch (error: any) {
        toast({ variant: "destructive", title: "Error", description: error.message });
    } finally {
        setIsSaving(false);
    }
  };

  const handleDisableTransaction = async (id: string) => {
    try {
      await toggleTransaction(id, false);
      toast({ title: 'Transaction Disabled', description: 'The transaction has been moved to the activity log.' });
    } catch (error) {
      console.error('Failed to disable transaction:', error);
      toast({ variant: 'destructive', title: 'Error', description: 'Could not disable transaction.' });
    }
  };

  const openForm = (type: Transaction['type'], desc: string) => {
      transactionForm.setValue('type', type);
      transactionForm.setValue('description', desc);
      setIsGiveOptionsOpen(false);
      setIsReceiveOptionsOpen(false);
      setIsAdvanceOptionsOpen(false);
      setIsFormOpen(true);
  }

  const goToStockInOut = () => {
    if (!party) return;
    const params = new URLSearchParams();
    params.set('partyIds', party.id);
    const fromDate = isDateFilterEnabled && filters.dateFrom ? filters.dateFrom : stats.startDate;
    const toDate = isDateFilterEnabled && filters.dateTo ? filters.dateTo : stats.endDate;
    if (fromDate) params.set('dateFrom', fromDate);
    if (toDate) params.set('dateTo', toDate);
    router.push(`/reports/stock-in-out?${params.toString()}`);
  }

  if (loading || !party) return <div className="flex justify-center items-center h-screen"><Loader2 className="animate-spin h-12 w-12 text-primary" /></div>;

  return (
    <div className="flex flex-col bg-gray-50 dark:bg-gray-900 min-h-screen pb-24">
        <header className="bg-background border-b sticky top-0 z-20 shadow-sm no-print">
            <div className="container mx-auto px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                        <Button variant="ghost" size="icon" asChild className="h-8 w-8"><Link href="/parties"><ArrowLeft className="h-4 w-4" /></Link></Button>
                        <Avatar className="h-8 w-8"><AvatarFallback className="bg-primary text-white font-bold text-xs">{party?.name?.charAt(0)}</AvatarFallback></Avatar>
                        <div className="min-w-[150px]"><PartySearchSwitcher parties={parties} currentPartyId={party.id} /></div>
                    </div>
                </div>
                <div className="mt-2">
                    <Card className="bg-gray-100 dark:bg-gray-800 border-0 shadow-sm relative overflow-hidden">
                        <CardContent className="p-3 text-center">
                            <p className="text-[10px] uppercase font-black text-gray-500 tracking-widest mb-1">{currentBalance >= 0 ? 'NET PAYABLE' : 'NET RECEIVABLE'}</p>
                            <p className={cn("text-3xl font-black", currentBalance >= 0 ? "text-red-600" : "text-green-600")}>৳{formatAmount(Math.abs(currentBalance), false)}</p>
                            <motion.div initial={false} animate={{ height: isHeaderActionsExpanded ? 'auto' : 0, opacity: isHeaderActionsExpanded ? 1 : 0 }} className="overflow-hidden">
                                <div className="flex justify-center gap-4 mt-4 pt-3 border-t border-gray-200 dark:border-gray-700">
                                    <button onClick={() => openForm('spent', `Expense for ${party.name}`)} className="flex flex-col items-center gap-1"><div className="p-2 rounded-full bg-red-100 text-red-600"><MinusCircle className="h-4 w-4"/></div><span className="text-[10px] font-bold text-gray-500 uppercase">EXPENSE</span></button>
                                    <Link href={`/pos?partyId=${partyId}`} className="flex flex-col items-center gap-1"><div className="p-2 rounded-full bg-green-100 text-green-600"><ShoppingCart className="h-4 w-4"/></div><span className="text-[10px] font-bold text-gray-500 uppercase">POS</span></Link>
                                    <button onClick={() => window.print()} className="flex flex-col items-center gap-1"><div className="p-2 rounded-full bg-gray-100 text-gray-600"><Printer className="h-4 w-4"/></div><span className="text-[10px] font-bold text-gray-500 uppercase">PRINT</span></button>
                                    <button onClick={() => window.print()} className="flex flex-col items-center gap-1"><div className="p-2 rounded-full bg-teal-100 text-teal-600"><Share2 className="h-4 w-4"/></div><span className="text-[10px] font-bold text-gray-500 uppercase">SHARE</span></button>
                                </div>
                            </motion.div>
                            <button onClick={() => setIsHeaderActionsExpanded(!isHeaderActionsExpanded)} className="mx-auto mt-2 flex h-6 w-12 items-center justify-center rounded-full bg-gray-200 dark:bg-gray-700 text-gray-500 hover:bg-gray-300 transition-colors">
                                {isHeaderActionsExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                            </button>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </header>

        <main className="container mx-auto p-3 flex-1">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <div className="flex justify-center border-b mb-4 no-print">
                <TabsList className="bg-transparent h-12 gap-6 px-4">
                    <TabsTrigger value="transactions" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none font-bold uppercase text-xs text-muted-foreground data-[state=active]:text-foreground">Transactions</TabsTrigger>
                    <TabsTrigger value="analysis" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none font-bold uppercase text-xs text-muted-foreground data-[state=active]:text-foreground">Analysis</TabsTrigger>
                    <TabsTrigger value="loan" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none font-bold uppercase text-xs text-muted-foreground data-[state=active]:text-foreground">Loan</TabsTrigger>
                </TabsList>
            </div>

            <TabsContent value="transactions" className="space-y-3 m-0">
                <div className="flex flex-wrap items-center gap-3 bg-background p-3 rounded-lg border shadow-sm no-print mb-4">
                    <div className="flex-1 min-w-[120px] space-y-1"><Label className="text-[10px] font-bold text-muted-foreground uppercase">Start</Label><Input type="date" value={filters.dateFrom} onChange={e => setFilters({...filters, dateFrom: e.target.value})} className="h-9 text-xs" /></div>
                    <div className="flex-1 min-w-[120px] space-y-1"><Label className="text-[10px] font-bold text-muted-foreground uppercase">End</Label><Input type="date" value={filters.dateTo} onChange={e => setFilters({...filters, dateTo: e.target.value})} className="h-9 text-xs" /></div>
                    <div className="flex items-center space-x-2 pb-2"><Switch checked={!isDateFilterEnabled} onCheckedChange={v => setIsDateFilterEnabled(!v)} /><Label className="text-[10px] font-bold uppercase text-muted-foreground">All Tx</Label></div>
                    <div className="flex items-center space-x-2 pb-2"><Checkbox id="inc-exp" checked={includeInternalTx} onCheckedChange={v => setIncludeInternalTx(!!v)} /><Label htmlFor="inc-exp" className="text-[10px] font-bold uppercase text-muted-foreground">INC/EXP</Label></div>
                    <Button variant="outline" size="sm" className="h-9 gap-1 text-[10px] font-bold uppercase" onClick={goToStockInOut}><Repeat className="h-3.5 w-3.5"/> Go to in/out</Button>
                </div>

                <div className="rounded-lg border bg-card shadow-sm overflow-x-auto">
                    <Table>
                      <TableHeader><TableRow className="bg-muted/50"><TableHead className="text-xs">Date</TableHead><TableHead>Description</TableHead><TableHead className="text-right text-xs">Dr (Gave)</TableHead><TableHead className="text-right text-xs">Cr (Recv)</TableHead><TableHead className="text-right text-xs">Balance</TableHead><TableHead className="w-[40px] no-print"></TableHead></TableRow></TableHeader>
                      <TableBody>
                        {isDateFilterEnabled && <TableRow className="bg-slate-50 italic"><TableCell colSpan={4} className="text-right font-medium text-xs">Opening Balance</TableCell><TableCell className="text-right font-bold text-xs">{formatAmount(openingBalance)}</TableCell><TableCell className="no-print"></TableCell></TableRow>}
                        {groupedTransactions.map(([date, txs]) => (
                          <React.Fragment key={date}>
                            <TableRow className="bg-primary/5"><TableCell colSpan={6} className="py-1 px-3 font-bold text-[10px] text-primary uppercase">{formatDate(date)}</TableCell></TableRow>
                            {txs.map((t) => {
                              const effect = getPartyBalanceEffect(t);
                              const isDebit = effect < 0;
                              const isCredit = effect > 0;
                              const accName = accounts.find(a => a.id === t.accountId)?.name || t.payments?.map(p => accounts.find(a => a.id === p.accountId)?.name).join(', ') || '';
                              return (
                                <TableRow key={t.id} className="group hover:bg-muted/30">
                                    <TableCell className="text-[10px]">{formatDate(date)}</TableCell>
                                    <TableCell><div className="flex flex-col"><span className="text-xs font-semibold">{t.description}</span><div className="flex gap-1 mt-1">{accName && <Badge variant="secondary" className="text-[8px] h-4">{accName}</Badge>}<Badge variant="outline" className="text-[8px] h-4 uppercase">{(t.type || '').replace('_', ' ')}</Badge></div></div></TableCell>
                                    <TableCell className="text-right text-red-600 text-[10px] font-mono">{isDebit ? formatAmount(t.amount, false) : '-'}</TableCell>
                                    <TableCell className="text-right text-green-600 text-[10px] font-mono">{isCredit ? formatAmount(t.amount, false) : '-'}</TableCell>
                                    <TableCell className="text-right font-bold text-[10px] font-mono">{formatAmount(t.runningBalance)}</TableCell>
                                    <TableCell className="text-right no-print">
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                                <Button variant="ghost" size="icon" className="h-6 w-6">
                                                    <MoreVertical className="h-3 w-3" />
                                                </Button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent align="end">
                                                <DropdownMenuItem onClick={() => setEditingTransaction(t)}>
                                                    <Edit className="mr-2 h-4 w-4" /> Edit
                                                </DropdownMenuItem>
                                                <DropdownMenuItem onClick={() => {
                                                    if (t.invoiceNumber) setViewingInvoice(t);
                                                    else setViewingReceipt(t);
                                                }}>
                                                    <FileText className="mr-2 h-4 w-4" /> Receipt/Invoice
                                                </DropdownMenuItem>
                                                <DropdownMenuSeparator />
                                                <AlertDialog>
                                                    <AlertDialogTrigger asChild>
                                                        <DropdownMenuItem onSelect={(e) => e.preventDefault()} className="text-destructive">
                                                            <Trash2 className="mr-2 h-4 w-4" /> Disable
                                                        </DropdownMenuItem>
                                                    </AlertDialogTrigger>
                                                    <AlertDialogContent>
                                                        <AlertDialogHeader>
                                                            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                                                            <AlertDialogDescription>
                                                                This will disable the transaction and it will no longer affect balances. You can restore it from the Activity Log.
                                                            </AlertDialogDescription>
                                                        </AlertDialogHeader>
                                                        <AlertDialogFooter>
                                                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                            <AlertDialogAction onClick={() => handleDisableTransaction(t.id)}>Disable</AlertDialogAction>
                                                        </AlertDialogFooter>
                                                    </AlertDialogContent>
                                                </AlertDialog>
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

            <TabsContent value="analysis" className="m-0 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Card><CardHeader><CardTitle className="text-base flex items-center gap-2"><BarChart2/> Summary</CardTitle></CardHeader><CardContent className="space-y-2 text-sm"><div className="flex justify-between border-b pb-1"><span>Start Date</span><span className="font-bold">{stats.startDate ? formatDate(stats.startDate) : '-'}</span></div><div className="flex justify-between border-b pb-1"><span>Total Tx</span><span className="font-bold">{stats.totalCount}</span></div><div className="flex justify-between border-b pb-1"><span>Total Cr (Recv)</span><span className="font-bold text-green-600">{formatAmount(analysis.totalReceive)}</span></div><div className="flex justify-between border-b pb-1"><span>Total Dr (Gave)</span><span className="font-bold text-red-600">{formatAmount(analysis.totalGive)}</span></div></CardContent></Card>
                    <Card><CardHeader><CardTitle className="text-base flex items-center gap-2"><Package/> Sales & Returns</CardTitle></CardHeader><CardContent><Table><TableHeader><TableRow><TableHead>Product</TableHead><TableHead className="text-center">Qty</TableHead><TableHead className="text-right">Avg</TableHead><TableHead className="text-right">Ret</TableHead></TableRow></TableHeader><TableBody>{stats.productStats.map(ps => (<TableRow key={ps.id}><TableCell className="text-[10px]">{ps.name}</TableCell><TableCell className="text-center font-bold">{ps.quantity}</TableCell><TableCell className="text-right font-mono text-[10px]">{formatAmount(ps.totalValue / ps.quantity)}</TableCell><TableCell className="text-right text-red-600 font-bold">{ps.returns}</TableCell></TableRow>))}</TableBody></Table></CardContent></Card>
                </div>
            </TabsContent>

            <TabsContent value="loan" className="m-0">
                <Card><CardHeader className="flex-row justify-between items-center"><CardTitle className="text-base">Loans</CardTitle><Button asChild variant="outline" size="sm"><Link href={`/parties/${partyId}/loans/new`}>+ Add</Link></Button></CardHeader><CardContent>{party?.loans?.map(loan => (<Card key={loan.id} className="mb-4 border-l-4 border-l-primary"><CardHeader className="p-3 flex-row justify-between"><div><CardTitle className="text-sm">Loan #{loan.loanNumber}</CardTitle><CardDescription className="text-xs">{formatAmount(loan.principal)} @ {loan.interestRate}%</CardDescription></div><Badge>{loan.isActive ? 'Active' : 'Closed'}</Badge></CardHeader><CardContent className="p-3 pt-0 overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Inst.</TableHead><TableHead>Amount</TableHead><TableHead>Status</TableHead></TableRow></TableHeader><TableBody>{loan.schedule.map((emi, i) => (<TableRow key={i}><TableCell>{emi.installment}</TableCell><TableCell className="font-mono text-xs">{formatAmount(emi.payment)}</TableCell><TableCell><Badge variant={emi.status === 'paid' ? 'default' : 'outline'}>{emi.status}</Badge></TableCell></TableRow>))}</TableBody></Table></CardContent></Card>)) || <div className="text-center py-8 opacity-20"><Landmark className="h-12 w-12 mx-auto"/></div>}</CardContent></Card>
            </TabsContent>
          </Tabs>
        </main>

        <footer className="fixed bottom-0 left-0 right-0 z-30 bg-background border-t p-3 shadow-lg no-print">
            <div className="container mx-auto grid grid-cols-2 gap-3 max-w-4xl">
                <Button size="lg" className="h-12 bg-red-600 hover:bg-red-700 font-bold" onClick={() => setIsGiveOptionsOpen(true)}><ArrowUp className="mr-2 h-5 w-5" /> I Gave (৳)</Button>
                <Button size="lg" className="h-12 bg-green-600 hover:bg-green-700 font-bold" onClick={() => setIsReceiveOptionsOpen(true)}><ArrowDown className="mr-2 h-5 w-5" /> I Received (৳)</Button>
            </div>
        </footer>

        <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
            <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
                <DialogHeader><DialogTitle>Record Transaction</DialogTitle></DialogHeader>
                <form onSubmit={transactionForm.handleSubmit(handleAddTransaction)} className="space-y-4 py-2">
                    <Button type="button" variant="outline" className="w-full justify-start gap-2" onClick={handleFetchSms} disabled={smsLoading}>{smsLoading ? <Loader2 className="animate-spin h-4 w-4"/> : <Search className="h-4 w-4"/>} Search SMS</Button>
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1"><Label>Amount</Label><Input type="number" step="0.01" {...transactionForm.register('amount')} autoFocus /></div>
                        <div className="space-y-1"><Label>Date</Label><Controller control={transactionForm.control} name="date" render={({ field }) => ( <DatePicker value={field.value} onChange={(d) => field.onChange(d as Date)} />)} /></div>
                    </div>
                    <div className="space-y-1"><Label>Description</Label><Input {...transactionForm.register('description')} /></div>
                    <div className="grid grid-cols-2 gap-4">
                        {!['credit_give', 'credit_income', 'credit_purchase', 'credit_sale'].includes(transactionForm.watch('type')) && (<div className="space-y-1"><Label>Account</Label><Controller name="accountId" control={transactionForm.control} render={({ field }) => (
                            <Select onValueChange={field.onChange} value={field.value}>
                                <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                                <SelectContent>{accounts.map(acc => <SelectItem key={acc.id} value={acc.id}>{acc.name}</SelectItem>)}</SelectContent>
                            </Select>
                        )} /></div>)}
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
                    <div className="grid grid-cols-2 gap-4 border-t pt-4">
                        <div className="space-y-1"><Label>Charge</Label><Input type="number" step="0.01" {...transactionForm.register('charge')} /></div>
                        <div className="space-y-1">
                            <Label>Charge Via</Label>
                            <Controller name="chargeVia" control={transactionForm.control} render={({ field }) => (
                                <Select onValueChange={field.onChange} value={field.value}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>{appSettings?.businessProfiles.map(p => <SelectItem key={p.name} value={p.name}>{p.name}</SelectItem>)}</SelectContent>
                                </Select>
                            )} />
                        </div>
                    </div>
                    <div className="flex items-center justify-center gap-2 pt-2"><Switch checked={sendSms} onCheckedChange={setSendSms}/><Label>Send SMS</Label></div>
                    <DialogFooter><Button type="submit" disabled={isSaving} className="w-full">{isSaving ? <Loader2 className="animate-spin mr-2"/> : <Save className="mr-2"/>} Save Transaction</Button></DialogFooter>
                </form>
            </DialogContent>
        </Dialog>

        <Dialog open={isGiveOptionsOpen} onOpenChange={setIsGiveOptionsOpen}><DialogContent><DialogHeader><DialogTitle>Select "Give" Type</DialogTitle></DialogHeader><div className="grid gap-3 py-4"><Button variant="outline" className="h-16 justify-start gap-4" onClick={() => openForm('give', `Paid to ${party?.name}`)}><div className="p-2 bg-red-100 rounded-full text-red-600"><Wallet/></div><div className="text-left"><p className="font-bold">Give (Paid)</p><p className="text-xs text-muted-foreground text-[10px]">Cash/Bank payment</p></div></Button><Button variant="outline" className="h-16 justify-start gap-4" onClick={() => openForm('credit_give', `Due to ${party?.name}`)}><div className="p-2 bg-orange-100 rounded-full text-orange-600"><HandCoins/></div><div className="text-left"><p className="font-bold">Credit Give (Due)</p><p className="text-xs text-muted-foreground text-[10px]">Record due amount</p></div></Button></div></DialogContent></Dialog>
        <Dialog open={isReceiveOptionsOpen} onOpenChange={setIsReceiveOptionsOpen}><DialogContent><DialogHeader><DialogTitle>Select "Receive" Type</DialogTitle></DialogHeader><div className="grid gap-3 py-4"><Button variant="outline" className="h-16 justify-start gap-4" onClick={() => openForm('receive', `Received from ${party?.name}`)}><div className="p-2 bg-green-100 rounded-full text-green-600"><Wallet/></div><div className="text-left"><p className="font-bold">Receive Payment</p><p className="text-xs text-muted-foreground text-[10px]">Cash/Bank entry</p></div></Button><Button variant="outline" className="h-16 justify-start gap-4" onClick={() => openForm('credit_income', `Income from ${party?.name}`)}><div className="p-2 bg-blue-100 rounded-full text-blue-600"><HandCoins/></div><div className="text-left"><p className="font-bold">Credit Income (Due)</p><p className="text-xs text-muted-foreground text-[10px]">Record without cash</p></div></Button><Button variant="outline" className="h-16 justify-start gap-4" onClick={() => { setIsReceiveOptionsOpen(false); setIsAdvanceOptionsOpen(true); }}><div className="p-2 bg-purple-100 rounded-full text-purple-600"><Repeat/></div><div className="text-left"><p className="font-bold">Advance Receive</p><p className="text-xs text-muted-foreground text-[10px]">Special inward entry</p></div></Button></div></DialogContent></Dialog>
        <Dialog open={isAdvanceOptionsOpen} onOpenChange={setIsAdvanceOptionsOpen}><DialogContent className="max-w-md"><DialogHeader><DialogTitle>Receive as</DialogTitle></DialogHeader><div className="grid grid-cols-1 gap-2 py-4">
            <Button variant="outline" className="h-14 justify-start px-4 text-xs font-bold uppercase" onClick={() => openForm('receive', `Advance Payment from ${party?.name}`)}><Wallet className="mr-3 h-5 w-5 text-green-600"/> Payment</Button>
            <Button variant="outline" className="h-14 justify-start px-4 text-xs font-bold uppercase" onClick={() => openForm('credit_purchase', `Advance Credit Purchase from ${party?.name}`)}><FileText className="mr-3 h-5 w-5 text-orange-600"/> Credit Purchase</Button>
            <Button variant="outline" className="h-14 justify-start px-4 text-xs font-bold uppercase" onClick={() => openForm('purchase', `Advance Cash Purchase from ${party?.name}`)}><ShoppingCart className="mr-3 h-5 w-5 text-red-600"/> Cash Purchase</Button>
            <Button variant="outline" className="h-14 justify-start px-4 text-xs font-bold uppercase" onClick={() => openForm('income', `Advance Other Income from ${party?.name}`)}><TrendingUp className="mr-3 h-5 w-5 text-blue-600"/> Other Income</Button>
            <Button variant="outline" className="h-14 justify-start px-4 text-xs font-bold uppercase" onClick={() => openForm('credit_income', `Advance Credit Income from ${party?.name}`)}><HandCoins className="mr-3 h-5 w-5 text-purple-600"/> Credit Income</Button>
        </div></DialogContent></Dialog>
        
        <Dialog open={isSmsSearchOpen} onOpenChange={setIsSmsSearchOpen}>
            <DialogContent className="sm:max-w-2xl"><DialogHeader><DialogTitle>Select Transaction from SMS</DialogTitle></DialogHeader><div className="max-h-[60vh] overflow-y-auto space-y-2">{smsData.map((sms, i) => (<div key={i} className="p-3 border rounded-md hover:bg-muted cursor-pointer transition-colors" onClick={() => selectSms(sms)}><div className="flex justify-between text-[10px] text-muted-foreground mb-1"><span>{sms.name}</span><span>{sms.date}</span></div><p className="text-xs leading-tight">{sms.message}</p></div>))}{smsData.length === 0 && <p className="text-center py-10 opacity-50">No SMS found in sheet.</p>}</div></DialogContent>
        </Dialog>
        
        <PartyTransactionEditDialog transaction={editingTransaction} onOpenChange={(open) => !open && setEditingTransaction(null)} onSave={async (data) => { await updateTransaction(editingTransaction!.id, data); setEditingTransaction(null); }} parties={parties} accounts={accounts} inventoryItems={[]} appSettings={appSettings} />
        <PaymentReceiptDialog isOpen={!!viewingReceipt} onOpenChange={(open) => !open && setViewingReceipt(null)} transaction={viewingReceipt} party={party} appSettings={appSettings} accounts={accounts} allTransactions={transactions} />
        <InvoiceDialog isOpen={!!viewingInvoice} onOpenChange={(open) => !open && setViewingInvoice(null)} invoice={viewingInvoice} party={party} parties={[party]} appSettings={appSettings} onPrint={() => window.print()} accounts={accounts} allTransactions={transactions} />
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
