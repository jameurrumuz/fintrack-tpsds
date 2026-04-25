'use client';

import React, { Suspense, useEffect, useMemo, useState, use } from 'react';
import { useRouter } from 'next/navigation';
import { getDoc, doc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Transaction, Party, Account, AppSettings, Loan, AmortizationEntry } from '@/types';
import { subscribeToAccounts } from '@/services/accountService';
import { subscribeToTransactionsForParty, updateTransaction, addTransaction as addTxService, toggleTransaction, recalculateBalancesFromTransaction } from '@/services/transactionService';
import { getOldLedgerData, updateParty, saveLoanAndUpdateParty, deleteLoan, markEmiAsPaid, updateLoanDetails, editEmiPaymentTransactions, deleteEmiPayment } from '@/services/partyService';
import { getAppSettings } from '@/services/settingsService';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { formatAmount, formatDate, getPartyBalanceEffect, cn } from '@/lib/utils';
import { Loader2, ArrowLeft, Printer, Banknote, ArrowDown, ArrowUp, Trash2, Edit, MoreVertical, MessageSquare, Phone, RefreshCcw } from 'lucide-react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import PartyTransactionEditDialog from '@/components/PartyTransactionEditDialog';

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
  
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);

  useEffect(() => {
    if (partyId) {
      setLoading(true);
      getDoc(doc(db, 'parties', partyId)).then(snap => {
        if (snap.exists()) setParty({ id: snap.id, ...snap.data() } as Party);
      });
      getAppSettings().then(setAppSettings);
      const unsubTx = subscribeToTransactionsForParty(partyId, setTransactions, (err) => toast({ variant: 'destructive', title: 'এই ইররটি ঠিক করে দাও', description: err.message }));
      const unsubAcc = subscribeToAccounts(setAccounts, console.error);
      
      const timer = setTimeout(() => setLoading(false), 500);
      
      return () => {
          unsubTx();
          unsubAcc();
          clearTimeout(timer);
      };
    }
  }, [partyId, toast]);

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
    
    const groupedArray = Object.entries(grouped).sort(([dateA], [dateB]) => new Date(dateB).getTime() - new Date(dateA).getTime());

    return { 
        groupedTransactions: groupedArray, 
        currentBalance: running, 
        openingBalance: opening, 
        finalBalanceInTable: running
    };
  }, [transactions, filters, isDateFilterEnabled]);

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

  if (loading || !party) return <div className="flex justify-center items-center h-screen"><Loader2 className="animate-spin h-12 w-12 text-primary" /></div>;

  return (
    <div className="flex flex-col bg-gray-50 dark:bg-gray-900 min-h-screen">
        <PartyTransactionEditDialog transaction={editingTransaction} onOpenChange={(open) => !open && setEditingTransaction(null)} onSave={handleUpdateTransaction} parties={[party]} accounts={accounts} inventoryItems={[]} appSettings={appSettings} />
        
        <header className="bg-background border-b sticky top-0 z-20 shadow-sm no-print">
            <div className="container mx-auto px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                        <Button variant="ghost" size="icon" asChild className="h-8 w-8"><Link href="/parties"><ArrowLeft className="h-4 w-4" /></Link></Button>
                        <Avatar className="h-8 w-8"><AvatarFallback className="bg-primary text-white font-bold text-xs">{party.name?.charAt(0)}</AvatarFallback></Avatar>
                        <div><h1 className="text-sm font-bold truncate max-w-[150px]">{party.name}</h1><p className="text-[10px] text-muted-foreground">{party.phone || 'No Phone'}</p></div>
                    </div>
                    <div className="flex items-center gap-2">
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-green-600" asChild><a href={`https://wa.me/${party.phone?.replace(/[^0-9]/g, '')}`} target="_blank" rel="noopener noreferrer"><MessageSquare className="h-4 w-4" /></a></Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-blue-600" asChild><a href={`tel:${party.phone}`}><Phone className="h-4 w-4" /></a></Button>
                    </div>
                </div>
                <div className="mt-2">
                    <Card className="bg-gray-100 dark:bg-gray-800 border-0 shadow-sm">
                        <CardContent className="p-2 text-center">
                            <p className="text-[8px] uppercase font-black text-gray-500 tracking-wider">{currentBalance >= 0 ? 'NET PAYABLE' : 'NET RECEIVABLE'}</p>
                            <p className={cn("text-xl font-black", currentBalance >= 0 ? "text-red-600" : "text-green-600")}>৳{formatAmount(Math.abs(currentBalance), false)}</p>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </header>

        <main className="container mx-auto p-3 flex-1 overflow-auto pb-24">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid w-full grid-cols-2 h-auto p-1 bg-gray-100 dark:bg-gray-800 rounded-lg mb-2">
                <TabsTrigger value="transactions" className="text-xs">Transactions</TabsTrigger>
                <TabsTrigger value="party-details" className="text-xs">Analysis</TabsTrigger>
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
          </Tabs>
        </main>
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
