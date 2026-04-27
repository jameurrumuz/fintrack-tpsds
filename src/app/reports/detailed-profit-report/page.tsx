'use client';

import React, { useState, useEffect, useMemo, useRef, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter } from '@/components/ui/table';
import { Loader2, Printer } from 'lucide-react';
import type { Transaction, Party, ProfitCalculationProject, CalculationRow } from '@/types';
import { subscribeToAllTransactions } from '@/services/transactionService';
import { subscribeToParties } from '@/services/partyService';
import { formatAmount, formatDate } from '@/lib/utils';
import Link from 'next/link';
import { parseISO } from 'date-fns';

function DetailedReportContent() {
    const [project, setProject] = useState<ProfitCalculationProject | null>(null);
    const [row, setRow] = useState<CalculationRow | null>(null);
    const [allTransactions, setAllTransactions] = useState<Transaction[]>([]);
    const [parties, setParties] = useState<Party[]>([]);
    const [loading, setLoading] = useState(true);
    const printRef = useRef<HTMLDivElement>(null);
    const searchParams = useSearchParams();

    useEffect(() => {
        setLoading(true);
        const reportDataStr = typeof window !== 'undefined' ? sessionStorage.getItem('detailedReportData') : null;
        if (reportDataStr) {
            const data = JSON.parse(reportDataStr);
            setProject(data.project);
            setRow(data.row);
        }
        
        const unsubTransactions = subscribeToAllTransactions(setAllTransactions, console.error);
        const unsubParties = subscribeToParties(setParties, console.error);

        const timer = setTimeout(() => setLoading(false), 500);
        
        return () => {
            unsubTransactions();
            unsubParties();
            clearTimeout(timer);
        };
    }, []);

    const handlePrint = () => {
        const printableArea = printRef.current;
        if (printableArea) {
            const printWindow = window.open('', '_blank');
            printWindow?.document.write('<html><head><title>Detailed Report</title><script src="https://cdn.tailwindcss.com"><\/script></head><body class="p-8 font-sans">');
            printWindow?.document.write(printableArea.innerHTML);
            printWindow?.document.write('</body></html>');
            printWindow?.document.close();
            printWindow?.focus();
            printWindow?.print();
        }
    };
    
    const {
        sales,
        purchases,
        expenses,
        otherIncomes,
        commissions,
        totals
    } = useMemo(() => {
        const initialTotals = { sales: 0, cost: 0, profit: 0, purchase: 0, expense: 0, income: 0, commission: 0 };
        if (!row || allTransactions.length === 0) {
            return { sales: [], purchases: [], expenses: [], otherIncomes: [], commissions: [], totals: initialTotals };
        }

        const partyMap = new Map(parties.map(p => [p.id, p.name]));
        const getPartyName = (partyId?: string) => partyId ? partyMap.get(partyId) || 'N/A' : 'N/A';

        const filterByIds = (ids: string[] = []) => allTransactions.filter(tx => ids.includes(tx.id));

        const salesTx = filterByIds(row.stockProfitProductIds || []);
        const expensesTx = filterByIds(row.expenseIds || []);
        const otherIncomesTx = filterByIds(row.otherIncomeIds || []);
        const commissionsTx = filterByIds(row.commissionIds || []);

        const salesData = salesTx.flatMap(tx => 
            tx.items?.map(item => ({
                ...item, 
                date: tx.date, 
                partyName: getPartyName(tx.partyId)
            })) || []
        );

        const purchasesData = allTransactions
            .filter(tx => (tx.type === 'purchase' || tx.type === 'credit_purchase') && tx.date >= row.dateFrom && tx.date <= row.dateTo && (row.businessProfile === 'all' || tx.via === row.businessProfile))
            .flatMap(tx => tx.items?.map(item => ({...item, date: tx.date, partyName: getPartyName(tx.partyId)})) || []);
        
        const salesTotals = salesData.reduce((acc, item) => {
            const salePrice = item.price || 0;
            const quantity = item.quantity || 0;
            const totalSale = salePrice * quantity;
            const totalCost = (item.cost || 0);
            acc.sales += totalSale;
            acc.cost += totalCost;
            return acc;
        }, { sales: 0, cost: 0 });
        
        const purchaseTotal = purchasesData.reduce((acc, item) => acc + (item.price * item.quantity), 0);

        return {
            sales: salesData,
            purchases: purchasesData,
            expenses: expensesTx.map(tx => ({...tx, partyName: getPartyName(tx.partyId)})),
            otherIncomes: otherIncomesTx.map(tx => ({...tx, partyName: getPartyName(tx.partyId)})),
            commissions: commissionsTx.map(tx => ({...tx, partyName: getPartyName(tx.partyId)})),
            totals: {
                sales: salesTotals.sales,
                cost: salesTotals.cost,
                profit: row.stockProfit,
                purchase: purchaseTotal,
                expense: row.expense,
                income: row.otherIncome,
                commission: row.commission,
            }
        };
    }, [row, allTransactions, parties]);


    if (loading || !project || !row) {
        return <div className="flex h-screen items-center justify-center"><Loader2 className="h-12 w-12 animate-spin text-primary" /></div>;
    }

    return (
        <div className="bg-gray-100 min-h-screen p-4 sm:p-8">
            <div className="max-w-4xl mx-auto">
                <div className="mb-6 flex justify-between items-center">
                    <Button asChild variant="outline"><Link href="/reports/custom-profit">Back to Projects</Link></Button>
                    <Button onClick={handlePrint}><Printer className="mr-2 h-4 w-4"/> Print Report</Button>
                </div>
                <div ref={printRef} className="bg-white p-8 rounded-lg shadow-lg">
                    <div className="text-center mb-8">
                        <h1 className="text-3xl font-bold">{project.name}</h1>
                        <p className="text-muted-foreground">Detailed Profitability Report</p>
                        <p className="text-sm text-muted-foreground mt-1">
                            Period: {formatDate(row.dateFrom)} to {formatDate(row.dateTo)} | Profile: {row.businessProfile}
                        </p>
                    </div>

                    <Card className="mb-6 bg-blue-50 border-blue-200">
                        <CardHeader><CardTitle>Summary</CardTitle></CardHeader>
                        <CardContent>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
                                <div className="p-2 bg-green-100 rounded-md"><p className="text-sm text-green-800">Stock Profit</p><p className="font-bold text-lg text-green-700">{formatAmount(totals.profit)}</p></div>
                                <div className="p-2 bg-cyan-100 rounded-md"><p className="text-sm text-cyan-800">Income & Commission</p><p className="font-bold text-lg text-cyan-700">{formatAmount(totals.income + totals.commission)}</p></div>
                                <div className="p-2 bg-red-100 rounded-md"><p className="text-sm text-red-800">Total Expenses</p><p className="font-bold text-lg text-red-700">{formatAmount(totals.expense)}</p></div>
                                <div className="p-2 bg-indigo-100 rounded-md"><p className="text-sm text-indigo-800">Net Profit</p><p className="font-bold text-lg text-indigo-700">{formatAmount(row.netProfit)}</p></div>
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="mb-6">
                        <CardHeader><CardTitle>Sales Details</CardTitle></CardHeader>
                        <CardContent>
                             <Table>
                                <TableHeader><TableRow><TableHead>Item</TableHead><TableHead>Party</TableHead><TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Sale Price</TableHead><TableHead className="text-right">Total Cost</TableHead><TableHead className="text-right">Profit</TableHead></TableRow></TableHeader>
                                <TableBody>
                                    {sales.map((item, index) => {
                                        const totalSale = item.price * item.quantity;
                                        const profit = totalSale - (item.cost || 0);
                                        return (
                                        <TableRow key={`${item.id}-${index}`}>
                                            <TableCell>{item.name}</TableCell>
                                            <TableCell>{item.partyName}</TableCell>
                                            <TableCell className="text-right">{item.quantity}</TableCell>
                                            <TableCell className="text-right">{formatAmount(item.price)}</TableCell>
                                            <TableCell className="text-right">{formatAmount(item.cost || 0)}</TableCell>
                                            <TableCell className="text-right font-semibold">{formatAmount(profit)}</TableCell>
                                        </TableRow>
                                    )})}
                                </TableBody>
                                <TableFooter>
                                    <TableRow>
                                        <TableCell colSpan={3} className="font-bold text-right">Total</TableCell>
                                        <TableCell className="font-bold text-right">{formatAmount(totals.sales)}</TableCell>
                                        <TableCell className="font-bold text-right">{formatAmount(totals.cost)}</TableCell>
                                        <TableCell className="font-bold text-right">{formatAmount(totals.profit)}</TableCell>
                                    </TableRow>
                                </TableFooter>
                            </Table>
                        </CardContent>
                    </Card>
                     <Card className="mb-6">
                        <CardHeader><CardTitle>Purchase Details</CardTitle></CardHeader>
                        <CardContent>
                             <Table>
                                <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Item</TableHead><TableHead>Party</TableHead><TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Cost Price</TableHead></TableRow></TableHeader>
                                <TableBody>
                                    {purchases.map((item, index) => (
                                        <TableRow key={`${item.id}-${index}`}>
                                            <TableCell>{formatDate(item.date)}</TableCell>
                                            <TableCell>{item.name}</TableCell>
                                            <TableCell>{item.partyName}</TableCell>
                                            <TableCell className="text-right">{item.quantity}</TableCell>
                                            <TableCell className="text-right">{formatAmount(item.price)}</TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                                <TableFooter>
                                    <TableRow>
                                        <TableCell colSpan={3} className="font-bold text-right">Total</TableCell>
                                        <TableCell className="font-bold text-right">{purchases.reduce((sum, item) => sum + item.quantity, 0)}</TableCell>
                                        <TableCell className="font-bold text-right">{formatAmount(totals.purchase)}</TableCell>
                                    </TableRow>
                                </TableFooter>
                            </Table>
                        </CardContent>
                    </Card>
                     <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <Card>
                            <CardHeader><CardTitle>Income (Commission)</CardTitle></CardHeader>
                            <CardContent>
                                <Table>
                                    <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Description</TableHead><TableHead>Party</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader>
                                    <TableBody>{commissions.map(tx => (<TableRow key={tx.id}><TableCell>{formatDate(tx.date)}</TableCell><TableCell>{tx.description}</TableCell><TableCell>{tx.partyName}</TableCell><TableCell className="text-right">{formatAmount(tx.amount)}</TableCell></TableRow>))}</TableBody>
                                    <TableFooter><TableRow><TableCell colSpan={3} className="font-bold text-right">Total</TableCell><TableCell className="font-bold text-right">{formatAmount(totals.commission)}</TableCell></TableRow></TableFooter>
                                </Table>
                            </CardContent>
                        </Card>
                        <Card>
                            <CardHeader><CardTitle>Other Income</CardTitle></CardHeader>
                            <CardContent>
                                <Table>
                                    <TableHeader><TableRow><TableHead>Description</TableHead><TableHead>Party</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader>
                                    <TableBody>{otherIncomes.map(tx => (<TableRow key={tx.id}><TableCell>{tx.description}</TableCell><TableCell>{tx.partyName}</TableCell><TableCell className="text-right">{formatAmount(tx.amount)}</TableCell></TableRow>))}</TableBody>
                                    <TableFooter><TableRow><TableCell colSpan={2} className="font-bold text-right">Total</TableCell><TableCell className="font-bold text-right">{formatAmount(totals.income)}</TableCell></TableRow></TableFooter>
                                </Table>
                            </CardContent>
                        </Card>
                    </div>
                     <Card className="mt-6">
                            <CardHeader><CardTitle>Expenses</CardTitle></CardHeader>
                            <CardContent>
                                <Table>
                                    <TableHeader><TableRow><TableHead>Description</TableHead><TableHead>Party</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader>
                                    <TableBody>{expenses.map(tx => (<TableRow key={tx.id}><TableCell>{tx.description}</TableCell><TableCell>{tx.partyName}</TableCell><TableCell className="text-right">{formatAmount(tx.amount)}</TableCell></TableRow>))}</TableBody>
                                    <TableFooter><TableRow><TableCell colSpan={2} className="font-bold text-right">Total</TableCell><TableCell className="font-bold text-right">{formatAmount(totals.expense)}</TableCell></TableRow></TableFooter>
                                </Table>
                            </CardContent>
                        </Card>
                </div>
            </div>
        </div>
    );
}

export default function Page() {
    return (
        <Suspense fallback={<div className="flex h-screen items-center justify-center"><Loader2 className="h-12 w-12 animate-spin text-primary" /></div>}>
            <DetailedReportContent />
        </Suspense>
    )
}
