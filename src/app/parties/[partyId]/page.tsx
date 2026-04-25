
'use client';

import React, { Suspense, useEffect, useMemo, useState, use } from 'react';
import { useRouter } from 'next/navigation';
import { getDoc, doc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Transaction, Party, Account, AppSettings } from '@/types';
import { subscribeToAccounts } from '@/services/accountService';
import { subscribeToTransactionsForParty, addTransaction, updateTransaction, toggleTransaction } from '@/services/transactionService';
import { getAppSettings } from '@/services/settingsService';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { formatAmount, formatDate, getPartyBalanceEffect, cn } from '@/lib/utils';
import { Loader2, ArrowLeft, Printer, Banknote, ArrowDown, ArrowUp, Trash2, Edit, MoreVertical, Plus, ShoppingCart, User, Wallet, Receipt, HandCoins, ArrowDownToLine, ChevronDown, Share2, Landmark, Briefcase, FileText, PiggyBank, Scale } from 'lucide-react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription as AlertDialogDescriptionComponent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { DatePicker } from '@/components/ui/date-picker';
import { format as formatFns } from 'date-fns';
import PartyTransactionEditDialog from '@/components/PartyTransactionEditDialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose, DialogDescription } from '@/components/ui/dialog';

const partyTransactionSchema = z.object({
  date: z.date(),
  description: z.string().min(1, 'Description is required'),
  amount: z.coerce.number().positive('Amount must be positive'),
  accountId: z.string().optional(),
  type: z.enum(['receive', 'give', 'credit_sale', 'purchase', 'spent', 'income', 'credit_purchase', 'sale_return', 'purchase_return', 'credit_give', 'credit_income']),
  via: z.string().optional(),
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

  const [party, setParty] = useState<Party | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ dateFrom: '', dateTo: '', via: 'all' });
  const [isDateFilterEnabled, setIsDateFilterEnabled] = useState(false);
  const [activeTab, setActiveTab] = useState("transactions");
  
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [formType, setFormType] = useState<'give' | 'receive' | 'spent' | 'credit_give' | 'credit_income'>('give');
  const [isGiveOptionsOpen, setIsGiveOptionsOpen] = useState(false);
  const [isReceiveOptionsOpen, setIsReceiveOptionsOpen] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);

  const transactionForm = useForm<FormValues>({
    resolver: zodResolver(partyTransactionSchema),
    defaultValues: {
      date: new Date(),
      description: '',
      type: 'receive',
      amount: '' as any,
      accountId: '',
      via: '',
    },
  });

  useEffect(() => {
    if (partyId) {
      setLoading(true);
      getDoc(doc(db, 'parties', partyId)).then(snap => {
        if (snap.exists()) {
          const data = snap.data();
          setParty({ id: snap.id, ...data } as Party);
          transactionForm.setValue('via', data.group || 'Personal');
        }
      });
      getAppSettings().then(setAppSettings);
      const unsubTx = subscribeToTransactionsForParty(partyId, (data) => setTransactions(data), (err) => toast({ variant: 'destructive', title: 'এই ইররটি ঠিক করে দাও', description: err.message }));
      const unsubAcc = subscribeToAccounts(setAccounts, console.error);
      
      const timer = setTimeout(() => setLoading(false), 500);
      
      return () => {
          unsubTx();
          unsubAcc();
          clearTimeout(timer);
      };
    }
  }, [partyId, toast, transactionForm]);

  const { groupedTransactions, currentBalance, openingBalance, finalBalanceInTable } = useMemo(() => {
    const enabledTxs = transactions.filter(t => t.enabled);
    
    const sortedAll = [...enabledTxs].sort((a, b) => {
        const dateA = new Date(a.date).getTime();
        const dateB = new Date(b.date).getTime();
        if (dateA !== dateB) return dateA - dateB;
        const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return timeA - timeB;
    });
    
    let running = 0;
    const withRunning = sortedAll.map(t => {
        running += getPartyBalanceEffect(t);
        return { ...t, runningBalance: running };
    });

    const opening = isDateFilterEnabled ? withRunning
        .filter(t => t.date < filters.dateFrom)
        .pop()?.runningBalance || 0 : 0;

    let filtered = withRunning.filter(t => {
        if (filters.via !== 'all' && t.via !== filters.via) return false;
        if (!isDateFilterEnabled) return true;
        return t.date >= filters.dateFrom && t.date <= filters.dateTo;
    });

    const grouped: { [key: string]: any[] } = {};
    filtered.forEach(t => { if(!grouped[t.date]) grouped[t.date] = []; grouped[t.date].push(t); });
    
    const groupedArray = Object.entries(grouped).sort(([dateA], [dateB]) => new Date(dateB).getTime() - new Date(a.date).getTime());

    return { 
        groupedTransactions: groupedArray, 
        currentBalance: running, 
        openingBalance: opening, 
        finalBalanceInTable: running
    };
  }, [transactions, filters, isDateFilterEnabled]);

  const handleAddTransaction = async (data: FormValues) => {
    if (!party) return;
    try {
        await addTransaction({
            ...data,
            date: formatFns(data.date, 'yyyy-MM-dd'),
            partyId: party.id,
            enabled: true,
            via: data.via || 'Personal',
        });
        toast({ title: "Success", description: "Transaction added successfully." });
        setIsFormOpen(false);
        transactionForm.reset();
    } catch (error: any) {
        toast({ variant: 'destructive', title: "Error", description: error.message });
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

  const openReceiveForm = (type: 'receive' | 'credit_income' | 'advance') => {
      if (type === 'advance') {
          setIsReceiveOptionsOpen(false);
          router.push(`/transactions/receive?partyId=${party?.id}&partyName=${encodeURIComponent(party?.name || '')}`);
          return;
      }
      setFormType('receive');
      transactionForm.setValue('type', type);
      transactionForm.setValue('description', '');
      setIsReceiveOptionsOpen(false);
      setIsFormOpen(true);
  }

  const openGiveForm = (type: 'give' | 'credit_give') => {
      setFormType('give');
      transactionForm.setValue('type', type);
      transactionForm.setValue('description', '');
      setIsGiveOptionsOpen(false);
      setIsFormOpen(true);
  }

  if (loading || !party) return <div className="flex justify-center items-center h-screen"><Loader2 className="animate-spin h-12 w-12 text-primary" /></div>;

  return (
    <div className="flex flex-col bg-gray-50 dark:bg-gray-900 min-h-screen pb-24">
        <PartyTransactionEditDialog transaction={editingTransaction} onOpenChange={(open) => !open && setEditingTransaction(null)} onSave={handleUpdateTransaction} parties={[party]} accounts={accounts} inventoryItems={[]} appSettings={appSettings} />
        
        {/* Type Selection Dialogs */}
        <Dialog open={isReceiveOptionsOpen} onOpenChange={setIsReceiveOptionsOpen}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Select "Receive" Type</DialogTitle>
                    <DialogDescription>Choose how you received the money or goods.</DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <Button variant="outline" className="h-16 flex items-center justify-start gap-4 px-6" onClick={() => openReceiveForm('receive')}>
                        <div className="p-2 bg-green-100 rounded-full"><Wallet className="h-6 w-6 text-green-600"/></div>
                        <div className="text-left"><p className="font-bold">Receive Payment</p><p className="text-xs text-muted-foreground">Cash/Bank entry for existing due</p></div>
                    </Button>
                    <Button variant="outline" className="h-16 flex items-center justify-start gap-4 px-6" onClick={() => openReceiveForm('credit_income')}>
                        <div className="p-2 bg-purple-100 rounded-full"><HandCoins className="h-6 w-6 text-purple-600"/></div>
                        <div className="text-left"><p className="font-bold">Credit Income (Due)</p><p className="text-xs text-muted-foreground">Record income without cash entry</p></div>
                    </Button>
                    <Button variant="outline" className="h-16 flex items-center justify-start gap-4 px-6" onClick={() => openReceiveForm('advance')}>
                        <div className="p-2 bg-blue-100 rounded-full"><ArrowDownToLine className="h-6 w-6 text-blue-600"/></div>
                        <div className="text-left"><p className="font-bold">Advance Receive</p><p className="text-xs text-muted-foreground">Pre-payment for future business</p></div>
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
                        <div className="p-2 bg-red-100 rounded-full"><Wallet className="h-6 w-6 text-red-600"/></div>
                        <div className="text-left"><p className="font-bold">Give (Paid)</p><p className="text-xs text-muted-foreground">Cash/Bank payment to party</p></div>
                    </Button>
                    <Button variant="outline" className="h-16 flex items-center justify-start gap-4 px-6" onClick={() => openGiveForm('credit_give')}>
                        <div className="p-2 bg-orange-100 rounded-full"><HandCoins className="h-6 w-6 text-orange-600"/></div>
                        <div className="text-left"><p className="font-bold">Credit Give (Due)</p><p className="text-xs text-muted-foreground">Record due without cash entry</p></div>
                    </Button>
                </div>
            </DialogContent>
        </Dialog>

        <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
            <DialogContent>
                <DialogHeader><DialogTitle>Record {formType === 'give' ? 'Payment Given' : 'Payment Received'}</DialogTitle></DialogHeader>
                <form onSubmit={transactionForm.handleSubmit(handleAddTransaction)} className="space-y-4 py-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1"><Label>Amount</Label><Input type="number" step="0.01" {...transactionForm.register('amount')} autoFocus /></div>
                        <div className="space-y-1"><Label>Date</Label>
                            <Controller control={transactionForm.control} name="date" render={({ field }) => (<DatePicker value={field.value} onChange={(d) => field.onChange(d as Date)} />)} />
                        </div>
                    </div>
                    <div className="space-y-1"><Label>Description</Label><Input {...transactionForm.register('description')} placeholder="Reason for transaction" /></div>
                    <div className="grid grid-cols-2 gap-4">
                        {!['credit_give', 'credit_income'].includes(transactionForm.watch('type')) && (
                            <div className="space-y-1"><Label>Account</Label>
                                <Controller name="accountId" control={transactionForm.control} render={({ field }) => (
                                    <Select onValueChange={field.onChange} value={field.value}>
                                        <SelectTrigger><SelectValue placeholder="Select account..." /></SelectTrigger>
                                        <SelectContent>{accounts.map(acc => <SelectItem key={acc.id} value={acc.id}>{acc.name}</SelectItem>)}</SelectContent>
                                    </Select>
                                )} />
                            </div>
                        )}
                         <div className="space-y-1"><Label>Business Profile</Label>
                             <Controller name="via" control={transactionForm.control} render={({ field }) => (
                                <Select onValueChange={field.onChange} value={field.value}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>{appSettings?.businessProfiles.map(p => <SelectItem key={p.name} value={p.name}>{p.name}</SelectItem>)}</SelectContent>
                                </Select>
                            )} />
                        </div>
                    </div>
                    <DialogFooter><Button type="submit">Save Transaction</Button></DialogFooter>
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
                    <div className="flex items-center gap-2">
                         <Button variant="outline" size="sm" onClick={() => window.print()}><Printer className="h-4 w-4 mr-2"/> Print</Button>
                    </div>
                </div>
                <div className="mt-2">
                    <Card className="bg-gray-100 dark:bg-gray-800 border-0 shadow-sm relative overflow-hidden">
                        <CardContent className="p-3 text-center">
                            <p className="text-[10px] uppercase font-black text-gray-500 tracking-widest mb-1">{currentBalance >= 0 ? 'NET PAYABLE' : 'NET RECEIVABLE'}</p>
                            <p className={cn("text-3xl font-black", currentBalance >= 0 ? "text-red-600" : "text-green-600")}>৳{formatAmount(Math.abs(currentBalance), false)}</p>
                            
                            {/* Quick Action Icon Row */}
                            <div className="flex justify-center gap-4 mt-4 pt-3 border-t border-gray-200 dark:border-gray-700">
                                <button onClick={() => setActiveTab('loan')} className="flex flex-col items-center gap-1 group">
                                    <div className="p-2 rounded-full bg-purple-100 text-purple-600 group-hover:bg-purple-200 transition-colors"><Landmark className="h-4 w-4"/></div>
                                    <span className="text-[10px] font-bold text-gray-500 uppercase">Loan</span>
                                </button>
                                <button onClick={() => setActiveTab('old_ledger')} className="flex flex-col items-center gap-1 group">
                                    <div className="p-2 rounded-full bg-blue-100 text-blue-600 group-hover:bg-blue-200 transition-colors"><History className="h-4 w-4"/></div>
                                    <span className="text-[10px] font-bold text-gray-500 uppercase">Old</span>
                                </button>
                                <button onClick={() => setActiveTab('party-details')} className="flex flex-col items-center gap-1 group">
                                    <div className="p-2 rounded-full bg-orange-100 text-orange-600 group-hover:bg-orange-200 transition-colors"><FileText className="h-4 w-4"/></div>
                                    <span className="text-[10px] font-bold text-gray-500 uppercase">Exp</span>
                                </button>
                                <Link href={`/pos?partyId=${partyId}`} className="flex flex-col items-center gap-1 group">
                                    <div className="p-2 rounded-full bg-green-100 text-green-600 group-hover:bg-green-200 transition-colors"><ShoppingCart className="h-4 w-4"/></div>
                                    <span className="text-[10px] font-bold text-gray-500 uppercase">POS</span>
                                </button>
                                <button onClick={() => window.print()} className="flex flex-col items-center gap-1 group">
                                    <div className="p-2 rounded-full bg-gray-100 text-gray-600 group-hover:bg-gray-200 transition-colors"><Printer className="h-4 w-4"/></div>
                                    <span className="text-[10px] font-bold text-gray-500 uppercase">Print</span>
                                </button>
                                <button onClick={() => toast({ title: "Sharing not implemented" })} className="flex flex-col items-center gap-1 group">
                                    <div className="p-2 rounded-full bg-teal-100 text-teal-600 group-hover:bg-teal-200 transition-colors"><Share2 className="h-4 w-4"/></div>
                                    <span className="text-[10px] font-bold text-gray-500 uppercase">Share</span>
                                </button>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </header>

        <main className="container mx-auto p-3 flex-1 overflow-auto">
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
                          <TableHead className="text-right text-xs">Dr</TableHead>
                          <TableHead className="text-right text-xs">Cr</TableHead>
                          <TableHead className="text-right text-xs">Balance</TableHead>
                          <TableHead className="w-[40px]"></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {groupedTransactions.map(([date, txs]) => (
                          <React.Fragment key={date}>
                            <TableRow className="bg-primary/5 hover:bg-primary/10">
                              <TableCell colSpan={6} className="py-1 px-3 font-bold text-[10px] text-primary">{formatDate(date)}</TableCell>
                            </TableRow>
                            {txs.map((t) => {
                              const effect = getPartyBalanceEffect(t);
                              const isDebit = effect < 0;
                              const isCredit = effect > 0;
                              return (
                                <TableRow key={t.id} className="group hover:bg-muted/30">
                                    <TableCell className="text-[10px]">{formatDate(date)}</TableCell>
                                    <TableCell>
                                        <div className="flex flex-col">
                                            <span className="text-xs">{t.description}</span>
                                            <Badge variant="outline" className="text-[8px] w-fit h-4 uppercase">{t.type}</Badge>
                                        </div>
                                    </TableCell>
                                    <TableCell className="text-right text-red-600 text-[10px]">{isDebit ? formatAmount(t.amount) : '-'}</TableCell>
                                    <TableCell className="text-right text-green-600 text-[10px]">{isCredit ? formatAmount(t.amount) : '-'}</TableCell>
                                    <TableCell className="text-right font-bold text-[10px]">{formatAmount(t.runningBalance)}</TableCell>
                                    <TableCell className="text-right">
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-6 w-6"><MoreVertical className="h-3 w-3" /></Button></DropdownMenuTrigger>
                                            <DropdownMenuContent align="end">
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
                          <TableCell colSpan={4} className="text-right font-bold text-xs">Final Balance</TableCell>
                          <TableCell className="text-right font-bold text-xs">{formatAmount(finalBalanceInTable)}</TableCell>
                          <TableCell></TableCell>
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
                    <CardHeader><CardTitle>Old Ledger Data</CardTitle></CardHeader>
                    <CardContent>
                        <p className="text-muted-foreground text-center py-12">Imported historical data coming soon...</p>
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
