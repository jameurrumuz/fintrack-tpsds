'use client';

import React, { Suspense, useEffect, useMemo, useState, use } from 'react';
import { useRouter } from 'next/navigation';
import { getDoc, doc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Transaction, Account } from '@/types';
import { subscribeToAccounts } from '@/services/accountService';
import { subscribeToAllTransactions } from '@/services/transactionService';
import { toggleTransaction } from '@/services/transactionService';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { formatAmount, formatDate, getEffectiveAmount } from '@/lib/utils';
import { Loader2, ArrowLeft, Printer, Banknote, ArrowDown, ArrowUp, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DatePicker } from '@/components/ui/date-picker';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { format as formatFns, parseISO, startOfDay, endOfDay } from 'date-fns';


function AccountLedgerPage({ params }: { params: Promise<{ accountId: string }> }) {
  const { accountId } = use(params);
  const router = useRouter();
  const { toast } = useToast();

  const [account, setAccount] = useState<Account | null>(null);
  const [allTransactions, setAllTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ dateFrom: '', dateTo: '' });
  const [allAccounts, setAllAccounts] = useState<Account[]>([]);

  useEffect(() => {
    if (accountId) {
      setLoading(true);

      const fetchAccountDetails = async () => {
        if (!db || !accountId) return;
        try {
          const accountDocRef = doc(db, 'accounts', accountId);
          const accountDoc = await getDoc(accountDocRef);
          if (accountDoc.exists()) {
            setAccount({ id: accountDoc.id, ...accountDoc.data() } as Account);
          } else {
            toast({ variant: 'destructive', title: 'Error', description: 'Account not found.' });
            setAccount(null);
          }
        } catch (error) {
          toast({ variant: 'destructive', title: 'Error', description: 'Could not fetch account details.' });
        }
      };

      fetchAccountDetails();
      
      const unsubTransactions = subscribeToAllTransactions(
        setAllTransactions,
        (error) => toast({ variant: 'destructive', title: 'এই ইররটি ঠিক করে দাও', description: 'Could not fetch transactions.' })
      );
      
      const unsubAccounts = subscribeToAccounts(setAllAccounts, console.error);
      
      const timer = setTimeout(() => setLoading(false), 500);

      return () => {
        unsubTransactions();
        unsubAccounts();
        clearTimeout(timer);
      };
    }
  }, [accountId, toast]);
  
 const { filteredTransactions, openingBalance, totalIn, totalOut, currentBalance } = useMemo(() => {
    const transactionsForAccount = allTransactions.filter(tx => {
        if(tx.involvedAccounts && tx.involvedAccounts.includes(accountId)) return true;
        if(tx.accountId === accountId) return true;
        if(tx.fromAccountId === accountId) return true;
        if(tx.toAccountId === accountId) return true;
        if(tx.payments?.some(p => p.accountId === accountId)) return true;
        return false;
    });

    const allSortedTransactions = [...transactionsForAccount]
      .sort((a, b) => {
        const dateA = String(a.date || "");
        const dateB = String(b.date || "");
        if (dateA !== dateB) return dateA.localeCompare(dateB);
        
        const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return timeA - timeB;
      });
  
    let runningBalance = 0;
    const transactionsWithRunningBalance = allSortedTransactions
      .filter(t => t.enabled)
      .map(t => {
        let amountEffect = 0;
        if (t.type === 'transfer') {
          if (t.fromAccountId === accountId) amountEffect = -t.amount;
          else if (t.toAccountId === accountId) amountEffect = t.amount;
        } else if (t.type === 'sale' && t.payments) {
          const payment = t.payments.find(p => p.accountId === accountId);
          if (payment) amountEffect = payment.amount;
        } else if (t.accountId === accountId) {
          amountEffect = getEffectiveAmount(t);
        }
        runningBalance += amountEffect;
        return { ...t, runningBalance, amountEffect };
      })
      .filter(t => t.amountEffect !== 0);
  
    const filterFrom = filters.dateFrom;
    const filterTo = filters.dateTo;
  
    const openingBal = filterFrom
      ? transactionsWithRunningBalance
          .filter(t => (t.date || '') < filterFrom)
          .pop()?.runningBalance || 0
      : 0;
  
    const filtered = transactionsWithRunningBalance.filter(t => {
        const txDateOnly = String(t.date || '').split('T')[0];
        if (filterFrom && txDateOnly < filterFrom) return false;
        if (filterTo && txDateOnly > filterTo) return false;
        return true;
    });
  
    const { in: totalIn, out: totalOut } = filtered.reduce((acc, t) => {
      if (t.amountEffect > 0) acc.in += t.amountEffect;
      if (t.amountEffect < 0) acc.out += Math.abs(t.amountEffect);
      return acc;
    }, { in: 0, out: 0 });
  
    const accountCurrentBalance = allAccounts.find(acc => acc.id === accountId)?.balance || 0;
  
    return { 
      filteredTransactions: [...filtered].sort((a, b) => {
          const dateA = String(a.date || "");
          const dateB = String(b.date || "");
          if (dateA !== dateB) return dateB.localeCompare(dateA);
          const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
          const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
          return timeB - timeA;
      }),
      openingBalance: openingBal, 
      totalIn, 
      totalOut, 
      currentBalance: accountCurrentBalance
    };
  }, [allTransactions, filters, accountId, allAccounts]);

  const printLedger = () => window.print();

  const handleDisableTransaction = async (id: string) => {
    try {
      await toggleTransaction(id, false);
      toast({ title: 'Transaction Disabled', description: 'The transaction has been moved to the activity log.' });
    } catch (error) {
      console.error('Failed to disable transaction:', error);
      toast({ variant: 'destructive', title: 'Error', description: 'Could not disable transaction.' });
    }
  };

  if (loading || !account) {
    return <div className="flex justify-center items-center h-screen"><Loader2 className="h-12 w-12 animate-spin text-primary" /></div>;
  }
  
  const finalBalanceInTable = filteredTransactions.length > 0 ? filteredTransactions[0].runningBalance : openingBalance;

  return (
    <div className="container mx-auto p-4 md:p-8">
      <style>{`
        @page {
          size: A4;
          margin: 1.5cm;
        }
        @media print {
          body {
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          body * { 
            visibility: hidden; 
            font-size: 10pt;
          }
          .print-area, .print-area * { 
            visibility: visible; 
          }
          .print-area { 
            position: absolute; 
            left: 0; 
            top: 0; 
            width: 100%; 
            padding: 0;
            margin: 0;
          }
          .no-print { 
            display: none; 
          }
          .ledger-card { 
            border: none !important; 
            box-shadow: none !important; 
          }
          .print-area table th, .print-area table td {
            padding: 4px 8px;
          }
          .print-area table thead {
            background-color: #f2f2f2 !important;
          }
        }
      `}</style>
      <div className="print-area space-y-6">
        <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6 no-print">
          <Button variant="outline" onClick={() => router.push('/accounts')}><ArrowLeft className="mr-2 h-4 w-4" /> Back to Accounts</Button>
          <Button onClick={printLedger} className="w-full sm:w-auto"><Printer className="mr-2 h-4 w-4"/> Print Ledger</Button>
        </header>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-3 text-3xl"><Banknote/> {account.name}</CardTitle>
            <CardDescription className="pt-2">Account Statement</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card className="bg-muted/50">
                    <CardHeader><CardTitle className="text-xl">Current Balance</CardTitle></CardHeader>
                    <CardContent><p className={cn("text-2xl font-bold", currentBalance >= 0 ? 'text-green-600' : 'text-red-600')}>{formatAmount(currentBalance)}</p></CardContent>
                </Card>
                 <Card>
                    <CardHeader><CardTitle className="text-xl flex items-center gap-2"><ArrowDown className="text-green-500"/> Total In (Credit)</CardTitle></CardHeader>
                    <CardContent><p className="text-2xl font-bold text-green-600">{formatAmount(totalIn)}</p></CardContent>
                </Card>
                 <Card>
                    <CardHeader><CardTitle className="text-xl flex items-center gap-2"><ArrowUp className="text-red-500"/> Total Out (Debit)</CardTitle></CardHeader>
                    <CardContent><p className="text-2xl font-bold text-red-600">{formatAmount(totalOut)}</p></CardContent>
                </Card>
            </div>
          </CardContent>
        </Card>
        
        <Card className="ledger-card">
          <CardHeader className="no-print">
            <CardTitle>Transaction Ledger</CardTitle>
            <CardDescription>Showing all transactions for {account.name}.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col md:flex-row gap-4 mb-4 no-print">
              <div className="space-y-1 flex-grow">
                <Label>From</Label>
                <DatePicker 
                  value={filters.dateFrom ? parseISO(filters.dateFrom) : undefined}
                  onChange={(date) => setFilters({...filters, dateFrom: date ? formatFns(date, 'yyyy-MM-dd') : ''})}
                />
              </div>
              <div className="space-y-1 flex-grow">
                <Label>To</Label>
                <DatePicker 
                  value={filters.dateTo ? parseISO(filters.dateTo) : undefined}
                  onChange={(date) => setFilters({...filters, dateTo: date ? formatFns(date, 'yyyy-MM-dd') : ''})}
                />
              </div>
            </div>
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Description</TableHead><TableHead className="text-right">Debit</TableHead><TableHead className="text-right">Credit</TableHead><TableHead className="text-right">Balance</TableHead><TableHead className="no-print">Actions</TableHead></TableRow></TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow><TableCell colSpan={6} className="h-24 text-center"><Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" /></TableCell></TableRow>
                  ) : (
                    <>
                      {filters.dateFrom && (
                        <TableRow><TableCell colSpan={4} className="font-bold text-right">Opening Balance</TableCell><TableCell className="text-right font-bold font-mono">{formatAmount(openingBalance)}</TableCell><TableCell className="no-print"></TableCell></TableRow>
                      )}
                      {filteredTransactions.length > 0 ? filteredTransactions.map(t => {
                          const isCredit = t.amountEffect > 0;
                          return (
                            <TableRow key={t.id}>
                              <TableCell>{formatDate(t.date)}</TableCell>
                              <TableCell>{t.description}</TableCell>
                              <TableCell className="text-right text-red-600 font-mono">{!isCredit ? formatAmount(Math.abs(t.amountEffect)) : '-'}</TableCell>
                              <TableCell className="text-right text-green-600 font-mono">{isCredit ? formatAmount(t.amountEffect) : '-'}</TableCell>
                              <TableCell className="text-right font-mono">{formatAmount(t.runningBalance)}</TableCell>
                              <TableCell className="no-print">
                                <AlertDialog>
                                  <AlertDialogTrigger asChild>
                                    <Button variant="ghost" size="icon" className="text-destructive"><Trash2 className="h-4 w-4"/></Button>
                                  </AlertDialogTrigger>
                                  <AlertDialogContent>
                                    <AlertDialogHeader><AlertDialogTitle>Are you sure?</AlertDialogTitle><AlertDialogDescription>This will disable the transaction and it will no longer affect balances. You can restore it from the Activity Log.</AlertDialogDescription></AlertDialogHeader>
                                    <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => handleDisableTransaction(t.id)}>Disable</AlertDialogAction></AlertDialogFooter>
                                  </AlertDialogContent>
                                </AlertDialog>
                              </TableCell>
                            </TableRow>
                          )
                      }) : (<TableRow><TableCell colSpan={6} className="text-center h-24">No transactions found for this period.</TableCell></TableRow>)}
                    </>
                  )}
                </TableBody>
                <TableFooter>
                  <TableRow><TableCell colSpan={4} className="text-right font-bold text-lg">Final Balance</TableCell><TableCell className="text-right font-bold text-lg font-mono">{formatAmount(finalBalanceInTable)}</TableCell><TableCell className="no-print"></TableCell></TableRow>
                </TableFooter>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}


export default function AccountLedgerPageWrapper(props: { params: { partyId: string } }) {
  return (
    <Suspense fallback={<div className="flex justify-center items-center h-screen"><Loader2 className="h-12 w-12 animate-spin text-primary" /></div>}>
      <AccountLedgerPage {...props} />
    </Suspense>
  );
}
