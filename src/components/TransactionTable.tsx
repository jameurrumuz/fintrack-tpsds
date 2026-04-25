"use client"

import * as React from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Transaction, Account, Party } from '@/types';
import { formatAmount, getEffectiveAmount, formatDate, formatBalance } from '@/lib/utils';
import { 
  Edit, 
  Trash2, 
  ArrowUpCircle, 
  ArrowDownCircle, 
  MinusCircle,
  Tag,
  ShoppingCart,
  Wallet,
  CreditCard,
  FileText,
  Landmark,
  ArrowRightLeft,
  User,
  Zap,
  MoreVertical,
  Eye,
  RefreshCcw,
} from 'lucide-react';
import { transactionTypeOptions } from '@/lib/utils';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from './ui/dropdown-menu';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { useToast } from '@/hooks/use-toast';
import { recalculateBalancesFromTransaction } from '@/services/transactionService';

export interface GroupedTransaction {
  date: string;
  transactions: (Transaction & { closingBalance: number })[];
}

interface TransactionTableProps {
  groupedTransactions: GroupedTransaction[];
  accounts: Account[];
  parties: Party[];
  onEdit: (transaction: Transaction) => void;
  onDelete: (id: string) => void;
  onToggle: (id: string, enabled: boolean) => void;
  onViewInvoice: (transaction: Transaction) => void;
  openingBalance: number;
  isDateFilterActive: boolean;
}

const TransactionTypeBadge = ({ type }: { type: Transaction['type'] }) => {
  const iconProps = { className: "h-4 w-4" };

  const typeInfo = transactionTypeOptions.find(opt => opt.value === type) || { label: 'Unknown', icon: <MinusCircle {...iconProps} /> };

  const colors: Record<string, string> = {
    sale: "text-green-600 bg-green-50 border-green-200",
    purchase: "text-red-600 bg-red-50 border-red-200",
    income: "text-green-600 bg-green-50 border-green-200",
    spent: "text-red-600 bg-red-50 border-red-200",
    receive: "text-blue-600 bg-blue-50 border-blue-200",
    give: "text-orange-600 bg-orange-50 border-orange-200",
    credit_sale: "text-purple-600 bg-purple-50 border-purple-200",
    transfer: "text-gray-600 bg-gray-100 border-gray-200",
    default: "text-gray-600 bg-gray-100 border-gray-200",
  };

  const icons: Record<string, React.ElementType> = {
    sale: Tag,
    purchase: ShoppingCart,
    income: Wallet,
    spent: CreditCard,
    receive: ArrowUpCircle,
    give: ArrowDownCircle,
    credit_sale: FileText,
    transfer: ArrowRightLeft,
  };

  const IconComponent = icons[type] || MinusCircle;
  const label = type === 'transfer' ? 'Transfer' : typeInfo.label;
  const colorClass = colors[type] || colors.default;

  return (
    <Badge variant="outline" className={cn("flex items-center justify-center gap-1.5", colorClass)}>
      <IconComponent {...iconProps} />
      <span className="hidden sm:inline">{label}</span>
    </Badge>
  );
};


export default function TransactionTable({ groupedTransactions, accounts, parties, onEdit, onDelete, onToggle, onViewInvoice, openingBalance, isDateFilterActive }: TransactionTableProps) {
  const { toast } = useToast();
  let currentMonth: number | null = null;
  let colorToggle = false;

  const handleRecalculateFrom = async (date: string) => {
    toast({ title: "Recalculation Started", description: `Recalculating all balances from ${formatDate(date)}...` });
    try {
      await recalculateBalancesFromTransaction(date);
      toast({ title: "Success!", description: "All account balances have been resynced." });
    } catch (error: any) {
      toast({ variant: 'destructive', title: "Error", description: `Recalculation failed: ${error.message}` });
    }
  }
  
  const getAccountName = (accountId?: string) => {
    if (!accountId) return '-';
    return accounts.find(a => a.id === accountId)?.name || 'N/A';
  }

  const getPartyName = (partyId?: string) => {
    if (!partyId) return 'Walk-in Customer';
    return parties.find(p => p.id === partyId)?.name || 'N/A';
  }

  const renderAccountInfo = (transaction: Transaction) => {
    if (transaction.type === 'transfer') {
        const from = getAccountName(transaction.fromAccountId);
        const to = getAccountName(transaction.toAccountId);
        return `${from} → ${to}`;
    }
    if (transaction.type === 'sale' && transaction.payments && transaction.payments.length > 0) {
        if (transaction.payments.length === 1) {
            return getAccountName(transaction.payments[0].accountId);
        }
        return transaction.payments.map(p => getAccountName(p.accountId)).join(', ');
    }
    return getAccountName(transaction.accountId);
  }

  return (
    <div className="rounded-lg border bg-card text-card-foreground shadow-sm overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[30px] p-1 text-center text-[10px] sm:w-[40px] sm:px-2 sm:py-3 sm:text-xs">SL</TableHead>
            <TableHead className="p-1 text-[10px] sm:px-2 sm:py-3 sm:text-xs min-w-[200px]">Description</TableHead>
            <TableHead className="p-1 text-[10px] sm:px-2 sm:py-3 sm:text-xs">Type</TableHead>
            <TableHead className="text-right p-1 text-[10px] sm:px-2 sm:py-3 sm:text-xs">Amount</TableHead>
            <TableHead className="text-right p-1 text-[10px] sm:px-2 sm:py-3 sm:text-xs">Balance</TableHead>
            <TableHead className="text-center p-1 text-[10px] sm:px-2 sm:py-3 sm:text-xs">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isDateFilterActive && (
              <TableRow key="opening-balance-row" className="bg-muted/50 hover:bg-muted/50">
                  <TableCell colSpan={4} className="font-bold text-right p-2">Opening Balance</TableCell>
                  <TableCell className="text-right font-bold font-mono p-2">{formatBalance(openingBalance)}</TableCell>
                  <TableCell></TableCell>
              </TableRow>
          )}
          {groupedTransactions.length > 0 ? (
            groupedTransactions.map((group, groupIndex) => {
              const groupDate = new Date(group.date);
              const month = groupDate.getMonth();

              if(currentMonth !== month){
                currentMonth = month;
                colorToggle = !colorToggle;
              }
              const monthColorClass = colorToggle ? 'bg-blue-50/30 dark:bg-blue-900/10' : 'bg-transparent';

              return (
              <React.Fragment key={group.date}>
                <TableRow key={`date-header-${group.date}`} className="bg-primary/10 hover:bg-primary/20 sticky top-0 z-10">
                  <TableCell colSpan={6} className="p-2">
                    <div className="flex justify-between items-center">
                        <h3 className="font-bold text-lg text-primary">{formatDate(group.date)}</h3>
                    </div>
                  </TableCell>
                </TableRow>
                {group.transactions.map((t, index) => {
                  const effectiveAmount = getEffectiveAmount(t);
                  const isTransfer = t.type === 'transfer';
                  const isInvoice = (t.type === 'sale' || t.type === 'credit_sale') && t.invoiceNumber;
                  const accountInfo = renderAccountInfo(t);
                  const description = t.description || (t.type === 'sale' ? `Sale to ${getPartyName(t.partyId)}` : t.type === 'credit_sale' ? `Credit Sale to ${getPartyName(t.partyId)}` : `Transaction`);

                  return (
                    <TableRow 
                      key={t.id} 
                      data-state={!t.enabled ? 'disabled' : ''} 
                      className={cn('data-[state=disabled]:text-muted-foreground data-[state=disabled]:opacity-60', monthColorClass)}
                    >
                      <TableCell className="p-1 text-center text-[11px] sm:p-2 sm:text-sm">{index + 1}</TableCell>
                      <TableCell className="p-1 text-[11px] sm:p-2 sm:text-sm">
                        <div className="font-medium">{description}</div>
                         <div className="text-xs text-muted-foreground flex items-center gap-2 mt-1">
                             {t.partyId && (
                               <div className="flex items-center gap-1"><User className="h-3 w-3" />{getPartyName(t.partyId)}</div>
                             )}
                              {(t as any).charge > 0 && (
                                <TooltipProvider>
                                    <Tooltip>
                                        <TooltipTrigger>
                                            <div className="flex items-center gap-1"><Zap className="h-3 w-3 text-yellow-500" />Charge Applied</div>
                                        </TooltipTrigger>
                                        <TooltipContent>Via: {t.via}</TooltipContent>
                                    </Tooltip>
                                </TooltipProvider>
                              )}
                              {isInvoice && (
                                <Button variant="link" size="sm" className="p-0 h-auto" onClick={() => onViewInvoice(t)}>
                                  <Eye className="mr-1 h-3 w-3" /> View Invoice
                                </Button>
                              )}
                         </div>
                      </TableCell>
                      <TableCell className="p-1 text-[11px] sm:p-2 sm:text-sm text-center">
                        <TransactionTypeBadge type={t.type} />
                      </TableCell>
                       <TableCell className={`text-right font-mono p-1 text-[11px] sm:px-2 sm:py-2 sm:text-sm`}>
                         <div className={cn('flex flex-col items-end', effectiveAmount >= 0 ? 'text-green-600' : 'text-red-600')}>
                            <span>{formatAmount(t.amount)}</span>
                            <Badge variant="outline" className="text-xs mt-1">{accountInfo}</Badge>
                         </div>
                      </TableCell>
                      <TableCell className={`text-right font-mono p-1 text-[11px] sm:px-2 sm:py-2 sm:text-sm`}>
                        {formatBalance(t.closingBalance)}
                      </TableCell>
                      <TableCell className="p-1 text-center">
                        <div className="flex items-center justify-center gap-0 sm:gap-1">
                           <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button variant="ghost" size="icon" className="h-8 w-8"><MoreVertical className="h-4 w-4" /></Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                    <DropdownMenuItem onClick={() => onEdit(t)} disabled={isTransfer}><Edit className="mr-2 h-4 w-4"/>Edit</DropdownMenuItem>
                                     <AlertDialog>
                                        <AlertDialogTrigger asChild>
                                           <DropdownMenuItem className="text-destructive" onSelect={(e) => e.preventDefault()}><Trash2 className="mr-2 h-4 w-4"/>Disable</DropdownMenuItem>
                                        </AlertDialogTrigger>
                                        <AlertDialogContent>
                                            <AlertDialogHeader>
                                                <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                                                <AlertDialogDescription>This will disable the transaction. You can restore it from the Activity Log.</AlertDialogDescription>
                                            </AlertDialogHeader>
                                            <AlertDialogFooter>
                                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                <AlertDialogAction onClick={() => onDelete(t.id)}>Disable Transaction</AlertDialogAction>
                                            </AlertDialogFooter>
                                        </AlertDialogContent>
                                    </AlertDialog>
                                    <DropdownMenuItem onClick={() => handleRecalculateFrom(t.date)}>
                                        <RefreshCcw className="mr-2 h-4 w-4 text-blue-500" />
                                        Recalculate From Here
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                            <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <div className="h-8 w-8 flex items-center justify-center">
                                      <Switch
                                          className="transform scale-75"
                                          checked={t.enabled}
                                          onCheckedChange={(checked) => onToggle(t.id, checked)}
                                          aria-label="Toggle Transaction"
                                        />
                                    </div>
                                  </TooltipTrigger>
                                  <TooltipContent>{t.enabled ? 'Disable' : 'Enable'} Transaction</TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </React.Fragment>
            )})
          ) : (
            <TableRow key="no-transactions-row">
              <TableCell colSpan={6} className="h-24 text-center">
                No transactions found for the selected period. Use filters to see other transactions.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}