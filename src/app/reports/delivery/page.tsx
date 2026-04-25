'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Loader2, Printer, Share2, Truck, Wallet, FileText, ArrowRightLeft, DollarSign, CheckCircle2, Circle, Trash2, Edit, MoreVertical, ChevronLeft, ChevronRight } from 'lucide-react';
import type { Transaction, Party, Account, AppSettings } from '@/types';
import { subscribeToAllTransactions, addTransaction, updateTransaction, deleteTransaction } from '@/services/transactionService';
import { subscribeToParties } from '@/services/partyService';
import { subscribeToAccounts } from '@/services/accountService';
import { getAppSettings } from '@/services/settingsService';
import { formatDate, formatAmount } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import Link from 'next/link';
import { DatePicker } from '@/components/ui/date-picker';
import { format as formatFns, addDays } from 'date-fns';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { db } from '@/lib/firebase';
import { writeBatch, doc, collection } from 'firebase/firestore';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription as AlertDialogDescriptionComponent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Textarea } from '@/components/ui/textarea';


interface Delivery {
    transaction: Transaction;
    deliveryPerson: Party | { id: string; name: string };
    customer: Party | { id: string; name: string };
    itemCount: number;
}

const paymentSchema = z.object({
    date: z.string(),
    deliveryPersonId: z.string(),
    amount: z.coerce.number().positive(),
    accountId: z.string().min(1, 'Account is required'),
    via: z.string().min(1, 'Business profile is required'),
    paymentType: z.enum(['pay_now', 'record_due']),
    description: z.string().optional(),
    deliveryTransactionIds: z.array(z.string()).min(1),
});
type PaymentFormValues = z.infer<typeof paymentSchema>;

const PayDeliveryPersonDialog = ({ open, onOpenChange, deliveryPerson, accounts, unpaidDeliveries, onPaymentSuccess, initialVia, appSettings }: { open: boolean, onOpenChange: (open: boolean) => void, deliveryPerson: Party, accounts: Account[], unpaidDeliveries: Delivery[], onPaymentSuccess: () => void, initialVia: string, appSettings: AppSettings | null }) => {
    const { toast } = useToast();
    
    const totalDue = useMemo(() => unpaidDeliveries.reduce((sum, d) => sum + (d.transaction.deliveryCharge || 0) , 0), [unpaidDeliveries]);
    
    const generatedDescription = useMemo(() => {
        const totalItems = unpaidDeliveries.reduce((sum, d) => sum + (d.itemCount || 0), 0);
        
        const productSummary = unpaidDeliveries.reduce((acc, d) => {
            (d.transaction.items || []).forEach(item => {
                if (!acc[item.name]) acc[item.name] = 0;
                acc[item.name] += item.quantity;
            });
            return acc;
        }, {} as Record<string, number>);

        const detailsString = Object.entries(productSummary)
            .map(([name, qty]) => `${name}: ${qty} pcs`)
            .join(', ');

        return `Paid for ${totalItems} items (${detailsString}) to ${deliveryPerson.name}`;
    }, [unpaidDeliveries, deliveryPerson]);

    const form = useForm<PaymentFormValues>({
        resolver: zodResolver(paymentSchema),
        defaultValues: {
            date: new Date().toISOString().split('T')[0],
            deliveryPersonId: deliveryPerson.id,
            amount: parseFloat(totalDue.toFixed(2)),
            paymentType: 'pay_now',
            deliveryTransactionIds: unpaidDeliveries.map(d => d.transaction.id),
            via: initialVia === 'all' ? (appSettings?.businessProfiles[0]?.name || 'Personal') : initialVia,
            description: generatedDescription,
        },
    });
    
    useEffect(() => {
        form.setValue('amount', parseFloat(totalDue.toFixed(2)));
        form.setValue('deliveryTransactionIds', unpaidDeliveries.map(d => d.transaction.id));
        form.setValue('description', generatedDescription);
    }, [totalDue, unpaidDeliveries, generatedDescription, form]);


    const handlePayment = async (data: PaymentFormValues) => {
        if (!db) {
            toast({ variant: "destructive", title: "Error", description: "Database not configured." });
            return;
        }
        try {
            const batch = writeBatch(db);

            let tx: Omit<Transaction, 'id'>;
            const finalDescription = data.description || generatedDescription;

            if (data.paymentType === 'pay_now') {
                tx = {
                    type: 'spent',
                    description: finalDescription,
                    amount: data.amount,
                    date: data.date,
                    accountId: data.accountId,
                    partyId: data.deliveryPersonId,
                    via: data.via,
                    involvedAccounts: [data.accountId],
                    enabled: true,
                    deliveryTransactionIds: data.deliveryTransactionIds,
                };
            } else { // record_due
                tx = {
                    type: 'give',
                    description: finalDescription,
                    amount: data.amount,
                    date: data.date,
                    partyId: data.deliveryPersonId,
                    via: data.via,
                    involvedAccounts: [],
                    enabled: true,
                    deliveryTransactionIds: data.deliveryTransactionIds,
                };
            }
            const newTxRef = doc(collection(db, 'transactions'));
            batch.set(newTxRef, tx as any);
            
            for (const id of data.deliveryTransactionIds) {
                const txRef = doc(db, 'transactions', id);
                batch.update(txRef, { deliveryChargePaid: true });
            }
            
            await batch.commit();
            
            toast({ title: "Success", description: "Payment transaction recorded." });
            onPaymentSuccess();
            onOpenChange(false);
        } catch (error: any) {
            toast({ variant: "destructive", title: "Error", description: error.message });
        }
    };
    
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Pay Delivery Person: {deliveryPerson.name}</DialogTitle>
                </DialogHeader>
                <form onSubmit={form.handleSubmit(handlePayment)} className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div><Label>Amount Due</Label><Input type="number" step="0.01" {...form.register('amount')} /></div>
                        <div><Label>Date</Label><Input type="date" {...form.register('date')} /></div>
                    </div>
                    
                     <div><Label>Business Profile (Via)</Label>
                        <Controller name="via" control={form.control} render={({ field }) => (
                            <Select onValueChange={field.onChange} value={field.value}>
                                <SelectTrigger><SelectValue placeholder="Select business..." /></SelectTrigger>
                                <SelectContent>{appSettings?.businessProfiles.map(opt => <SelectItem key={opt.name} value={opt.name}>{opt.name}</SelectItem>)}</SelectContent>
                            </Select>
                        )} />
                        {form.formState.errors.via && <p className="text-xs text-destructive mt-1">{form.formState.errors.via.message}</p>}
                    </div>
                    <div><Label>Payment Type</Label>
                         <Controller name="paymentType" control={form.control} render={({ field }) => (
                            <Select onValueChange={field.onChange} value={field.value}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent><SelectItem value="pay_now">Pay Now (Expense)</SelectItem><SelectItem value="record_due">Record as Due (Payable)</SelectItem></SelectContent>
                            </Select>
                        )} />
                    </div>
                    {form.watch('paymentType') === 'pay_now' && (
                         <div><Label>From Account</Label>
                            <Controller name="accountId" control={form.control} render={({ field }) => (
                                <Select onValueChange={field.onChange} value={field.value}>
                                    <SelectTrigger><SelectValue placeholder="Select account..." /></SelectTrigger>
                                    <SelectContent>{accounts.map(acc => <SelectItem key={acc.id} value={acc.id}>{acc.name}</SelectItem>)}</SelectContent>
                                </Select>
                            )} />
                            {form.formState.errors.accountId && <p className="text-xs text-destructive mt-1">{form.formState.errors.accountId.message}</p>}
                        </div>
                    )}
                    <div>
                        <Label>Description</Label>
                        <Textarea 
                            {...form.register('description')} 
                            placeholder="Generated description will appear here..."
                            className="h-20"
                        />
                        <p className="text-xs text-muted-foreground mt-1">Automatically includes item counts per business.</p>
                    </div>
                    <DialogFooter>
                        <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
                        <Button type="submit">Confirm Payment</Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
};


const EditPaymentDialog = ({ payment, open, onOpenChange, accounts, appSettings, onSave }: { payment: Transaction | null; open: boolean; onOpenChange: (open: boolean) => void; accounts: Account[]; appSettings: AppSettings | null; onSave: (id: string, updates: Partial<Transaction>) => void; }) => {
    const [amount, setAmount] = useState(0);
    const [date, setDate] = useState('');
    const [accountId, setAccountId] = useState('');
    const [description, setDescription] = useState('');
    
    useEffect(() => {
        if(payment) {
            setAmount(payment.amount);
            setDate(payment.date);
            setAccountId(payment.accountId || '');
            setDescription(payment.description || '');
        }
    }, [payment]);
    
    if (!payment) return null;

    const handleSave = () => {
        const updates: Partial<Transaction> = {
            amount: amount,
            date: date,
            accountId: accountId,
            description: description,
        };
        onSave(payment.id, updates);
    }
    
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
             <DialogContent>
                <DialogHeader>
                    <DialogTitle>Edit Payment</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                    <div className="space-y-2"><Label>Amount</Label><Input type="number" value={amount} onChange={e => setAmount(parseFloat(e.target.value) || 0)} /></div>
                    <div className="space-y-2"><Label>Date</Label><Input type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
                    <div className="space-y-2"><Label>Account</Label>
                        <Select value={accountId} onValueChange={setAccountId}>
                            <SelectTrigger><SelectValue placeholder="Select account..."/></SelectTrigger>
                            <SelectContent>{accounts.map(acc => <SelectItem key={acc.id} value={acc.id}>{acc.name}</SelectItem>)}</SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-2"><Label>Description</Label><Textarea value={description} onChange={e => setDescription(e.target.value)} /></div>
                </div>
                 <DialogFooter>
                     <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
                    <Button onClick={handleSave}>Save Changes</Button>
                </DialogFooter>
             </DialogContent>
        </Dialog>
    )
}


export default function DeliveryReport() {
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [parties, setParties] = useState<Party[]>([]);
    const [accounts, setAccounts] = useState<Account[]>([]);
    const [appSettings, setAppSettings] = useState<AppSettings | null>(null);
    const [loading, setLoading] = useState(true);
    const { toast } = useToast();
    const [filters, setFilters] = useState({
        date: new Date(),
        deliveryPersonId: 'all',
        paymentStatus: 'all',
        via: 'all',
    });
    const [payingPerson, setPayingPerson] = useState<Party | null>(null);
    const [editingPayment, setEditingPayment] = useState<Transaction | null>(null);

    useEffect(() => {
        const unsubTransactions = subscribeToAllTransactions(setTransactions, (err) => toast({ variant: "destructive", title: 'এই ইররটি ঠিক করে দাও', description: err.message }));
        const unsubParties = subscribeToParties(setParties, (err) => toast({ variant: "destructive", title: 'Error fetching parties', description: err.message }));
        const unsubAccounts = subscribeToAccounts(setAccounts, (err) => toast({ variant: "destructive", title: 'Error fetching accounts', description: err.message }));
        getAppSettings().then(setAppSettings);
        setLoading(false);
        return () => { unsubTransactions(); unsubParties(); unsubAccounts(); };
    }, [toast]);
    
    const deliveryPersonnel = useMemo(() => {
        return parties.filter(p => p.partyType === 'Delivery');
    }, [parties]);

    const deliveryData: Delivery[] = useMemo(() => {
        const partyMap = new Map(parties.map(p => [p.id, p.name]));
        const selectedDateStr = formatFns(filters.date, 'yyyy-MM-dd');

        return transactions
            .filter(t => {
                if (!t.deliveredBy) return false;
                
                if (t.date !== selectedDateStr) return false;
                
                if (filters.deliveryPersonId !== 'all' && t.deliveredBy !== filters.deliveryPersonId) {
                    return false;
                }
                
                const isPaid = t.deliveryChargePaid || (t.deliveryCharge || 0) === 0;
                if (filters.paymentStatus !== 'all') {
                    if (filters.paymentStatus === 'paid' && !isPaid) return false;
                    if (filters.paymentStatus === 'unpaid' && isPaid) return false;
                }
                
                if(filters.via !== 'all' && t.via !== filters.via) return false;

                return true;
            })
            .map(t => ({
                transaction: t,
                deliveryPerson: parties.find(p => p.id === t.deliveredBy) || { id: t.deliveredBy!, name: 'Unknown / Deleted Person' },
                customer: parties.find(p => p.id === t.partyId) || { id: t.partyId || 'walkin', name: partyMap.get(t.partyId!) || 'Walk-in Customer' },
                itemCount: t.items?.reduce((sum, item) => sum + item.quantity, 0) || 0,
            }))
            .sort((a,b) => new Date(b.transaction.date).getTime() - new Date(a.transaction.date).getTime());
    }, [transactions, parties, filters]);

    const deliveriesByPerson = useMemo(() => {
        return deliveryData.reduce((acc, delivery) => {
            const personId = delivery.deliveryPerson.id;
            if (!acc[personId]) {
                acc[personId] = { person: delivery.deliveryPerson, deliveries: [] };
            }
            acc[personId].deliveries.push(delivery);
            return acc;
        }, {} as Record<string, { person: Party | {id: string, name: string}, deliveries: Delivery[] }>);
    }, [deliveryData]);
    
    const paymentsByDate = useMemo(() => {
        const paymentsMap = new Map<string, Transaction[]>();
        transactions.forEach(tx => {
            const isPayment = (tx.type === 'spent' || tx.type === 'give') && (tx.description?.toLowerCase().includes('delivery charge') || tx.deliveryTransactionIds?.length);
            const isDeliveryPerson = deliveryPersonnel.some(dp => dp.id === tx.partyId);

            if (isPayment && isDeliveryPerson && tx.partyId) {
                const date = tx.date;
                if (!paymentsMap.has(date)) {
                    paymentsMap.set(date, []);
                }
                paymentsMap.get(date)!.push(tx);
            }
        });
        
        const sortedMap = new Map([...paymentsMap.entries()].sort((a, b) => new Date(b[0]).getTime() - new Date(a[0]).getTime()));
        return sortedMap;
    }, [transactions, deliveryPersonnel]);


    const unpaidDeliveriesForPerson = (personId: string) => {
        return (deliveriesByPerson[personId]?.deliveries || []).filter(d => !d.transaction.deliveryChargePaid && (d.transaction.deliveryCharge || 0) > 0);
    };
    
    const handlePrint = () => window.print();
    
    const handleDateChange = (days: number) => {
        setFilters(f => ({
          ...f,
          date: addDays(f.date, days),
        }));
    };

    const handleDeletePayment = async (paymentTx: Transaction) => {
        if (!db) {
            toast({ variant: "destructive", title: "Database error" });
            return;
        }

        const batch = writeBatch(db);

        // Revert paid status on associated deliveries
        if (paymentTx.deliveryTransactionIds && paymentTx.deliveryTransactionIds.length > 0) {
            paymentTx.deliveryTransactionIds.forEach(id => {
                const txRef = doc(db, 'transactions', id);
                batch.update(txRef, { deliveryChargePaid: false });
            });
        }
        
        // Delete the payment transaction
        batch.delete(doc(db, 'transactions', paymentTx.id));

        try {
            await batch.commit();
            toast({ title: 'Payment Deleted', description: 'The payment has been deleted and delivery statuses have been updated.' });
        } catch (error: any) {
             toast({ variant: 'destructive', title: 'Error', description: `Could not delete payment: ${error.message}` });
        }
    };
    
    const handleSaveEdit = async (id: string, updates: Partial<Transaction>) => {
        try {
            await updateTransaction(id, updates);
            toast({ title: 'Success', description: 'Payment record updated successfully.' });
            setEditingPayment(null);
        } catch (error: any) {
             toast({ variant: 'destructive', title: 'Error', description: `Could not update payment: ${error.message}` });
        }
    }


    return (
        <div className="container mx-auto p-4 md:p-6 lg:p-8">
            <style>{`
                @media print {
                  body {
                    -webkit-print-color-adjust: exact;
                    print-color-adjust: exact;
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
                }
            `}</style>

            <div className="no-print">
                <div className="mb-6">
                    <Button variant="outline" asChild><Link href="/reports">← Back to Reports</Link></Button>
                </div>
            </div>
            
            {payingPerson && <PayDeliveryPersonDialog open={!!payingPerson} onOpenChange={() => setPayingPerson(null)} deliveryPerson={payingPerson} accounts={accounts} unpaidDeliveries={unpaidDeliveriesForPerson(payingPerson.id)} onPaymentSuccess={() => {}} initialVia={filters.via} appSettings={appSettings} />}
            <EditPaymentDialog open={!!editingPayment} onOpenChange={setEditingPayment} payment={editingPayment} accounts={accounts} appSettings={appSettings} onSave={handleSaveEdit} />

            <Card className="print-area">
                <CardHeader className="no-print">
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                        <div>
                            <CardTitle className="flex items-center gap-2"><Truck/> Delivery Payment</CardTitle>
                            <CardDescription>Track deliveries and manage payments for delivery personnel.</CardDescription>
                        </div>
                         <Button variant="outline" onClick={handlePrint}>
                            <Printer className="mr-2 h-4 w-4" /> Print Report
                        </Button>
                    </div>
                    <div className="flex flex-wrap gap-4 mt-4 p-4 border rounded-md items-end">
                        <div>
                            <Label>Date</Label>
                            <div className="flex items-center gap-2">
                                <Button variant="outline" size="icon" onClick={() => handleDateChange(-1)}>
                                    <ChevronLeft className="h-4 w-4" />
                                </Button>
                                <DatePicker value={filters.date} onChange={(date) => setFilters(f => ({...f, date: date || new Date() }))} />
                                <Button variant="outline" size="icon" onClick={() => handleDateChange(1)}>
                                    <ChevronRight className="h-4 w-4" />
                                </Button>
                            </div>
                        </div>
                        <div>
                            <Label>Delivery Person</Label>
                            <Select value={filters.deliveryPersonId} onValueChange={(v) => setFilters(f => ({...f, deliveryPersonId: v}))}>
                                <SelectTrigger className="w-full sm:w-[180px]"><SelectValue placeholder="All People"/></SelectTrigger>
                                <SelectContent><SelectItem value="all">All People</SelectItem>{deliveryPersonnel.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
                            </Select>
                        </div>
                        <div>
                            <Label>Payment Status</Label>
                            <Select value={filters.paymentStatus} onValueChange={(v) => setFilters(f => ({...f, paymentStatus: v}))}>
                                <SelectTrigger className="w-full sm:w-[180px]"><SelectValue /></SelectTrigger>
                                <SelectContent><SelectItem value="all">All</SelectItem><SelectItem value="paid">Paid</SelectItem><SelectItem value="unpaid">Unpaid</SelectItem></SelectContent>
                            </Select>
                        </div>
                        <div>
                            <Label>Business</Label>
                            <Select value={filters.via} onValueChange={(v) => setFilters(f => ({...f, via: v}))}>
                                <SelectTrigger className="w-full sm:w-[180px]"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All</SelectItem>
                                    {appSettings?.businessProfiles.map(o => <SelectItem key={o.name} value={o.name}>{o.name}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    {loading ? (
                         <div className="flex justify-center items-center h-48"><Loader2 className="animate-spin h-8 w-8 text-primary" /></div>
                    ) : Object.keys(deliveriesByPerson).length > 0 ? (
                        <div className="space-y-6">
                            {Object.entries(deliveriesByPerson).map(([personId, { person, deliveries }]) => {
                                const unpaid = unpaidDeliveriesForPerson(personId);
                                const totalDeliveryCharge = deliveries.reduce((sum, d) => sum + (d.transaction.deliveryCharge || 0), 0);

                                return (
                                <Card key={personId} className="bg-muted/50">
                                    <CardHeader className="flex flex-row items-center justify-between no-print">
                                        <CardTitle>{person.name}</CardTitle>
                                        <Button size="sm" onClick={() => setPayingPerson(person as Party)} disabled={!(person as Party).partyType || unpaid.length === 0}>
                                            <DollarSign className="mr-2 h-4 w-4"/>
                                            Pay / Record Due ({unpaid.length})
                                        </Button>
                                    </CardHeader>
                                    <CardContent className="pt-4">
                                        <div className="print-area">
                                            <h4 className="font-semibold mb-2">Deliveries</h4>
                                            <Table>
                                                <TableHeader>
                                                    <TableRow>
                                                        <TableHead>Date</TableHead>
                                                        <TableHead>Customer</TableHead>
                                                        <TableHead>Invoice #</TableHead>
                                                        <TableHead className="text-right">Items</TableHead>
                                                        <TableHead className="text-right">Delivery Charge</TableHead>
                                                        <TableHead>Payment Status</TableHead>
                                                    </TableRow>
                                                </TableHeader>
                                                <TableBody>
                                                    {deliveries.map(d => {
                                                         const isPaid = d.transaction.deliveryChargePaid || (d.transaction.deliveryCharge || 0) === 0;
                                                        return (
                                                        <TableRow key={d.transaction.id}>
                                                            <TableCell>{formatDate(d.transaction.date)}</TableCell>
                                                            <TableCell>{d.customer.name}</TableCell>
                                                            <TableCell>{d.transaction.invoiceNumber?.replace('INV-','')}</TableCell>
                                                            <TableCell className="text-right">{d.itemCount}</TableCell>
                                                            <TableCell className="text-right">{formatAmount(d.transaction.deliveryCharge || 0)}</TableCell>
                                                            <TableCell>
                                                                <Badge variant={isPaid ? "default" : "secondary"} className={cn(isPaid && 'bg-green-100 text-green-700')}>
                                                                    {isPaid ? <CheckCircle2 className="mr-1 h-3 w-3" /> : <Circle className="mr-1 h-3 w-3" />}
                                                                    {isPaid ? "Paid" : "Unpaid"}
                                                                </Badge>
                                                            </TableCell>
                                                        </TableRow>
                                                    )})}
                                                </TableBody>
                                                 <TableFooter>
                                                    <TableRow>
                                                        <TableCell colSpan={4} className="text-right font-bold">Total Delivery Charge</TableCell>
                                                        <TableCell className="text-right font-bold">{formatAmount(totalDeliveryCharge)}</TableCell>
                                                        <TableCell></TableCell>
                                                    </TableRow>
                                                </TableFooter>
                                            </Table>
                                        </div>
                                        
                                        {Array.from(paymentsByDate.keys()).map(date => {
                                            const payments = paymentsByDate.get(date)?.filter(p => p.partyId === person.id) || [];
                                            if (payments.length === 0) return null;
                                            
                                            return (
                                                <div key={`${person.id}-${date}`} className="mt-6 print-area">
                                                    <h4 className="font-semibold mb-2">Payments made on {formatDate(date)}</h4>
                                                    <Table>
                                                        <TableHeader>
                                                            <TableRow>
                                                            <TableHead>Description</TableHead>
                                                            <TableHead className="text-right">Amount</TableHead>
                                                            <TableHead className="text-right no-print">Actions</TableHead>
                                                            </TableRow>
                                                        </TableHeader>
                                                        <TableBody>
                                                            {payments.map(p => (
                                                                <TableRow key={p.id}>
                                                                    <TableCell>{p.description}</TableCell>
                                                                    <TableCell className="text-right">{formatAmount(p.amount)}</TableCell>
                                                                    <TableCell className="text-right no-print">
                                                                       <DropdownMenu>
                                                                            <DropdownMenuTrigger asChild>
                                                                                <Button variant="ghost" size="icon" className="h-7 w-7"><MoreVertical className="h-4 w-4"/></Button>
                                                                            </DropdownMenuTrigger>
                                                                            <DropdownMenuContent>
                                                                                <DropdownMenuItem onClick={() => setEditingPayment(p)}><Edit className="mr-2 h-4 w-4"/> Edit</DropdownMenuItem>
                                                                                <AlertDialog>
                                                                                    <AlertDialogTrigger asChild>
                                                                                        <DropdownMenuItem onSelect={(e) => e.preventDefault()} className="text-destructive"><Trash2 className="mr-2 h-4 w-4"/>Delete</DropdownMenuItem>
                                                                                    </AlertDialogTrigger>
                                                                                    <AlertDialogContent>
                                                                                        <AlertDialogHeader><AlertDialogTitle>Delete Payment?</AlertDialogTitle><AlertDialogDescriptionComponent>This will delete the payment and mark associated deliveries as unpaid. This can be undone by re-creating the payment.</AlertDialogDescriptionComponent></AlertDialogHeader>
                                                                                        <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => handleDeletePayment(p)}>Delete</AlertDialogAction></AlertDialogFooter>
                                                                                    </AlertDialogContent>
                                                                                </AlertDialog>
                                                                            </DropdownMenuContent>
                                                                       </DropdownMenu>
                                                                    </TableCell>
                                                                </TableRow>
                                                            ))}
                                                        </TableBody>
                                                    </Table>
                                                </div>
                                            )
                                        })}

                                    </CardContent>
                                </Card>
                            )})}
                        </div>
                    ) : (
                        <div className="text-center py-16">
                            <h3 className="text-xl font-semibold">No Deliveries Found</h3>
                            <p className="text-muted-foreground mt-2">There are no delivery records for the selected period.</p>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
