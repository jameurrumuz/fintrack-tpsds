
'use client';

import { useEffect, useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { transactionTypeOptions, cn } from '@/lib/utils';
import type { Party, Transaction, Account, AppSettings } from '@/types';
import { format as formatFns, parseISO, isValid } from 'date-fns';
import { DatePicker } from './ui/date-picker';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from './ui/command';
import { Check, ChevronsUpDown } from 'lucide-react';

const editTransactionSchema = z.object({
  date: z.date(),
  description: z.string().min(1, 'Description is required'),
  amount: z.coerce.number().positive('Amount must be positive'),
  accountId: z.string().optional(),
  type: z.enum(['sale', 'purchase', 'income', 'spent', 'receive', 'give', 'credit_sale', 'credit_purchase', 'sale_return', 'purchase_return', 'credit_give', 'credit_income']),
  partyId: z.string().optional(),
  via: z.string().optional(),
}).superRefine((data, ctx) => {
    if (!['credit_sale', 'credit_purchase', 'credit_give', 'credit_income'].includes(data.type) && !data.accountId) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Account is required for this transaction type.',
            path: ['accountId'],
        });
    }
});

type FormValues = z.infer<typeof editTransactionSchema>;

interface EditTransactionDialogProps {
  transaction: Transaction | null;
  parties: Party[];
  accounts: Account[];
  appSettings: AppSettings | null;
  onOpenChange: (open: boolean) => void;
  onSave: (data: Omit<Transaction, 'id' | 'enabled'>) => void;
}

const PartyCombobox = ({ parties, value, onChange, placeholder = "Select a party..." }: { parties: Party[], value: string, onChange: (value: string) => void, placeholder?: string }) => {
    const [open, setOpen] = useState(false);
    const selectedParty = parties.find(p => p.id === value);

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={open}
                    className="w-full justify-between font-normal h-10"
                >
                    {value && selectedParty ? selectedParty.name : placeholder}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
                <Command>
                    <CommandInput placeholder="Search party..." />
                    <CommandList>
                        <CommandEmpty>Not found.</CommandEmpty>
                        <CommandGroup>
                            <CommandItem
                                key="none-party"
                                value="none"
                                onSelect={() => {
                                    onChange("none");
                                    setOpen(false);
                                }}
                            >
                                <Check className={cn("mr-2 h-4 w-4", value === "none" ? "opacity-100" : "opacity-0")} />
                                None
                            </CommandItem>
                            {parties.map((party) => (
                                <CommandItem
                                    key={party.id}
                                    value={`${party.name} ${party.phone}`}
                                    onSelect={() => {
                                        onChange(party.id);
                                        setOpen(false);
                                    }}
                                >
                                    <Check className={cn("mr-2 h-4 w-4", value === party.id ? "opacity-100" : "opacity-0")} />
                                    <div className="flex flex-col">
                                        <span className="font-medium">{party.name}</span>
                                        <span className="text-xs text-muted-foreground">{party.phone || 'No phone'}</span>
                                    </div>
                                </CommandItem>
                            ))}
                        </CommandGroup>
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    );
};

export default function EditTransactionDialog({ transaction, parties, accounts, appSettings, onOpenChange, onSave }: EditTransactionDialogProps) {
  const form = useForm<FormValues>({
    resolver: zodResolver(editTransactionSchema),
  });
  
  const transactionType = form.watch('type');

  useEffect(() => {
    if (transaction) {
      let safeDate = new Date();
      if (transaction.date) {
          const parsed = parseISO(transaction.date);
          if (isValid(parsed)) {
              safeDate = parsed;
          }
      }

      form.reset({
        date: safeDate,
        description: transaction.description || '',
        amount: transaction.amount || 0,
        accountId: transaction.accountId || '',
        type: transaction.type as any,
        partyId: transaction.partyId || 'none',
        via: transaction.via || '',
      });
    }
  }, [transaction, form]);

  const handleSubmit = (data: FormValues) => {
    const finalData = { 
        ...data,
        date: formatFns(data.date, 'yyyy-MM-dd'),
        partyId: data.partyId === 'none' ? undefined : data.partyId 
    };
    onSave(finalData as any);
  };

  if (!transaction || transaction.type === 'transfer') {
    return null;
  }
  
  const isCreditType = ['credit_sale', 'credit_purchase', 'credit_give', 'credit_income'].includes(transactionType);

  return (
    <Dialog open={!!transaction} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Edit Transaction</DialogTitle>
        </DialogHeader>
        {transaction && (
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                    <Label htmlFor="amount">Amount</Label>
                    <Input id="amount" type="number" step="0.01" {...form.register('amount')} />
                    {form.formState.errors.amount && <p className="text-red-500 text-xs">{form.formState.errors.amount.message}</p>}
                </div>
                 <div className="space-y-1">
                    <Label htmlFor="date">Date</Label>
                    <Controller
                        control={form.control}
                        name="date"
                        render={({ field }) => (
                            <DatePicker
                                value={field.value}
                                onChange={(date) => field.onChange(date as Date)}
                            />
                        )}
                    />
                    {form.formState.errors.date && <p className="text-red-500 text-xs">{form.formState.errors.date.message}</p>}
                </div>
            </div>
             <div className="space-y-1">
                <Label htmlFor="description">Description</Label>
                <Input id="description" {...form.register('description')} />
                {form.formState.errors.description && <p className="text-red-500 text-xs">{form.formState.errors.description.message}</p>}
            </div>
             <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                    <Label htmlFor="type">Type</Label>
                    <Controller name="type" control={form.control} render={({ field }) => (
                        <Select onValueChange={field.onChange} value={field.value}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>{transactionTypeOptions.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                        </Select>
                    )} />
                </div>
                {!isCreditType && (
                    <div className="space-y-1">
                        <Label htmlFor="accountId">Account</Label>
                        <Controller 
                            name="accountId" 
                            control={form.control} 
                            render={({ field }) => {
                                const selectedAccount = accounts.find(acc => acc.id === field.value);
                                return (
                                    <Select 
                                        onValueChange={field.onChange} 
                                        value={field.value || ""}
                                    >
                                        <SelectTrigger>
                                            <SelectValue placeholder="Select account...">
                                                {selectedAccount ? selectedAccount.name : "Select account..."}
                                            </SelectValue>
                                        </SelectTrigger>
                                        <SelectContent>
                                            {accounts.map(o => (
                                                <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                );
                            }} 
                        />
                         {form.formState.errors.accountId && <p className="text-red-500 text-xs mt-1">{form.formState.errors.accountId.message}</p>}
                    </div>
                )}
            </div>
             <div className="grid grid-cols-1 gap-4">
                <div className="space-y-1">
                    <Label htmlFor="partyId">Party (Customer/Supplier)</Label>
                     <Controller name="partyId" control={form.control} render={({ field }) => (
                         <PartyCombobox parties={parties} value={field.value || ''} onChange={field.onChange} />
                    )} />
                </div>
                 <div className="space-y-1">
                    <Label htmlFor="via">Business Profile (Via)</Label>
                     <Controller name="via" control={form.control} render={({ field }) => (
                         <Select onValueChange={field.onChange} value={field.value}>
                            <SelectTrigger><SelectValue placeholder="Select a profile..." /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="none">None</SelectItem>
                                {(appSettings?.businessProfiles || []).map(p => <SelectItem key={p.name} value={p.name}>{p.name}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    )} />
                </div>
            </div>
            <DialogFooter className="pt-4">
              <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
              <Button type="submit">Save Changes</Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
