'use client';

import { useState, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, Trash2, History, RotateCcw, AlertCircle, CheckCircle } from 'lucide-react';
import type { Transaction } from '@/types';
import { subscribeToAllTransactions, deleteTransaction, toggleTransaction, bulkDeleteTransactions, bulkRestoreTransactions } from '@/services/transactionService';
import { formatDate, formatAmount, transactionTypeOptions } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Checkbox } from '@/components/ui/checkbox';
import { format as formatFns, startOfMonth } from 'date-fns';

export default function ActivityLogPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const [filters, setFilters] = useState(() => {
    const today = new Date();
    const monthStart = startOfMonth(today);
    return {
      dateFrom: formatFns(monthStart, 'yyyy-MM-dd'),
      dateTo: formatFns(today, 'yyyy-MM-dd'),
      type: 'all',
      status: 'all' as 'all' | 'enabled' | 'disabled',
    };
  });
  
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const unsubTransactions = subscribeToAllTransactions(
        (data) => {
            setTransactions(data);
            setLoading(false);
        },
        (err) => {
            toast({ variant: 'destructive', title: 'এই ইররটি ঠিক করে দাও', description: err.message });
            setLoading(false);
        }
    );
    
    return () => {
      unsubTransactions();
    };
  }, [toast]);

  const filteredTransactions = useMemo(() => {
    return transactions.filter(t => {
      if (filters.dateFrom && t.date < filters.dateFrom) return false;
      if (filters.dateTo && t.date > filters.dateTo) return false;
      if (filters.type !== 'all' && t.type !== filters.type) return false;
      if (filters.status !== 'all') {
        if (filters.status === 'enabled' && !t.enabled) return false;
        if (filters.status === 'disabled' && t.enabled) return false;
      }
      return true;
    }).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [transactions, filters]);
  
  const handleFilterChange = (updates: Partial<typeof filters>) => {
      setFilters(prev => ({ ...prev, ...updates }));
      setSelectedIds(new Set());
  };


  const handleDelete = async (id: string) => {
    try {
      await deleteTransaction(id);
      toast({ title: 'Success', description: 'Transaction permanently deleted.' });
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Error', description: `Could not delete transaction: ${error.message}` });
    }
  };

  const handleToggle = async (id: string, currentState: boolean) => {
    try {
      await toggleTransaction(id, !currentState);
      toast({ title: 'Success', description: `Transaction has been ${!currentState ? 'restored' : 'disabled'}.` });
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Error', description: `Could not update transaction: ${error.message}` });
    }
  };

  const handleBulkRestore = async () => {
      try {
        await bulkRestoreTransactions(Array.from(selectedIds));
        toast({ title: 'Success', description: `${selectedIds.size} transactions restored.` });
        setSelectedIds(new Set());
      } catch (error: any) {
         toast({ variant: 'destructive', title: 'Error', description: `Could not restore transactions: ${error.message}` });
      }
  };

  const handleBulkDelete = async () => {
       try {
        await bulkDeleteTransactions(Array.from(selectedIds));
        toast({ title: 'Success', description: `${selectedIds.size} transactions permanently deleted.` });
        setSelectedIds(new Set());
      } catch (error: any) {
         toast({ variant: 'destructive', title: 'Error', description: `Could not delete transactions: ${error.message}` });
      }
  };
  
  const handleSelectAll = (checked: boolean) => {
    if (checked) {
        setSelectedIds(new Set(filteredTransactions.map(t => t.id)));
    } else {
        setSelectedIds(new Set());
    }
  };

  return (
    <div>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-3 text-2xl"><History /> Activity Log</CardTitle>
          <CardDescription>View all system activities and transactions. You can restore disabled entries or permanently delete them.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6 p-4 border rounded-lg">
            <div className="space-y-1"><Label>From</Label><Input type="date" value={filters.dateFrom} onChange={e => handleFilterChange({ dateFrom: e.target.value })} /></div>
            <div className="space-y-1"><Label>To</Label><Input type="date" value={filters.dateTo} onChange={e => handleFilterChange({ dateTo: e.target.value })} /></div>
            <div className="space-y-1"><Label>Type</Label>
              <Select value={filters.type} onValueChange={(v) => handleFilterChange({ type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  {transactionTypeOptions.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
             <div className="space-y-1">
                <Label>Status</Label>
                <Select value={filters.status} onValueChange={(v) => handleFilterChange({ status: v as any })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="enabled">Enabled</SelectItem>
                    <SelectItem value="disabled">Disabled</SelectItem>
                  </SelectContent>
                </Select>
              </div>
          </div>
          
           {selectedIds.size > 0 && (
                <div className="mb-4 flex items-center gap-4 p-3 bg-muted rounded-lg">
                    <p className="text-sm font-medium">{selectedIds.size} item(s) selected.</p>
                     <Button size="sm" onClick={handleBulkRestore}>
                        <RotateCcw className="mr-2 h-4 w-4"/> Restore Selected
                    </Button>
                    <AlertDialog>
                        <AlertDialogTrigger asChild>
                            <Button size="sm" variant="destructive">
                                <Trash2 className="mr-2 h-4 w-4"/> Delete Selected
                            </Button>
                        </AlertDialogTrigger>
                         <AlertDialogContent>
                            <AlertDialogHeader><AlertDialogTitle>Are you sure?</AlertDialogTitle><AlertDialogDescription>This will permanently delete the selected {selectedIds.size} transaction(s). This action cannot be undone.</AlertDialogDescription></AlertDialogHeader>
                            <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={handleBulkDelete}>Delete</AlertDialogAction></AlertDialogFooter>
                        </AlertDialogContent>
                    </AlertDialog>
                </div>
           )}

          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                   <TableHead className="w-12">
                     <Checkbox
                        checked={selectedIds.size > 0 && selectedIds.size === filteredTransactions.length}
                        onCheckedChange={(checked) => handleSelectAll(!!checked)}
                        aria-label="Select all"
                    />
                   </TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={7} className="h-24 text-center"><Loader2 className="animate-spin h-8 w-8 mx-auto" /></TableCell></TableRow>
                ) : filteredTransactions.length > 0 ? (
                  filteredTransactions.map(t => (
                    <TableRow key={t.id} className={cn(!t.enabled && 'bg-red-50/50 dark:bg-red-900/10 text-muted-foreground')}>
                        <TableCell>
                            <Checkbox
                                checked={selectedIds.has(t.id)}
                                onCheckedChange={(checked) => {
                                    setSelectedIds(prev => {
                                        const newSet = new Set(prev);
                                        if (checked) newSet.add(t.id);
                                        else newSet.delete(t.id);
                                        return newSet;
                                    })
                                }}
                                aria-label={`Select row ${t.id}`}
                            />
                        </TableCell>
                      <TableCell>{formatDate(t.date)}</TableCell>
                      <TableCell>{t.description}</TableCell>
                      <TableCell>{t.type}</TableCell>
                      <TableCell className="text-right font-mono">{formatAmount(t.amount)}</TableCell>
                      <TableCell>
                        <Badge variant={t.enabled ? 'default' : 'destructive'} className={cn(t.enabled && 'bg-green-100 text-green-700')}>
                          {t.enabled ? <CheckCircle className="mr-1 h-3 w-3" /> : <AlertCircle className="mr-1 h-3 w-3" />}
                          {t.enabled ? 'Enabled' : 'Disabled'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {!t.enabled && (
                          <Button variant="outline" size="sm" onClick={() => handleToggle(t.id, t.enabled)}>
                            <RotateCcw className="mr-2 h-4 w-4" /> Restore
                          </Button>
                        )}
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="icon" className="text-destructive ml-2">
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This will permanently delete this transaction record. This action cannot be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => handleDelete(t.id)}>Delete</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow><TableCell colSpan={7} className="h-24 text-center">No activities found for the selected criteria.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}