'use client';

import { useEffect, useMemo, useState } from 'react';
import { useForm, Controller, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { transactionTypeOptions, formatAmount, cleanUndefined } from '@/lib/utils';
import type { Party, Transaction, Account, InventoryItem, AppSettings } from '@/types';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter } from './ui/table';
import { Trash2, Plus, Check, ChevronsUpDown, Truck } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from './ui/command';
import { cn } from '@/lib/utils';
import { DatePicker } from './ui/date-picker';
import { format as formatFns } from 'date-fns';


const itemSchema = z.object({
    id: z.string(),
    name: z.string(),
    quantity: z.coerce.number().positive(),
    price: z.coerce.number().min(0), // For sales, this is sale price. For purchases, this is COST price.
    cost: z.coerce.number().optional(), // For sales, this is historical FIFO cost. For purchases, this is not directly used but stored.
    wholesalePrice: z.coerce.number().optional(),
    location: z.string().optional(),
    batchNumber: z.string().optional(),
    expiryDate: z.string().optional(),
});

const editTransactionSchema = z.object({
  date: z.date(),
  description: z.string().min(1, 'Description is required'),
  amount: z.coerce.number(), // Amount will be derived from items for item-based tx, so not strictly positive here
  accountId: z.string().optional(),
  type: z.enum(['sale', 'purchase', 'income', 'spent', 'receive', 'give', 'credit_sale', 'credit_purchase', 'sale_return', 'purchase_return', 'credit_give', 'credit_income']),
  partyId: z.string().optional(),
  items: z.array(itemSchema).optional(),
  deliveredBy: z.string().optional(),
  via: z.string().optional(),
}).superRefine((data, ctx) => {
    const isAccountNeeded = !['credit_sale', 'credit_purchase', 'credit_give', 'credit_income'].includes(data.type);
    if (isAccountNeeded && !data.accountId) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Account is required for this transaction type.',
            path: ['accountId'],
        });
    }
    const hasItems = data.items && data.items.length > 0;
    if (hasItems) {
        const totalAmount = data.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        if (totalAmount <= 0) {
             ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'Total amount for items must be positive.',
                path: ['amount'],
            });
        }
    } else if (!hasItems && !['credit_sale', 'credit_purchase', 'credit_give', 'credit_income'].includes(data.type)) {
      if (data.amount <= 0) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Amount must be positive.',
            path: ['amount'],
        });
      }
    }
});

type FormValues = z.infer<typeof editTransactionSchema>;

interface PartyTransactionEditDialogProps {
  transaction: Transaction | null;
  parties: Party[];
  accounts: Account[];
  inventoryItems: InventoryItem[];
  onOpenChange: (open: boolean) => void;
  onSave: (data: Omit<Transaction, 'id' | 'enabled'>) => void;
  appSettings?: AppSettings | null;
}

const ItemCombobox = ({ items, onSelect, className }: { items: InventoryItem[], onSelect: (item: InventoryItem | null) => void, className?: string }) => {
    const [open, setOpen] = useState(false);
    const [value, setValue] = useState("");

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button variant="outline" role="combobox" aria-expanded={open} className={cn("w-full justify-between font-normal", className)}>
                    {value ? items.find((item) => item.name === value)?.name : "Select item..."}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[320px] p-0" align="start">
                <Command>
                    <CommandInput placeholder="Search item..." />
                    <CommandList>
                        <CommandEmpty>No item found.</CommandEmpty>
                        <CommandGroup>
                            {items.map((item) => (
                                <CommandItem
                                    key={item.id}
                                    value={item.name}
                                    onSelect={(currentValue) => {
                                        const selected = items.find(i => i.name === currentValue);
                                        setValue(selected ? selected.name : "");
                                        onSelect(selected || null);
                                        setOpen(false);
                                    }}
                                >
                                    <Check className={cn("mr-2 h-4 w-4", value === item.name ? "opacity-100" : "opacity-0")} />
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
            <PopoverContent className="w-[350px] p-0" align="start">
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


export default function PartyTransactionEditDialog({ transaction, parties, accounts, inventoryItems, onOpenChange, onSave, appSettings }: PartyTransactionEditDialogProps) {
  const form = useForm<FormValues>({
    resolver: zodResolver(editTransactionSchema),
  });
  
  const { control, register, handleSubmit, watch, setValue, getValues } = form;

  const { fields, append, remove } = useFieldArray({
      control: form.control,
      name: "items"
  });

  const transactionType = watch('type');
  const items = watch('items');
  const deliveryPersonnel = useMemo(() => parties.filter(p => p.partyType === 'Delivery'), [parties]);
  
  const inventoryMap = useMemo(() => new Map(inventoryItems.map(i => [i.id, i])), [inventoryItems]);

  const isPurchase = useMemo(() => ['purchase', 'credit_purchase', 'purchase_return'].includes(transactionType), [transactionType]);
  const isSale = useMemo(() => ['sale', 'credit_sale', 'sale_return'].includes(transactionType), [transactionType]);


  useEffect(() => {
    if (transaction) {
      
      const formItems = (transaction.items || []).map(txItem => {
          return {
              id: txItem.id,
              name: txItem.name,
              quantity: txItem.quantity,
              price: txItem.price,
              cost: txItem.cost || 0,
              wholesalePrice: inventoryItems.find(i => i.id === txItem.id)?.wholesalePrice || 0,
              location: txItem.location || appSettings?.inventoryLocations?.[0] || 'default',
              batchNumber: txItem.batchNumber || '',
              expiryDate: txItem.expiryDate || '',
          }
      })

      form.reset({
        date: new Date(transaction.date),
        description: transaction.description,
        amount: transaction.amount,
        accountId: transaction.accountId || '',
        type: transaction.type as any,
        partyId: transaction.partyId,
        items: formItems,
        deliveredBy: transaction.deliveredBy || '',
        via: transaction.via || '',
      });
    }
  }, [transaction, appSettings, inventoryItems, form]);
  
 useEffect(() => {
    const isItemBasedTx = ['sale', 'purchase', 'credit_sale', 'credit_purchase', 'sale_return', 'purchase_return'].includes(transactionType);
    if (isItemBasedTx && items && items.length > 0) {
        const totalAmount = items.reduce((sum, item) => {
            const quantity = Number(item.quantity) || 0;
            const priceToUse = item.price || 0;
            return sum + (priceToUse * quantity);
        }, 0);
        setValue('amount', totalAmount, { shouldValidate: true });
    }
}, [items, setValue, transactionType]);


  const handleSubmitAndSave = (data: FormValues) => {
    const finalData = { 
        ...data,
        date: formatFns(data.date, 'yyyy-MM-dd'),
        partyId: data.partyId === 'none' ? undefined : data.partyId,
        deliveredBy: data.deliveredBy === 'none' ? undefined : data.deliveredBy,
    };
    onSave(cleanUndefined(finalData));
  };
  
  const handleAddItem = (item: InventoryItem | null) => {
    if (item) {
        append({
            id: item.id,
            name: item.name,
            quantity: 1,
            price: isPurchase ? item.cost : item.price,
            cost: item.cost,
            wholesalePrice: item.wholesalePrice,
            location: item.location || appSettings?.inventoryLocations?.[0] || '',
            batchNumber: '',
            expiryDate: '',
        });
    }
  };

  if (!transaction) {
    return null;
  }
  
  const isItemBased = ['sale', 'purchase', 'credit_sale', 'credit_purchase', 'sale_return', 'purchase_return'].includes(transactionType);

  return (
    <Dialog open={!!transaction} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Transaction</DialogTitle>
        </DialogHeader>
        {transaction && (
          <form onSubmit={handleSubmit(handleSubmitAndSave)} className="space-y-4 py-4">
            <div className="space-y-1"><Label>Description</Label><Input {...register('description')} /></div>
            <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1"><Label>Date</Label>
                  <Controller
                    control={control}
                    name="date"
                    render={({ field }) => (
                        <DatePicker
                            value={field.value}
                            onChange={(date) => field.onChange(date as Date)}
                        />
                    )}
                  />
                </div>
                <div className="space-y-1"><Label>Type</Label>
                    <Controller name="type" control={control} render={({ field }) => (
                        <Select onValueChange={field.onChange} value={field.value}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>{transactionTypeOptions.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                        </Select>
                    )} />
                </div>
            </div>
             <div className="space-y-1">
                <Label>Party (Customer/Supplier)</Label>
                <Controller name="partyId" control={control} render={({ field }) => (
                    <PartyCombobox parties={parties} value={field.value || ''} onChange={field.onChange} />
                )} />
            </div>

            {isItemBased ? (
              <div className="space-y-4">
                <Label>Items</Label>
                <div className="border rounded-md overflow-x-auto">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead className="min-w-[150px]">Item</TableHead>
                                <TableHead className="w-[120px] text-right">Qty</TableHead>
                                {isSale && <TableHead className="w-[150px] text-right">Cost Price</TableHead>}
                                <TableHead className="w-[150px] text-right">{isPurchase ? "Cost Price" : "Sale Price"}</TableHead>
                                <TableHead className="min-w-[150px]">Location</TableHead>
                                <TableHead className="w-12"></TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {fields.map((field, index) => {
                                return (
                                <TableRow key={field.id}>
                                    <TableCell>{field.name}</TableCell>
                                    <TableCell>
                                        <Input type="number" {...register(`items.${index}.quantity`)} className="min-w-[120px] text-right" />
                                    </TableCell>
                                    {isSale && (
                                        <TableCell>
                                            <Input type="number" step="0.01" {...register(`items.${index}.cost`)} className="text-right" readOnly />
                                        </TableCell>
                                    )}
                                    <TableCell>
                                        <Input type="number" step="0.01" {...register(`items.${index}.price`)} className="text-right min-w-[150px]" />
                                    </TableCell>
                                    <TableCell>
                                        <Controller
                                            name={`items.${index}.location`}
                                            control={control}
                                            defaultValue={field.location || appSettings?.inventoryLocations?.[0] || 'default'}
                                            render={({ field }) => (
                                                <Select onValueChange={field.onChange} value={field.value}>
                                                    <SelectTrigger><SelectValue placeholder="Location..." /></SelectTrigger>
                                                    <SelectContent>
                                                        {(appSettings?.inventoryLocations || ['default']).map(loc => (
                                                            <SelectItem key={loc} value={loc}>{loc}</SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            )}
                                        />
                                    </TableCell>
                                    <TableCell><Button type="button" variant="ghost" size="icon" onClick={() => remove(index)}><Trash2 className="h-4 w-4 text-destructive"/></Button></TableCell>
                                </TableRow>
                            )})}
                        </TableBody>
                    </Table>
                </div>
                 <div className="flex gap-2">
                     <ItemCombobox items={inventoryItems} onSelect={handleAddItem} className="flex-grow" />
                </div>
                <div className="flex justify-end">
                  <div className="text-right">
                    <p className="text-sm text-muted-foreground">{isPurchase ? 'Total Purchase' : 'Total Sale'}</p>
                    <p className="text-xl font-bold">{formatAmount(form.watch('amount'))}</p>
                  </div>
                </div>
              </div>
            ) : (
                <div className="space-y-1"><Label>Amount</Label><Input type="number" step="0.01" {...register('amount')} /></div>
            )}
            
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                  <Label>Account</Label>
                  <Controller name="accountId" control={control} render={({ field }) => (
                      <Select onValueChange={field.onChange} value={field.value || ''} disabled={transactionType === 'credit_sale' || transactionType === 'credit_purchase' || transactionType === 'credit_give' || transactionType === 'credit_income'}>
                          <SelectTrigger><SelectValue placeholder="Select account..." /></SelectTrigger>
                          <SelectContent>{accounts.map(o => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}</SelectContent>
                      </Select>
                  )} />
                  {form.formState.errors.accountId && <p className="text-red-500 text-xs mt-1">{form.formState.errors.accountId.message}</p>}
              </div>

               <div className="space-y-1">
                    <Label>Business Profile (Via)</Label>
                    <Controller name="via" control={control} render={({ field }) => (
                        <Select onValueChange={field.onChange} value={field.value || ''}>
                            <SelectTrigger><SelectValue placeholder="Select profile..." /></SelectTrigger>
                            <SelectContent>
                                {(appSettings?.businessProfiles || []).map(p => <SelectItem key={p.name} value={p.name}>{p.name}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    )} />
                </div>

              {isItemBased && (
                 <div className="space-y-1">
                    <Label className="flex items-center gap-2"><Truck/> Delivered By</Label>
                    <Controller name="deliveredBy" control={control} render={({ field }) => (
                        <Select onValueChange={field.onChange} value={field.value || 'none'}>
                            <SelectTrigger><SelectValue placeholder="Select delivery person..." /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="none">None</SelectItem>
                                {deliveryPersonnel.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    )} />
                </div>
              )}
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
