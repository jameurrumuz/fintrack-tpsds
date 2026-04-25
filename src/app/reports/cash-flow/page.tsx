
'use client';

import { useState, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter } from '@/components/ui/table';
import { Loader2, Printer, Share2, ArrowDown, ArrowUp, DollarSign } from 'lucide-react';
import type { Transaction, Account } from '@/types';
import { subscribeToAllTransactions } from '@/services/transactionService';
import { subscribeToAccounts } from '@/services/accountService';
import { formatDate, formatAmount, getEffectiveAmount } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import Link from 'next/link';
import { format as formatFns, startOfMonth } from 'date-fns';

export default function CashFlowReport() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState(() => {
    const today = new Date();
    const monthStart = startOfMonth(today);
    return {
        dateFrom: formatFns(monthStart, 'yyyy-MM-dd'),
        dateTo: formatFns(today, 'yyyy-MM-dd'),
        accountId: 'all',
    };
  });
  const { toast } = useToast();

  useEffect(() => {
    setLoading(true);
    const unsubTransactions = subscribeToAllTransactions(setTransactions, (err) => {
        toast({ variant: 'destructive', title: 'এই ইররটি ঠিক করে দাও', description: err.message });
        setLoading(false);
    });
    const unsubAccounts = subscribeToAccounts(setAccounts, (err) => {
        toast({ variant: 'destructive', title: 'Error fetching accounts', description: err.message });
        setLoading(false);
    });

    const timer = setTimeout(() => setLoading(false), 1500); // Give a bit more time for all subscriptions

    return () => {
      unsubTransactions();
      unsubAccounts();
      clearTimeout(timer);
    };
  }, [toast]);

  const { reportData, openingBalance, closingBalance, totalInflow, totalOutflow } = useMemo(() => {
    const sortedTransactions = transactions
        .filter(t => t.enabled)
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    let openingBal = 0;
    sortedTransactions.forEach(t => {
        if (filters.dateFrom && t.date < filters.dateFrom) {
            let effect = 0;
            if (t.type === 'transfer') {
                if (filters.accountId === 'all') {
                    // No net change for transfers in "all accounts" view
                } else {
                    if (t.fromAccountId === filters.accountId) effect = -t.amount;
                    if (t.toAccountId === filters.accountId) effect = t.amount;
                }
            } else if (filters.accountId === 'all' || (t.involvedAccounts || []).includes(filters.accountId)) {
                // For non-transfer tx, getEffectiveAmount works if we are looking at all accounts,
                // or if the specific account is involved.
                effect = getEffectiveAmount(t);
            }
            openingBal += effect;
        }
    });

    const filtered = sortedTransactions.filter(t => {
        if (filters.dateFrom && t.date < filters.dateFrom) return false;
        if (filters.dateTo && t.date > filters.dateTo) return false;
        if (filters.accountId !== 'all' && !(t.involvedAccounts || []).includes(filters.accountId)) return false;
        return ['income', 'spent', 'receive', 'give', 'sale', 'purchase', 'transfer'].includes(t.type);
    });
    
    let currentBalance = openingBal;
    let totalInflow = 0;
    let totalOutflow = 0;

    const reportData = filtered.map(t => {
        let cashIn = 0;
        let cashOut = 0;
        
        if (t.type === 'transfer') {
            if (filters.accountId === 'all') {
                // Transfers have no net effect on total balance
            } else {
                if (t.toAccountId === filters.accountId) cashIn = t.amount;
                if (t.fromAccountId === filters.accountId) cashOut = t.amount;
            }
        } else {
            const effect = getEffectiveAmount(t);
            if (effect > 0) cashIn = effect;
            else cashOut = Math.abs(effect);
        }
        
        totalInflow += cashIn;
        totalOutflow += cashOut;
        currentBalance += (cashIn - cashOut);
        
        return {
            ...t,
            cashIn,
            cashOut,
            balance: currentBalance,
        };
    });

    return { reportData, openingBalance: openingBal, closingBalance: currentBalance, totalInflow, totalOutflow };
  }, [transactions, filters]);


  const handlePrint = () => window.print();

  return (
    <>
      <style>{`
        @media print {
          body * { visibility: hidden; }
          .print-area, .print-area * { visibility: visible; }
          .print-area { position: absolute; left: 0; top: 0; width: 100%; }
          .no-print { display: none; }
        }
      `}</style>
      <div className="no-print mb-6">
        <Button variant="outline" asChild><Link href="/reports">← Back to Reports</Link></Button>
      </div>

      <Card className="print-area">
        <CardHeader>
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
              <CardTitle className="flex items-center gap-2"><DollarSign/> Cash Flow Report</CardTitle>
              <CardDescription>A summary of cash inflows and outflows for the selected period.</CardDescription>
            </div>
            <div className="flex gap-2 no-print">
              <Button onClick={handlePrint} variant="outline"><Printer className="mr-2 h-4 w-4" /> Print Report</Button>
              <Button disabled><Share2 className="mr-2 h-4 w-4" /> Share</Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6 p-4 border rounded-lg no-print">
            <div className="space-y-1"><Label>From</Label><Input type="date" value={filters.dateFrom} onChange={e => setFilters({...filters, dateFrom: e.target.value})} /></div>
            <div className="space-y-1"><Label>To</Label><Input type="date" value={filters.dateTo} onChange={e => setFilters({...filters, dateTo: e.target.value})} /></div>
            <div className="space-y-1"><Label>Account</Label>
                <Select value={filters.accountId} onValueChange={v => setFilters({...filters, accountId: v})}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All Accounts</SelectItem>
                        {accounts.map(acc => <SelectItem key={acc.id} value={acc.id}>{acc.name}</SelectItem>)}
                    </SelectContent>
                </Select>
            </div>
          </div>
          
           <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <Card><CardHeader className="p-3"><CardTitle className="text-sm font-medium">Opening Balance</CardTitle><CardDescription>{formatAmount(openingBalance)}</CardDescription></CardHeader></Card>
            <Card><CardHeader className="p-3"><CardTitle className="text-sm font-medium text-green-600">Total Inflow</CardTitle><CardDescription className="text-green-600">{formatAmount(totalInflow)}</CardDescription></CardHeader></Card>
            <Card><CardHeader className="p-3"><CardTitle className="text-sm font-medium text-red-600">Total Outflow</CardTitle><CardDescription className="text-red-600">{formatAmount(totalOutflow)}</CardDescription></CardHeader></Card>
            <Card><CardHeader className="p-3"><CardTitle className="text-sm font-medium">Closing Balance</CardTitle><CardDescription>{formatAmount(closingBalance)}</CardDescription></CardHeader></Card>
          </div>

          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Inflow</TableHead>
                  <TableHead className="text-right">Outflow</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={4} className="h-24 text-center"><Loader2 className="animate-spin h-8 w-8 mx-auto" /></TableCell></TableRow>
                ) : reportData.length > 0 ? (
                  reportData.map(item => (
                        <TableRow key={item.id}>
                            <TableCell>{formatDate(item.date)}</TableCell>
                            <TableCell>{item.description}</TableCell>
                            <TableCell className="text-right font-mono text-green-600">{item.cashIn > 0 ? formatAmount(item.cashIn) : '-'}</TableCell>
                            <TableCell className="text-right font-mono text-red-600">{item.cashOut > 0 ? formatAmount(item.cashOut) : '-'}</TableCell>
                        </TableRow>
                    ))
                ) : (
                  <TableRow><TableCell colSpan={4} className="h-24 text-center">No cash flow transactions found for the selected criteria.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
