'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, Printer, Edit, Trash2, MoreVertical, FileStack, Package, Receipt, Undo, Eye, ShoppingCart, Clock } from 'lucide-react';
import type { Transaction, Party, AppSettings, Quotation, Account } from '@/types';
import { subscribeToAllTransactions, deleteTransaction, updateTransaction, toggleTransaction } from '@/services/transactionService';
import { subscribeToParties } from '@/services/partyService';
import { getAppSettings } from '@/services/settingsService';
import { subscribeToQuotations, deleteQuotation } from '@/services/quotationService';
import { subscribeToAccounts } from '@/services/accountService';
import { formatDate, formatAmount } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from '@/components/ui/badge';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import InvoiceDialog from '@/components/pos/InvoiceDialog';
import QuotationDialog from '@/components/pos/QuotationDialog';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { collection, query, orderBy } from 'firebase/firestore';
import { db } from '@/lib/firebase';


export default function BillingPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [parties, setParties] = useState<Party[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);
  const [quotations, setQuotations] = useState<Quotation[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();
  const router = useRouter();

  const [filters, setFilters] = useState({
    dateFrom: '',
    dateTo: '',
    partyId: 'all',
    paymentStatus: 'all',
    deliveryStatus: 'all',
  });
  
  const [viewingInvoice, setViewingInvoice] = useState<Transaction | null>(null);
  const [viewingQuotation, setViewingQuotation] = useState<Quotation | null>(null);
  const invoiceRef = useRef<HTMLDivElement>(null);


  useEffect(() => {
    const unsubTransactions = subscribeToAllTransactions(setTransactions, (err) => toast({ variant: 'destructive', title: 'এই ইররটি ঠিক করে দাও', description: err.message }));
    const unsubParties = subscribeToParties(setParties, (err) => toast({ variant: 'destructive', title: 'Error fetching parties', description: err.message }));
    const unsubAccounts = subscribeToAccounts(setAccounts, (err) => toast({ variant: 'destructive', title: 'Error fetching accounts', description: err.message }));
    
    // Updated subscribeToQuotations with explicit ordering
    const unsubQuotations = subscribeToQuotations((data) => setQuotations(data), (err) => toast({ variant: 'destructive', title: 'Error fetching quotations', description: err.message }));

    getAppSettings().then(setAppSettings);

    const timer = setTimeout(() => setLoading(false), 500);

    return () => {
      unsubTransactions();
      unsubParties();
      unsubAccounts();
      unsubQuotations();
      clearTimeout(timer);
    };
  }, [toast]);
  
  const handlePrint = () => {
    const printable = invoiceRef.current; // This ref needs to be attached to the correct dialog
    if (printable) {
      const printWindow = window.open('', '_blank');
      printWindow?.document.write('<html><head><title>Print</title>');
      printWindow?.document.write('<link rel="stylesheet" href="https://unpkg.com/tailwindcss@^2/dist/tailwind.min.css">');
      printWindow?.document.write('</head><body class="p-4">');
      printWindow?.document.write(printable.innerHTML);
      printWindow?.document.write('</body></html>');
      printWindow?.document.close();
      printWindow?.print();
    }
  };


  const orders = useMemo(() => {
    return transactions.filter(t => (t.type === 'sale' || t.type === 'credit_sale'));
  }, [transactions]);
  
  const filteredOrders = useMemo(() => {
    return orders.filter(order => {
        if (filters.dateFrom && order.date < filters.dateFrom) return false;
        if (filters.dateTo && order.date > filters.dateTo) return false;
        if (filters.partyId !== 'all' && order.partyId !== filters.partyId) return false;

        if (filters.paymentStatus !== 'all') {
             const totalAmount = order.amount;
             const paidAmount = order.payments?.reduce((sum, p) => sum + p.amount, 0) || 0;
             const due = totalAmount - paidAmount;
             let status = 'unpaid';
             if (paidAmount > 0 && due > 0.01) status = 'partially paid';
             if (due <= 0.01) status = 'paid';
             if (order.type === 'credit_sale') status = 'credit';

             if (filters.paymentStatus !== status) return false;
        }

        if (filters.deliveryStatus !== 'all') {
            const status = order.status || 'pending';
             if (filters.deliveryStatus !== status) return false;
        }

        return true;
    })
  }, [orders, filters]);

  const handleDeleteOrder = async (id: string) => {
    try {
      await toggleTransaction(id, false);
      toast({ title: 'Success', description: 'Order has been disabled and can be restored from the Activity Log.' });
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Error', description: `Could not disable order: ${error.message}` });
    }
  }
  
  const handleDeleteQuotation = async (id: string) => {
    try {
      await deleteQuotation(id);
      toast({ title: 'Success', description: 'Quotation deleted successfully.' });
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Error', description: `Could not delete quotation: ${error.message}` });
    }
  }

  const handleUpdateStatus = async (id: string, status: 'pending' | 'delivered' | 'cancelled') => {
      try {
          await updateTransaction(id, { status });
          toast({ title: 'Success', description: `Order status updated to ${status}.`});
      } catch (error: any) {
           toast({ variant: 'destructive', title: 'Error', description: `Could not update status: ${error.message}` });
      }
  }
  
  const handleConvertToSale = (quotation: Quotation) => {
    const queryParams = new URLSearchParams({
      quotationId: quotation.id,
    });
    router.push(`/pos?${queryParams.toString()}`);
  }


  return (
    <main>
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
            allTransactions={transactions}
        />
         <QuotationDialog
            isOpen={!!viewingQuotation}
            onOpenChange={(open) => !open && setViewingQuotation(null)}
            quotation={viewingQuotation}
            appSettings={appSettings}
            onPrint={handlePrint}
            ref={invoiceRef}
        />
        <div className="mb-8">
            <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3"><FileStack/> Billing Center</h1>
            <p className="text-muted-foreground mt-1">Manage all your orders, quotations, and sale returns.</p>
        </div>

        <Tabs defaultValue="orders">
          <TabsList className="mb-4">
            <TabsTrigger value="orders"><Package className="mr-2 h-4 w-4"/>Orders</TabsTrigger>
            <TabsTrigger value="quotations"><Receipt className="mr-2 h-4 w-4"/>Quotations</TabsTrigger>
            <TabsTrigger value="sale_returns"><Undo className="mr-2 h-4 w-4"/>Sale Returns</TabsTrigger>
          </TabsList>
          <TabsContent value="orders">
            <Card>
                <CardHeader>
                    <CardTitle>All Sale Orders</CardTitle>
                    <CardDescription>View, filter, and manage all your sale orders.</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-6 p-4 border rounded-lg">
                        <div className="space-y-1"><Label>From</Label><Input type="date" value={filters.dateFrom} onChange={e => setFilters({...filters, dateFrom: e.target.value})}/></div>
                        <div className="space-y-1"><Label>To</Label><Input type="date" value={filters.dateTo} onChange={e => setFilters({...filters, dateTo: e.target.value})}/></div>
                        <div className="space-y-1"><Label>Party</Label>
                            <Select value={filters.partyId} onValueChange={v => setFilters({...filters, partyId: v})}>
                                <SelectTrigger><SelectValue/></SelectTrigger>
                                <SelectContent><SelectItem value="all">All Parties</SelectItem>{parties.map(p=><SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1"><Label>Payment Status</Label>
                             <Select value={filters.paymentStatus} onValueChange={v => setFilters({...filters, paymentStatus: v})}>
                                <SelectTrigger><SelectValue/></SelectTrigger>
                                <SelectContent><SelectItem value="all">All</SelectItem><SelectItem value="paid">Paid</SelectItem><SelectItem value="partially paid">Partially Paid</SelectItem><SelectItem value="unpaid">Unpaid</SelectItem><SelectItem value="credit">Credit</SelectItem></SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1"><Label>Delivery Status</Label>
                             <Select value={filters.deliveryStatus} onValueChange={v => setFilters({...filters, deliveryStatus: v})}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent><SelectItem value="all">All</SelectItem><SelectItem value="pending">Pending</SelectItem><SelectItem value="delivered">Delivered</SelectItem><SelectItem value="cancelled">Cancelled</SelectItem></SelectContent>
                            </Select>
                        </div>
                    </div>
                    <div className="rounded-md border overflow-x-auto">
                        <Table>
                            <TableHeader><TableRow><TableHead>Invoice #</TableHead><TableHead>Date</TableHead><TableHead>Party</TableHead><TableHead>Details</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Payment</TableHead><TableHead>Delivery</TableHead><TableHead>Order Date Status</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
                            <TableBody>
                                {loading ? (
                                    <TableRow><TableCell colSpan={9} className="h-24 text-center"><Loader2 className="animate-spin h-8 w-8 mx-auto"/></TableCell></TableRow>
                                ) : filteredOrders.length > 0 ? (
                                    filteredOrders.map(order => {
                                        const party = parties.find(p => p.id === order.partyId);
                                        const totalAmount = order.amount;
                                        const paidAmount = order.payments?.reduce((sum, p) => sum + p.amount, 0) || 0;
                                        const due = totalAmount - paidAmount;
                                        
                                        let paymentStatus: {label: string, color: 'green' | 'yellow' | 'red' | 'blue'} = {label: 'Unpaid', color: 'red'};
                                        if (order.type === 'credit_sale') {
                                            paymentStatus = {label: 'Credit', color: 'blue'}
                                        } else if (due <= 0.01) {
                                            paymentStatus = {label: 'Paid', color: 'green'}
                                        } else if (paidAmount > 0) {
                                            paymentStatus = {label: 'Partial', color: 'yellow'}
                                        }

                                        const deliveryStatus = order.status || 'pending';
                                        const isFutureOrder = order.date > new Date().toISOString().split('T')[0];

                                        return (
                                            <TableRow key={order.id}>
                                                <TableCell className="font-medium">{order.invoiceNumber?.replace('INV-','') || 'N/A'}</TableCell>
                                                <TableCell>{formatDate(order.date)}</TableCell>
                                                <TableCell>{party?.name || 'Walk-in Customer'}</TableCell>
                                                <TableCell className="text-sm text-muted-foreground">{order.items?.reduce((sum, i) => sum + i.quantity, 0) || 1} item(s)</TableCell>
                                                <TableCell className="text-right font-mono">{formatAmount(order.amount)}</TableCell>
                                                <TableCell><Badge variant={paymentStatus.color === 'green' ? 'default' : paymentStatus.color === 'yellow' ? 'secondary' : 'destructive'} className={`bg-${paymentStatus.color}-100 text-${paymentStatus.color}-700`}>{paymentStatus.label}</Badge></TableCell>
                                                <TableCell><Badge variant="outline">{deliveryStatus}</Badge></TableCell>
                                                <TableCell>
                                                    {isFutureOrder ? (
                                                        <Badge variant="outline" className="text-blue-600 border-blue-200"><Clock className="mr-1 h-3 w-3"/>Future</Badge>
                                                    ) : (
                                                        <Badge variant="secondary">Current</Badge>
                                                    )}
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    <DropdownMenu>
                                                        <DropdownMenuTrigger asChild><Button variant="ghost" size="icon"><MoreVertical className="h-4 w-4"/></Button></DropdownMenuTrigger>
                                                        <DropdownMenuContent align="end">
                                                            <DropdownMenuItem onClick={() => setViewingInvoice(order)}><Eye className="mr-2 h-4 w-4" />View Invoice</DropdownMenuItem>
                                                            <DropdownMenuItem onClick={() => router.push(`/pos?edit=${order.id}`)}><Edit className="mr-2 h-4 w-4"/>Edit Order</DropdownMenuItem>
                                                            <DropdownMenuItem onClick={() => handleUpdateStatus(order.id, 'delivered')}>Mark Delivered</DropdownMenuItem>
                                                            <DropdownMenuItem onClick={() => handleUpdateStatus(order.id, 'pending')}>Mark Pending</DropdownMenuItem>
                                                            <DropdownMenuItem onClick={() => handleUpdateStatus(order.id, 'cancelled')}>Mark Cancelled</DropdownMenuItem>
                                                            <AlertDialog>
                                                                <AlertDialogTrigger asChild><DropdownMenuItem onSelect={e => e.preventDefault()} className="text-destructive"><Trash2 className="mr-2 h-4 w-4"/>Disable Order</DropdownMenuItem></AlertDialogTrigger>
                                                                <AlertDialogContent>
                                                                    <AlertDialogHeader><AlertDialogTitle>Are you sure?</AlertDialogTitle><AlertDialogDescription>Disabling this order will mark it as inactive and move it to the activity log. You can view or restore it from there later.</AlertDialogDescription></AlertDialogHeader>
                                                                    <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={()=>handleDeleteOrder(order.id)}>Disable</AlertDialogAction></AlertDialogFooter>
                                                                </AlertDialogContent>
                                                            </AlertDialog>
                                                        </DropdownMenuContent>
                                                    </DropdownMenu>
                                                </TableCell>
                                            </TableRow>
                                        )
                                    })
                                ) : (
                                    <TableRow><TableCell colSpan={9} className="h-24 text-center">No orders found.</TableCell></TableRow>
                                )}
                            </TableBody>
                        </Table>
                    </div>
                </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="quotations">
             <Card>
                <CardHeader>
                    <div className="flex justify-between items-center">
                        <div className="space-y-1">
                            <CardTitle>Quotations</CardTitle>
                            <CardDescription>Manage all your price quotations.</CardDescription>
                        </div>
                        <Button asChild>
                            <Link href="/quotations/new">Create New Quotation</Link>
                        </Button>
                    </div>
                </CardHeader>
                <CardContent>
                    <div className="rounded-md border overflow-x-auto">
                        <Table>
                            <TableHeader><TableRow><TableHead>Quotation #</TableHead><TableHead>Date</TableHead><TableHead>Party</TableHead><TableHead>Items</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Amount</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
                            <TableBody>
                                {loading ? (
                                    <TableRow><TableCell colSpan={7} className="h-24 text-center"><Loader2 className="animate-spin h-8 w-8 mx-auto"/></TableCell></TableRow>
                                ) : quotations.length > 0 ? (
                                    quotations.map(q => (
                                        <TableRow key={q.id}>
                                            <TableCell>{q.quotationNumber}</TableCell>
                                            <TableCell>{formatDate(q.date)}</TableCell>
                                            <TableCell>{q.partyName}</TableCell>
                                            <TableCell>{q.items.length}</TableCell>
                                            <TableCell><Badge variant="secondary">{q.status}</Badge></TableCell>
                                            <TableCell className="text-right font-mono">{formatAmount(q.totalAmount)}</TableCell>
                                            <TableCell className="text-right">
                                                <DropdownMenu>
                                                    <DropdownMenuTrigger asChild><Button variant="ghost" size="icon"><MoreVertical className="h-4 w-4"/></Button></DropdownMenuTrigger>
                                                    <DropdownMenuContent align="end">
                                                        <DropdownMenuItem onClick={() => setViewingQuotation(q)}><Eye className="mr-2 h-4 w-4" />View/Print</DropdownMenuItem>
                                                        <DropdownMenuItem asChild><Link href={`/quotations/new?id=${q.id}`}><Edit className="mr-2 h-4 w-4"/>Edit</Link></DropdownMenuItem>
                                                         <DropdownMenuItem onClick={() => handleConvertToSale(q)}><ShoppingCart className="mr-2 h-4 w-4"/>Create Sale</DropdownMenuItem>
                                                        <AlertDialog>
                                                            <AlertDialogTrigger asChild><DropdownMenuItem onSelect={e => e.preventDefault()} className="text-destructive"><Trash2 className="mr-2 h-4 w-4"/>Delete</DropdownMenuItem></AlertDialogTrigger>
                                                            <AlertDialogContent>
                                                                <AlertDialogHeader><AlertDialogTitle>Are you sure?</AlertDialogTitle><AlertDialogDescription>This will permanently delete this quotation.</AlertDialogDescription></AlertDialogHeader>
                                                                <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => handleDeleteQuotation(q.id)}>Delete</AlertDialogAction></AlertDialogFooter>
                                                            </AlertDialogContent>
                                                        </AlertDialog>
                                                    </DropdownMenuContent>
                                                </DropdownMenu>
                                            </TableCell>
                                        </TableRow>
                                    ))
                                ) : (
                                    <TableRow><TableCell colSpan={7} className="h-24 text-center">No quotations found.</TableCell></TableRow>
                                )}
                            </TableBody>
                        </Table>
                    </div>
                </CardContent>
             </Card>
          </TabsContent>
          <TabsContent value="sale_returns">
             <Card>
                <CardHeader>
                    <div className="flex justify-between items-center">
                        <CardTitle>Sale Returns</CardTitle>
                        <Button asChild>
                            <Link href="/sale-returns/new">Create New Sale Return</Link>
                        </Button>
                    </div>
                    <CardDescription>Manage returned products and issue credit notes.</CardDescription>
                </CardHeader>
                <CardContent>
                    {/* Sale returns list will be implemented here */}
                    <div className="text-center py-12 text-muted-foreground">
                        <p>Sale returns listing coming soon.</p>
                    </div>
                </CardContent>
             </Card>
          </TabsContent>
        </Tabs>
      </main>
  );
}