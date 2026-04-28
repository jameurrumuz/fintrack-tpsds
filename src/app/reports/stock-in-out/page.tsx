'use client';

import * as React from 'react';
import { useState, useEffect, useMemo, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter } from '@/components/ui/table';
import { Loader2, Printer, Share2, Repeat, ArrowUp, ArrowDown, Search, Check, ChevronsUpDown, X } from 'lucide-react';
import type { Transaction, Party, AppSettings, InventoryItem } from '@/types';
import { subscribeToAllTransactions } from '@/services/transactionService';
import { subscribeToParties } from '@/services/partyService';
import { getAppSettings } from '@/services/settingsService';
import { subscribeToInventoryItems } from '@/services/inventoryService';
import { formatDate } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';


interface StockMovement {
  id: string;
  date: string;
  itemName: string;
  type: 'in' | 'out';
  quantity: number;
  partyId?: string;
  partyName: string;
  via?: string;
}

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
    }

    const selectedItems = selected.map(id => items.find(item => item.id === id)).filter(Boolean) as InventoryItem[];

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button variant="outline" role="combobox" aria-expanded={open} className="w-full justify-between font-normal h-auto min-h-10">
                    <div className="flex flex-wrap gap-1">
                        {selectedItems.length > 0 ? (
                             selectedItems.map(item => (
                                <Badge key={item.id} variant="secondary" className="pr-1">
                                    {item.name}
                                    <div
                                        role="button"
                                        tabIndex={0}
                                        className="ml-1 rounded-full outline-none ring-offset-background focus:ring-2 focus:ring-ring focus:ring-offset-2"
                                        onClick={(e) => handleRemove(e, item.id)}
                                        onKeyDown={(e) => {
                                            if (e.key === "Enter" || e.key === " ") {
                                                handleRemove(e, item.id);
                                            }
                                        }}
                                    >
                                        <X className="h-3 w-3 text-muted-foreground hover:text-foreground" />
                                        <span className="sr-only">Remove {item.name}</span>
                                    </div>
                                </Badge>
                            ))
                        ) : (
                           "Select or search products..."
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
                                <CommandItem
                                    key={item.id}
                                    value={item.name}
                                    onSelect={() => handleSelect(item.id)}
                                >
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
                                <CommandItem
                                    key={party.id}
                                    value={party.name}
                                    onSelect={() => handleSelect(party.id)}
                                >
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


function StockInOutReportContent() {
  const searchParams = useSearchParams();
  const productNameFromQuery = searchParams.get('productName') || '';
  const partyIdsFromQuery = searchParams.get('partyIds') || '';
  const dateFromFromQuery = searchParams.get('dateFrom') || '';
  const dateToFromQuery = searchParams.get('dateTo') || '';

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [parties, setParties] = useState<Party[]>([]);
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    dateFrom: '',
    dateTo: '',
    via: 'all',
    productIds: [] as string[],
    movementType: 'all' as 'all' | 'in' | 'out',
    partyIds: [] as string[],
  });
  const { toast } = useToast();
  
  useEffect(() => {
    if (productNameFromQuery && inventoryItems.length > 0 && filters.productIds.length === 0) {
        const item = inventoryItems.find(i => i.name.toLowerCase() === productNameFromQuery.toLowerCase());
        if (item) {
            setFilters(f => ({ ...f, productIds: [item.id] }));
        }
    }
    
    if ((partyIdsFromQuery || dateFromFromQuery || dateToFromQuery) && !loading) {
        setFilters(f => ({
            ...f,
            partyIds: partyIdsFromQuery ? partyIdsFromQuery.split(',') : f.partyIds,
            dateFrom: dateFromFromQuery || f.dateFrom,
            dateTo: dateToFromQuery || f.dateTo,
        }));
    }
}, [productNameFromQuery, partyIdsFromQuery, dateFromFromQuery, dateToFromQuery, inventoryItems, loading]);


  useEffect(() => {
    const unsubTransactions = subscribeToAllTransactions(setTransactions, (err) => toast({ variant: 'destructive', title: 'Error', description: err.message }));
    const unsubParties = subscribeToParties(setParties, (err) => toast({ variant: 'destructive', title: 'Error', description: err.message }));
    const unsubInventory = subscribeToInventoryItems(setInventoryItems, (err) => toast({ variant: 'destructive', title: 'Error', description: err.message }));
    getAppSettings().then(setAppSettings);
    
    const timer = setTimeout(() => setLoading(false), 500);
    return () => {
      unsubTransactions();
      unsubParties();
      unsubInventory();
      clearTimeout(timer);
    };
  }, [toast]);

  const { stockMovements, totalIn, totalOut } = useMemo(() => {
    const movements: StockMovement[] = [];
    
    const partyMap = new Map(parties.map(p => [p.id, p.name]));

    const filteredTxs = transactions.filter(t => {
      if (filters.via !== 'all' && t.via !== filters.via) return false;
      if (filters.dateFrom && t.date < filters.dateFrom) return false;
      if (filters.dateTo && t.date > filters.dateTo) return false;
      if (filters.partyIds.length > 0 && !filters.partyIds.includes(t.partyId || '')) return false;
      return true;
    });

    filteredTxs.forEach(t => {
      if (t.items && t.items.length > 0) {
        
        let type: 'in' | 'out' | null = null;
        if (['purchase', 'credit_purchase', 'sale_return'].includes(t.type)) {
          type = 'in';
        } else if (['sale', 'credit_sale', 'purchase_return'].includes(t.type)) {
          type = 'out';
        }

        if (type && (filters.movementType === 'all' || filters.movementType === type)) {
          t.items.forEach((item, index) => {
            if (filters.productIds.length > 0 && !filters.productIds.includes(item.id)) {
                return;
            }
            movements.push({
              id: `${t.id}-${index}`,
              date: t.date,
              itemName: item.name,
              type: type!,
              quantity: item.quantity,
              partyId: t.partyId,
              partyName: t.partyId ? (partyMap.get(t.partyId) || 'Unknown Party') : 'N/A',
              via: t.via,
            });
          });
        }
      }
    });

    const sortedMovements = movements.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    
    const totalIn = sortedMovements.filter(m => m.type === 'in').reduce((sum, m) => sum + m.quantity, 0);
    const totalOut = sortedMovements.filter(m => m.type === 'out').reduce((sum, m) => sum + m.quantity, 0);

    return { stockMovements: sortedMovements, totalIn, totalOut };
  }, [transactions, parties, filters]);

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
              <CardTitle className="flex items-center gap-2"><Repeat />Stock In/Out Report</CardTitle>
              <CardDescription>Track all product movements (sold, added).</CardDescription>
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
            <div className="space-y-1"><Label>Business Profile</Label>
                <Select value={filters.via} onValueChange={v => setFilters({...filters, via: v})}>
                    <SelectTrigger><SelectValue placeholder="Select via..." /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All</SelectItem>
                        {appSettings?.businessProfiles.map(o => <SelectItem key={o.name} value={o.name}>{o.name}</SelectItem>)}
                    </SelectContent>
                </Select>
            </div>
            <div className="space-y-1"><Label>Party</Label>
              <MultiPartySelect
                parties={parties}
                selected={filters.partyIds}
                onChange={ids => setFilters(f => ({...f, partyIds: ids}))}
              />
            </div>
             <div className="space-y-1 lg:col-span-2"><Label>Product Name(s)</Label>
                <MultiProductSelect 
                  items={inventoryItems}
                  selected={filters.productIds} 
                  onChange={ids => setFilters({...filters, productIds: ids})}
                />
            </div>
             <div className="space-y-1"><Label>Movement Type</Label>
                <Select value={filters.movementType} onValueChange={v => setFilters({...filters, movementType: v as any})}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All</SelectItem>
                        <SelectItem value="in">Stock In</SelectItem>
                        <SelectItem value="out">Stock Out</SelectItem>
                    </SelectContent>
                </Select>
            </div>
          </div>

          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Product Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-center">Quantity</TableHead>
                  <TableHead>Party</TableHead>
                  <TableHead>Business</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={6} className="h-24 text-center"><Loader2 className="animate-spin h-8 w-8 mx-auto" /></TableCell></TableRow>
                ) : stockMovements.length > 0 ? (
                  stockMovements.map(item => (
                    <TableRow key={item.id}>
                      <TableCell>{formatDate(item.date)}</TableCell>
                      <TableCell className="font-medium">{item.itemName}</TableCell>
                      <TableCell>
                        {item.type === 'in' ? (
                          <Badge variant="outline" className="text-green-600 border-green-200 bg-green-50">
                            <ArrowDown className="mr-1 h-3 w-3"/> IN
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-red-600 border-red-200 bg-red-50">
                            <ArrowUp className="mr-1 h-3 w-3"/> OUT
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-center font-mono">{item.quantity}</TableCell>
                      <TableCell>
                        {item.partyId ? (
                            <Link href={`/parties/${item.partyId}`} className="hover:underline text-primary">
                                {item.partyName}
                            </Link>
                        ) : (
                            item.partyName
                        )}
                      </TableCell>
                      <TableCell><Badge variant="secondary">{item.via}</Badge></TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow><TableCell colSpan={6} className="h-24 text-center">No stock movements found for the selected criteria.</TableCell></TableRow>
                )}
              </TableBody>
               <TableFooter>
                <TableRow>
                  <TableCell colSpan={3} className="text-right font-bold">Totals:</TableCell>
                  <TableCell colSpan={3} className="text-left font-mono font-bold space-x-4">
                    <span className="text-green-600">In: {totalIn}</span>
                    <span className="text-red-600">Out: {totalOut}</span>
                  </TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </div>
        </CardContent>
      </Card>
    </>
  );
}


export default function StockInOutReport() {
    return (
        <Suspense fallback={<div className="flex h-screen items-center justify-center"><Loader2 className="h-10 w-10 animate-spin text-primary" /></div>}>
            <StockInOutReportContent />
        </Suspense>
    );
}