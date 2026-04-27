'use client';

import React, { useState, useEffect, useMemo, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter } from '@/components/ui/table';
import { Loader2, Printer, Share2, ChevronsUpDown, Check, X } from 'lucide-react';
import type { Transaction, Account, Party, AppSettings, InventoryItem } from '@/types';
import { subscribeToAllTransactions } from '@/services/transactionService';
import { subscribeToAccounts } from '@/services/accountService';
import { subscribeToParties } from '@/services/partyService';
import { getAppSettings } from '@/services/settingsService';
import { subscribeToInventoryItems } from '@/services/inventoryService';
import { formatDate, formatAmount } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import Link from 'next/link';
import { format as formatFns } from 'date-fns';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const MultiPartySelect = ({ parties, selected, onChange }: { parties: Party[], selected: string[], onChange: (selected: string[]) => void }) => {
    const [open, setOpen] = useState(false);

    const handleSelect = (partyId: string) => {
        const newSelected = selected.includes(partyId)
            ? selected.filter(id => id !== partyId)
            : [...selected, partyId];
        onChange(newSelected);
    };

    const handleRemove = (e: React.MouseEvent, partyId: string) => {
        e.stopPropagation();
        const newSelected = selected.filter(id => id !== partyId);
        onChange(newSelected);
    };

    const selectedParties = selected.map(id => parties.find(party => party.id === id)).filter(Boolean) as Party[];

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button variant="outline" role="combobox" className="w-full justify-between font-normal h-auto min-h-10">
                    <div className="flex flex-wrap gap-1">
                        {selectedParties.length > 0 ? (
                            selectedParties.map(party => (
                                <Badge key={party.id} variant="secondary" className="pr-1">
                                    {party.name}
                                    <div role="button" tabIndex={0} className="ml-1 rounded-full" onClick={(e) => handleRemove(e, party.id)} onKeyDown={(e) => { if (e.key === "Enter") handleRemove(e, party.id); }}>
                                        <X className="h-3 w-3 text-muted-foreground hover:text-foreground" />
                                    </div>
                                </Badge>
                            ))
                        ) : (
                            "Select parties..."
                        )}
                    </div>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
                <Command>
                    <CommandInput placeholder="Search party..." />
                    <CommandList>
                        <CommandEmpty>No party found.</CommandEmpty>
                        <CommandGroup>
                            {parties.map((party) => (
                                <CommandItem key={party.id} value={party.name} onSelect={() => handleSelect(party.id)}>
                                    <Check className={cn("mr-2 h-4 w-4", selected.includes(party.id) ? "opacity-100" : "opacity-0")} />
                                    {party.name}
                                </CommandItem>
                            ))}
                        </CommandGroup>
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    );
};

const MultiProductSelect = ({ items, selected, onChange }: { items: InventoryItem[], selected: string[], onChange: (selected: string[]) => void }) => {
    const [open, setOpen] = useState(false);

    const handleSelect = (itemId: string) => {
        const newSelected = selected.includes(itemId)
            ? selected.filter(id => id !== itemId)
            : [...selected, itemId];
        onChange(newSelected);
    };

    const handleRemove = (e: React.MouseEvent, itemId: string) => {
        e.stopPropagation();
        const newSelected = selected.filter(id => id !== itemId);
        onChange(newSelected);
    };

    const selectedItems = selected.map(id => items.find(item => item.id === id)).filter(Boolean) as InventoryItem[];

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button variant="outline" role="combobox" className="w-full justify-between font-normal h-auto min-h-10">
                    <div className="flex flex-wrap gap-1">
                        {selectedItems.length > 0 ? (
                            selectedItems.map(item => (
                                <Badge key={item.id} variant="secondary" className="pr-1">
                                    {item.name}
                                    <div role="button" tabIndex={0} className="ml-1 rounded-full" onClick={(e) => handleRemove(e, item.id)} onKeyDown={(e) => { if (e.key === "Enter") handleRemove(e, item.id); }}>
                                        <X className="h-3 w-3 text-muted-foreground hover:text-foreground" />
                                    </div>
                                </Badge>
                            ))
                        ) : (
                            "Select products..."
                        )}
                    </div>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
                <Command>
                    <CommandInput placeholder="Search product..." />
                    <CommandList>
                        <CommandEmpty>No product found.</CommandEmpty>
                        <CommandGroup>
                            {items.map((item) => (
                                <CommandItem key={item.id} value={item.name} onSelect={() => handleSelect(item.id)}>
                                    <Check className={cn("mr-2 h-4 w-4", selected.includes(item.id) ? "opacity-100" : "opacity-0")} />
                                    {item.name}
                                </CommandItem>
                            ))}
                        </CommandGroup>
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    );
};

function PurchaseReportContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [parties, setParties] = useState<Party[]>([]);
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState(() => {
    return {
      dateFrom: searchParams.get('dateFrom') || formatFns(new Date(), 'yyyy-MM-dd'),
      dateTo: searchParams.get('dateTo') || formatFns(new Date(), 'yyyy-MM-dd'),
      via: searchParams.get('via') || 'all',
      partyIds: searchParams.get('partyIds')?.split(',') || [],
      productIds: searchParams.get('productIds')?.split(',') || [],
    };
  });
  const { toast } = useToast();

  useEffect(() => {
    const unsubTransactions = subscribeToAllTransactions(setTransactions, (err) => toast({ variant: 'destructive', title: 'Error', description: err.message }));
    const unsubAccounts = subscribeToAccounts(setAccounts, (err) => toast({ variant: 'destructive', title: 'Error', description: err.message }));
    const unsubParties = subscribeToParties(setParties, (err) => toast({ variant: 'destructive', title: 'Error', description: err.message }));
    const unsubInventory = subscribeToInventoryItems(setInventoryItems, (err) => toast({ variant: 'destructive', title: 'Error', description: err.message }));
    getAppSettings().then(setAppSettings);
    
    const timer = setTimeout(() => setLoading(false), 500);

    return () => {
      unsubTransactions();
      unsubAccounts();
      unsubParties();
      unsubInventory();
      clearTimeout(timer);
    };
  }, [toast]);

  const { filteredTransactions, totalPurchase } = useMemo(() => {
    const purchaseTransactions = transactions.filter(t => t.type === 'purchase' || t.type === 'credit_purchase');
    
    const filtered = purchaseTransactions.filter(t => {
      if (filters.dateFrom && t.date < filters.dateFrom) return false;
      if (filters.dateTo && t.date > filters.dateTo) return false;
      if (filters.via !== 'all' && t.via !== filters.via) return false;
      if (filters.partyIds.length > 0 && !filters.partyIds.includes(t.partyId || '')) return false;
      if (filters.productIds.length > 0 && !t.items?.some(item => filters.productIds.includes(item.id))) {
        return false;
      }
      return true;
    }).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    
    const total = filtered.reduce((sum, t) => sum + t.amount, 0);

    return { filteredTransactions: filtered, totalPurchase: total };
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
              <CardTitle>Purchase Report</CardTitle>
              <CardDescription>A detailed report of all recorded cash and credit purchases.</CardDescription>
            </div>
            <div className="flex gap-2 no-print">
              <Button onClick={handlePrint} variant="outline"><Printer className="mr-2 h-4 w-4" /> Print Report</Button>
              <Button disabled><Share2 className="mr-2 h-4 w-4" /> Share</Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6 p-4 border rounded-lg no-print">
            <div className="space-y-1"><Label>From</Label><Input type="date" value={filters.dateFrom} onChange={e => setFilters({...filters, dateFrom: e.target.value})} /></div>
            <div className="space-y-1"><Label>To</Label><Input type="date" value={filters.dateTo} onChange={e => setFilters({...filters, dateTo: e.target.value})} /></div>
            <div className="space-y-1"><Label>Transaction Via</Label>
                <Select value={filters.via} onValueChange={v => setFilters({...filters, via: v})}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All</SelectItem>
                        {appSettings?.businessProfiles.map(o => <SelectItem key={o.name} value={o.name}>{o.name}</SelectItem>)}
                    </SelectContent>
                </Select>
            </div>
             <div className="space-y-1"><Label>Party</Label>
                <MultiPartySelect parties={parties} selected={filters.partyIds} onChange={ids => setFilters(f => ({...f, partyIds: ids}))} />
            </div>
            <div className="space-y-1 lg:col-span-2"><Label>Product(s)</Label>
                <MultiProductSelect items={inventoryItems} selected={filters.productIds} onChange={ids => setFilters(f => ({...f, productIds: ids}))} />
            </div>
          </div>

          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Items</TableHead>
                  <TableHead>Party</TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead>Via</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={6} className="h-24 text-center"><Loader2 className="animate-spin h-8 w-8 mx-auto" /></TableCell></TableRow>
                ) : filteredTransactions.length > 0 ? (
                  filteredTransactions.map(t => (
                    <TableRow key={t.id}>
                      <TableCell>{formatDate(t.date)}</TableCell>
                      <TableCell>
                        <ul className="text-xs list-disc pl-4">
                          {t.items?.map((item, i) => (
                            <li key={`${item.id}-${i}`}>{item.name} ({item.quantity} x {formatAmount(item.price)})</li>
                          ))}
                           {!t.items && t.description}
                        </ul>
                      </TableCell>
                      <TableCell>{t.partyId ? parties.find(p => p.id === t.partyId)?.name : 'N/A'}</TableCell>
                      <TableCell>{t.accountId ? accounts.find(a => a.id === t.accountId)?.name : 'Credit'}</TableCell>
                      <TableCell>{t.via || 'N/A'}</TableCell>
                      <TableCell className="text-right font-mono text-red-600">{formatAmount(t.amount)}</TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow><TableCell colSpan={6} className="h-24 text-center">No purchases found for the selected criteria.</TableCell></TableRow>
                )}
              </TableBody>
               <TableFooter>
                <TableRow>
                    <TableCell colSpan={5} className="text-right font-bold">Total Purchase</TableCell>
                    <TableCell className="text-right font-bold font-mono text-red-600">{formatAmount(totalPurchase)}</TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </div>
        </CardContent>
      </Card>
    </>
  );
}

export default function PurchaseReportPage() {
  return (
    <Suspense fallback={<div className="flex h-screen items-center justify-center"><Loader2 className="h-10 w-10 animate-spin text-primary" /></div>}>
      <PurchaseReportContent />
    </Suspense>
  );
}
