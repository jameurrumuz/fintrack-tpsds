'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger, DialogClose, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { Plus, Trash2, Save, Users, Loader2, Copy, MessageSquare, Phone, Building, Calendar as CalendarIcon, PhoneCall, MapPin, Eye, ShoppingCart, ArrowRightLeft, CheckCircle2, ArrowLeft, ChevronsUpDown, Check } from 'lucide-react';
import { collection, onSnapshot, addDoc, doc, setDoc, deleteDoc, query, orderBy, getDocs, serverTimestamp, Timestamp, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Separator } from '@/components/ui/separator';
import { addTransaction } from '@/services/transactionService';
import { addInventoryItem, updateInventoryItem } from '@/services/inventoryService';
import type { Account, Party, InventoryItem, TransactionVia, AppSettings, BusinessProfile } from '@/types';
import { subscribeToAccounts } from '@/services/accountService';
import { getAppSettings } from '@/services/settingsService';
import { formatAmount, formatDate } from '@/lib/utils';
import { useFieldArray, useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger, AlertDialogDescription as AlertDialogDescriptionComponent, AlertDialogFooter } from "@/components/ui/alert-dialog";
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { DatePicker } from '@/components/ui/date-picker';


interface Product {
  id: string;
  name: string;
  price: number;
  cost: number;
  wholesalePrice?: number;
  quantity: number;
}

interface Supplier {
  id: string;
  name: string;
  phone: string;
  address: string;
  group?: string; // Add group to supplier type
}

interface OrderItem {
  id: string;
  productId?: string;
  name: string;
  price: number;
  quantity: number;
  currentStock: number;
  isNew?: boolean;
}

interface PurchaseOrder {
    id: string;
    orderDate: string;
    supplier: { id: string; name: string; phone: string; address: string; group?: string; };
    items: Omit<OrderItem, 'id'>[];
    totalAmount: number;
    totalProducts: number;
    createdAt: any;
    via: TransactionVia;
    status?: 'completed' | 'pending';
}

const purchaseItemSchema = z.object({
  productId: z.string().optional(),
  name: z.string().min(1, "Name is required"),
  quantity: z.coerce.number().positive(),
  price: z.coerce.number().min(0), // This is cost price
  salePrice: z.coerce.number().min(0),
  wholesalePrice: z.coerce.number().min(0).optional(),
  isNew: z.boolean().optional(),
  location: z.string().optional(),
});


const createPurchaseSchema = z.object({
  purchaseType: z.enum(['purchase', 'credit_purchase']),
  accountId: z.string().optional(),
  paymentDate: z.date().optional(),
  receiveDate: z.date(),
  items: z.array(purchaseItemSchema).min(1, 'At least one item is required'),
}).superRefine((data, ctx) => {
    if (data.purchaseType === 'purchase' && !data.accountId) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Account is required for cash purchase.', path: ['accountId'] });
    }
});
type CreatePurchaseFormValues = z.infer<typeof createPurchaseSchema>;


const CreatePurchaseFromPODialog = ({ po, onOpenChange, accounts, parties, products, via, appSettings }: { po: PurchaseOrder; onOpenChange: (open: boolean) => void; accounts: Account[]; parties: Party[], products: Product[], via: TransactionVia, appSettings: AppSettings | null }) => {
    const { toast } = useToast();
    const [isSaving, setIsSaving] = useState(false);
    
    const party = useMemo(() => parties.find(p => p.id === po.supplier.id), [parties, po.supplier.id]);

    const form = useForm<CreatePurchaseFormValues>({
        resolver: zodResolver(createPurchaseSchema),
        defaultValues: {
            purchaseType: 'credit_purchase',
            receiveDate: new Date(),
            items: po.items.map(item => {
                const product = products.find(p => p.id === item.productId || p.name === item.name);
                return { 
                    ...item, 
                    productId: item.productId || product?.id || '',
                    salePrice: product?.price || 0,
                    wholesalePrice: product?.wholesalePrice || 0,
                    isNew: !product,
                    location: appSettings?.inventoryLocations?.[0] || 'default',
                };
            })
        }
    });
    
    const { control, handleSubmit, setValue, register, formState: { errors } } = form;

    const { fields, append, remove } = useFieldArray({
        control,
        name: "items"
    });

    const purchaseType = form.watch('purchaseType');
    const items = form.watch('items');
    const totalAmount = useMemo(() => items.reduce((sum, item) => sum + (item.price * item.quantity), 0), [items]);
    
    const handleConfirmPurchase = async (data: CreatePurchaseFormValues) => {
        if (!party) {
            toast({ variant: 'destructive', title: 'Error', description: 'Supplier party not found in your contacts.'});
            return;
        }
        setIsSaving(true);
        try {
            const finalItems = [];

            // First, handle inventory updates and creation
            for (const item of data.items) {
                let actualId = item.productId;
                if (item.isNew && item.productId?.startsWith('new-')) { // Check if it's a truly new item
                    const newId = await addInventoryItem({
                        name: item.name,
                        sku: `NEW-${Date.now()}`,
                        category: 'Uncategorized',
                        price: item.salePrice,
                        cost: item.price,
                        wholesalePrice: item.wholesalePrice,
                        quantity: 0, // Will be updated by transaction
                        minStockLevel: 10,
                    });
                    actualId = newId;
                } else if (item.productId) {
                    // ONLY update cost price on purchase
                    await updateInventoryItem(item.productId, { cost: item.price });
                }

                finalItems.push({
                    id: actualId || 'unknown',
                    name: item.name,
                    quantity: item.quantity,
                    price: item.price,
                    location: item.location,
                });
            }

            // Then, create the transaction
            const purchaseTx = {
                date: (data.paymentDate || data.receiveDate).toISOString().split('T')[0],
                effectiveDate: data.receiveDate.toISOString().split('T')[0],
                type: data.purchaseType,
                description: `Purchase from PO #${po.id.slice(0,6)} for ${po.supplier.name}`,
                amount: totalAmount,
                partyId: party.id,
                accountId: data.purchaseType === 'purchase' ? data.accountId : undefined,
                items: finalItems,
                via: via,
                enabled: true, // Crucial for reports
            };

            await addTransaction(purchaseTx as any);
            
            // Mark PO as completed
            await updateDoc(doc(db, 'purchase_orders', po.id), { status: 'completed' });

            toast({ title: 'Success', description: 'Purchase transaction created and inventory updated.' });
            onOpenChange(false);
        } catch (error: any) {
            toast({ variant: 'destructive', title: 'Error', description: `Could not create purchase: ${error.message}` });
        } finally {
            setIsSaving(false);
        }
    };
    
    const handleAddProduct = () => {
        append({
            productId: `new-${Date.now()}`,
            name: '',
            quantity: 1,
            price: 0,
            salePrice: 0,
            wholesalePrice: 0,
            isNew: true,
            location: appSettings?.inventoryLocations?.[0] || 'default'
        })
    }

    return (
        <Dialog open={true} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Create Purchase from Order</DialogTitle>
                    <DialogDescription>Convert PO for {po.supplier.name} into a purchase transaction. Update prices if needed.</DialogDescription>
                </DialogHeader>
                <form onSubmit={handleSubmit(handleConfirmPurchase)} className="space-y-4">
                    <div className="rounded-md border max-h-96 overflow-y-auto">
                        <Table>
                            <TableHeader><TableRow>
                                <TableHead>Item</TableHead>
                                <TableHead className="w-24">Qty</TableHead>
                                <TableHead className="w-28">Cost Price</TableHead>
                                <TableHead className="w-28">Sale Price</TableHead>
                                <TableHead className="w-28">Wholesale Price</TableHead>
                                <TableHead className="w-40">Location</TableHead>
                                <TableHead className="w-12"></TableHead>
                            </TableRow></TableHeader>
                            <TableBody>
                                {fields.map((field, index) => (
                                    <TableRow key={field.id}>
                                        <TableCell>
                                            {field.isNew ? (
                                                 <Controller
                                                    control={control}
                                                    name={`items.${index}.name`}
                                                    render={({ field: controllerField }) => (
                                                        <ProductAutocomplete
                                                            products={products}
                                                            value={controllerField.value}
                                                            onChange={controllerField.onChange}
                                                            onSelect={(product) => {
                                                                setValue(`items.${index}.name`, product.name);
                                                                setValue(`items.${index}.productId`, product.id);
                                                                setValue(`items.${index}.price`, product.cost);
                                                                setValue(`items.${index}.salePrice`, product.price);
                                                                setValue(`items.${index}.wholesalePrice`, product.wholesalePrice || 0);
                                                                setValue(`items.${index}.isNew`, false);
                                                            }}
                                                        />
                                                    )}
                                                />
                                            ) : (
                                                 <p className="font-medium">{field.name}</p>
                                            )}
                                        </TableCell>
                                        <TableCell><Input type="number" step="0.01" {...register(`items.${index}.quantity`)} /></TableCell>
                                        <TableCell><Input type="number" step="0.01" {...register(`items.${index}.price`)} /></TableCell>
                                        <TableCell><Input type="number" step="0.01" {...register(`items.${index}.salePrice`)} /></TableCell>
                                        <TableCell><Input type="number" step="0.01" {...register(`items.${index}.wholesalePrice`)} /></TableCell>
                                        <TableCell>
                                            <Controller
                                                name={`items.${index}.location`}
                                                control={control}
                                                defaultValue={appSettings?.inventoryLocations?.[0] || 'default'}
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
                                        <TableCell><Button type="button" variant="ghost" size="icon" onClick={() => remove(index)}><Trash2 className="h-4 w-4 text-destructive" /></Button></TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                     <Button type="button" variant="outline" size="sm" onClick={handleAddProduct}>
                        <Plus className="mr-2 h-4 w-4" /> Add Item
                    </Button>
                     <div className="flex justify-end text-lg font-bold">Total Cost: {formatAmount(totalAmount)}</div>
                     <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                         <div className="space-y-1">
                             <Label>Purchase Type</Label>
                             <Controller name="purchaseType" control={control} render={({ field }) => (
                                 <Select onValueChange={field.onChange} value={field.value}>
                                     <SelectTrigger><SelectValue /></SelectTrigger>
                                     <SelectContent>
                                         <SelectItem value="credit_purchase">Credit Purchase</SelectItem>
                                         <SelectItem value="purchase">Cash/Bank Purchase</SelectItem>
                                     </SelectContent>
                                 </Select>
                             )} />
                         </div>
                         {purchaseType === 'purchase' && (
                             <div className="space-y-1">
                                 <Label>Payment Account</Label>
                                 <Controller name="accountId" control={control} render={({ field }) => (
                                     <Select onValueChange={field.onChange} value={field.value}>
                                         <SelectTrigger><SelectValue placeholder="Select account..." /></SelectTrigger>
                                         <SelectContent>{accounts.map(acc => <SelectItem key={acc.id} value={acc.id}>{acc.name}</SelectItem>)}</SelectContent>
                                     </Select>
                                 )} />
                                 {errors.accountId && <p className="text-destructive text-xs mt-1">{errors.accountId.message}</p>}
                             </div>
                         )}
                     </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                         {purchaseType === 'purchase' && (
                            <div className="space-y-1">
                                <Label>Payment Date</Label>
                                <Controller control={control} name="paymentDate" render={({ field }) => (<DatePicker value={field.value} onChange={field.onChange as any} />)} />
                            </div>
                         )}
                          <div className="space-y-1">
                                <Label>Receive Date</Label>
                                <Controller control={control} name="receiveDate" render={({ field }) => (<DatePicker value={field.value} onChange={field.onChange as any} />)} />
                            </div>
                      </div>
                    <DialogFooter>
                        <DialogClose asChild><Button type="button" variant="ghost">Cancel</Button></DialogClose>
                        <Button type="submit" disabled={isSaving}>
                            {isSaving ? <Loader2 className="animate-spin mr-2" /> : <ShoppingCart className="mr-2 h-4 w-4" />}
                            Confirm Purchase
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
};


const ProductAutocomplete = ({
  products,
  onSelect,
  value,
  onChange,
}: {
  products: Product[];
  onSelect: (product: Product) => void;
  value: string;
  onChange: (value: string) => void;
}) => {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="New item name..."
          role="combobox"
          aria-expanded={open}
          className="w-full"
        />
      </PopoverTrigger>
      <PopoverContent className="w-[300px] p-0">
        <Command>
          <CommandInput placeholder="Search product..." />
          <CommandList>
            <CommandEmpty>No product found.</CommandEmpty>
            <CommandGroup>
              {products.map((product) => (
                <CommandItem
                  key={product.id}
                  value={`${product.name} ${product.price}`}
                  onSelect={() => {
                    onSelect(product);
                    setOpen(false);
                  }}
                >
                  {product.name}
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
                    className="w-full justify-between font-normal"
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
                            {parties.map((party) => (
                                <CommandItem
                                    key={party.id}
                                    value={party.name}
                                    onSelect={() => {
                                        onChange(party.id);
                                        setOpen(false);
                                    }}
                                >
                                    <Check className={cn("mr-2 h-4 w-4", value === party.id ? "opacity-100" : "opacity-0")} />
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

function PoRtPageContent() {
  const { toast } = useToast();
  const searchParams = useSearchParams();
  const router = useRouter();

  // Data states
  const [products, setProducts] = useState<Product[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [parties, setParties] = useState<Party[]>([]);
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);

  // Form states
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [selectedSupplierId, setSelectedSupplierId] = useState('');
  const [supplierPhone, setSupplierPhone] = useState('');
  const [supplierAddress, setSupplierAddress] = useState('');
  const [selectedVia, setSelectedVia] = useState<TransactionVia>('Personal');

  const [orderItems, setOrderItems] = useState<OrderItem[]>([{ id: crypto.randomUUID(), name: '', price: 0, quantity: 1, currentStock: 0, isNew: false }]);
  
  const [convertingPO, setConvertingPO] = useState<PurchaseOrder | null>(null);


  useEffect(() => {
    // Check for pre-filled items from query params
    const prefilledItems = searchParams.get('items');
    if (prefilledItems) {
      try {
        const parsedItems: Omit<OrderItem, 'id' | 'currentStock'>[] = JSON.parse(prefilledItems);
        setOrderItems(parsedItems.map(item => ({ ...item, id: crypto.randomUUID(), currentStock: products.find(p => p.id === item.productId)?.quantity || 0 })));
        // Optional: clear query params after use
        router.replace('/po-rt');
      } catch (e) {
        console.error("Failed to parse items from query params:", e);
      }
    }
  }, [searchParams, router, products]);

  useEffect(() => {
    if (!db) {
      toast({ variant: 'destructive', title: 'Error', description: 'Firebase is not configured.' });
      setLoading(false);
      return;
    }

    const productsQuery = query(collection(db, 'inventory'), orderBy('name'));
    const poQuery = query(collection(db, 'purchase_orders'), orderBy('createdAt', 'desc'));


    const unsubProducts = onSnapshot(productsQuery, (snapshot) => {
      const prods = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Product));
      setProducts(prods);
      setLoading(false);
    }, (err) => {
      console.error(err);
      toast({ variant: 'destructive', title: 'Error', description: 'Could not fetch products.' });
      setLoading(false);
    });

    const unsubPOs = onSnapshot(poQuery, (snapshot) => {
        const pos = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                ...data,
                createdAt: data.createdAt && typeof data.createdAt.toDate === 'function' 
                    ? data.createdAt.toDate().toISOString() 
                    : data.createdAt,
            } as PurchaseOrder
        });
        setPurchaseOrders(pos);
    });
    
    const unsubAccounts = subscribeToAccounts(setAccounts, (err) => toast({ variant: 'destructive', title: 'Error', description: 'Could not fetch accounts.' }));
    const unsubParties = onSnapshot(query(collection(db, 'parties')), (snapshot) => {
        const partyList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Party));
        setParties(partyList);
    });
    
    getAppSettings().then(settings => {
      setAppSettings(settings);
      if (settings?.businessProfiles?.[0]) {
        setSelectedVia(settings.businessProfiles[0].name as TransactionVia);
      }
    });

    return () => {
      unsubProducts();
      unsubPOs();
      unsubAccounts();
      unsubParties();
    };
  }, [toast]);
  
  const supplierParties = useMemo(() => parties.filter(p => p.partyType === 'Supplier'), [parties]);
  const selectedSupplier = useMemo(() => parties.find(p => p.id === selectedSupplierId), [parties, selectedSupplierId]);
  const selectedBusinessProfile = useMemo(() => appSettings?.businessProfiles.find(p => p.name === selectedVia), [appSettings, selectedVia]);


   useEffect(() => {
    if (selectedSupplier) {
      setSupplierPhone(selectedSupplier.phone || '');
      setSupplierAddress(selectedSupplier.address || '');
      if (selectedSupplier.group) {
        setSelectedVia(selectedSupplier.group as TransactionVia);
      }
    } else {
      setSupplierPhone('');
      setSupplierAddress('');
    }
  }, [selectedSupplier]);

  const addProductRow = () => {
    setOrderItems([...orderItems, { id: crypto.randomUUID(), name: '', price: 0, quantity: 1, currentStock: 0, isNew: false }]);
  };

  const handleItemChange = (id: string, field: keyof OrderItem, value: string | number | boolean) => {
    setOrderItems(orderItems.map(item => item.id === id ? { ...item, [field]: value } : item));
  };
  
  const handleProductSelect = (id: string, product: Product) => {
     setOrderItems(orderItems.map(item => item.id === id ? { ...item, productId: product.id, name: product.name, price: product.cost, currentStock: product.quantity, isNew: false } : item));
  }

  const removeProductRow = (id: string) => {
    const itemToRemove = orderItems.find(item => item.id === id);
    if (itemToRemove && !itemToRemove.name && !itemToRemove.price && orderItems.length > 1) {
        setOrderItems(orderItems.filter(item => item.id !== id));
    } else if (itemToRemove) {
        setOrderItems(orderItems.filter(item => item.id !== id));
    }
  };

  const { totalAmount, totalProducts } = useMemo(() => {
    const totalAmount = orderItems.reduce((sum, item) => sum + (item.price || 0) * (item.quantity || 0), 0);
    const totalProducts = orderItems.reduce((sum, item) => sum + (item.quantity || 0), 0);
    return { totalAmount, totalProducts };
  }, [orderItems]);

  // New Product Modal
  const [newProductName, setNewProductName] = useState('');
  const [newProductPrice, setNewProductPrice] = useState('');
  const [isProductModalOpen, setIsProductModalOpen] = useState(false);
  
  const saveNewProduct = async () => {
    if (!db) return;
    if (newProductName && newProductPrice) {
      try {
        await addDoc(collection(db, 'inventory'), {
          name: newProductName,
          price: parseFloat(newProductPrice),
          cost: 0,
          quantity: 0,
          sku: `temp-${Date.now()}`,
          category: 'Uncategorized',
          minStockLevel: 0,
        });
        toast({ title: 'Success', description: 'Product saved successfully.' });
        setNewProductName('');
        setNewProductPrice('');
        setIsProductModalOpen(false);
      } catch (error) {
        toast({ variant: 'destructive', title: 'Error', description: 'Could not save product.' });
      }
    } else {
      toast({ variant: 'destructive', title: 'Error', description: 'Product name and price are required.' });
    }
  };

  // SMS and Whatsapp
  const [smsMessage, setSmsMessage] = useState('');
  const [isSmsModalOpen, setIsSmsModalOpen] = useState(false);

  const generateMessage = () => {
    const orderItemsText = orderItems
      .filter(item => item.name && item.quantity > 0)
      .map(item => `${item.name} - ${item.quantity} pcs`)
      .join('\n');
    
    if (orderItemsText.length === 0) {
      toast({ variant: 'destructive', title: 'Error', description: 'No products in order.' });
      return '';
    }

    const formattedDate = new Date(date).toLocaleDateString('en-US');
    return `${selectedBusinessProfile?.name || 'Rushaib Traders'} Order\nDate: ${formattedDate}\nTotal Products: ${totalProducts}\n\n${orderItemsText}`;
  }

  const handleSendSms = () => {
    const message = generateMessage();
    if (message) {
      setSmsMessage(message);
      setIsSmsModalOpen(true);
    }
  }

  const handleCopySms = () => {
    navigator.clipboard.writeText(smsMessage);
    toast({ title: 'Success', description: 'Message copied to clipboard.' });
  }

  const handleOpenSmsApp = () => {
    window.open(`sms:${supplierPhone}?body=${encodeURIComponent(smsMessage)}`);
  }
  
  const handleSendWhatsapp = () => {
     const message = generateMessage();
     if(message) {
         const whatsappUrl = `https://wa.me/${supplierPhone}?text=${encodeURIComponent(message)}`;
         window.open(whatsappUrl, '_blank');
     }
  }

  const handleSavePurchaseOrder = async () => {
    if (!db) return;
    if (!selectedSupplierId) {
      toast({ variant: 'destructive', title: 'Error', description: 'Please select a supplier.' });
      return;
    }
    const itemsToSave = orderItems.filter(item => item.name && item.quantity > 0).map(({ id, ...rest }) => rest);

    if (itemsToSave.length === 0) {
      toast({ variant: 'destructive', title: 'Error', description: 'Cannot save an empty order.' });
      return;
    }

    const poData = {
      orderDate: date,
      supplier: {
        id: selectedSupplierId,
        name: selectedSupplier?.name || 'Unknown Supplier',
        phone: supplierPhone,
        address: supplierAddress,
        group: selectedSupplier?.group,
      },
      items: itemsToSave,
      totalAmount,
      totalProducts,
      createdAt: new Date(),
      status: 'pending' as const,
      via: selectedVia,
    };

    try {
      await addDoc(collection(db, 'purchase_orders'), poData);
      toast({ title: 'Success', description: 'Purchase Order saved successfully.' });
      setOrderItems([{ id: crypto.randomUUID(), name: '', price: 0, quantity: 1, currentStock: 0, isNew: false }]);
      setSelectedSupplierId('');
    } catch (error) {
      console.error("PO Save Error:", error);
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to save purchase order.' });
    }
  };


  const handleViewPo = (po: PurchaseOrder) => {
    setDate(po.orderDate);
    setSelectedSupplierId(po.supplier.id);
    setSelectedVia(po.via);
    setSupplierPhone(po.supplier.phone);
    setSupplierAddress(po.supplier.address);
    setOrderItems(po.items.map(item => ({ ...item, id: crypto.randomUUID(), currentStock: products.find(p => p.name === item.name)?.quantity || 0 })));
    window.scrollTo(0, 0);
  };
  
  const handleDeletePo = async (poId: string) => {
    if (!db) return;
    try {
      await deleteDoc(doc(db, 'purchase_orders', poId));
      toast({title: 'Success', description: 'Purchase Order deleted.'});
    } catch (error) {
      toast({variant: 'destructive', title: 'Error', description: 'Could not delete Purchase Order.'});
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900/50">
        <div className="container mx-auto p-4 md:p-6 lg:p-8">
            <header className="flex justify-between items-center mb-8">
                <Button variant="outline" onClick={() => router.back()}><ArrowLeft className="mr-2 h-4 w-4" /> Back</Button>
                <div>
                    <h1 className="text-3xl font-bold text-primary text-center">{selectedBusinessProfile?.name || 'Rushaib Traders'}</h1>
                    <p className="text-muted-foreground text-center">{selectedBusinessProfile?.address || 'Select a business profile'}</p>
                </div>
                <div/>
            </header>

            {convertingPO && (
                <CreatePurchaseFromPODialog 
                    po={convertingPO}
                    onOpenChange={(open) => !open && setConvertingPO(null)}
                    accounts={accounts}
                    parties={parties}
                    products={products}
                    via={selectedVia}
                    appSettings={appSettings}
                />
            )}

            <main className="space-y-6">
                <Card>
                    <CardHeader>
                        <CardTitle>Supplier Information</CardTitle>
                        <CardDescription>Details of the supplier for this purchase order.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                             <div className="space-y-2">
                                <Label htmlFor="date"><CalendarIcon className="inline-block mr-2 h-4 w-4"/>Date</Label>
                                <Input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="supplierName"><Users className="inline-block mr-2 h-4 w-4"/>Supplier</Label>
                                <PartyCombobox parties={supplierParties} value={selectedSupplierId} onChange={setSelectedSupplierId} placeholder="Select supplier..."/>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="via"><Building className="inline-block mr-2 h-4 w-4"/>Business Profile</Label>
                                <Select value={selectedVia} onValueChange={(v) => setSelectedVia(v as TransactionVia)}>
                                    <SelectTrigger id="via">
                                        <SelectValue placeholder="Select profile..." />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {(appSettings?.businessProfiles || []).map(p => <SelectItem key={p.name} value={p.name}>{p.name}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="supplierPhone"><PhoneCall className="inline-block mr-2 h-4 w-4"/>Phone Number</Label>
                                <Input id="supplierPhone" type="tel" value={supplierPhone} readOnly disabled />
                            </div>
                            <div className="space-y-2 lg:col-span-2">
                                <Label htmlFor="supplierAddress"><MapPin className="inline-block mr-2 h-4 w-4"/>Address</Label>
                                <Input id="supplierAddress" value={supplierAddress} readOnly disabled />
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>Order Items</CardTitle>
                        <CardDescription>Add products to the purchase order.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="rounded-md border">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead className="w-[40%]">Product Name</TableHead>
                                        <TableHead>New?</TableHead>
                                        <TableHead className="w-[15%]">Price</TableHead>
                                        <TableHead className="w-[20%]">Quantity</TableHead>
                                        <TableHead className="w-[15%]">Total</TableHead>
                                        <TableHead className="w-[15%] text-right">Action</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {loading ? (
                                        <TableRow><TableCell colSpan={6} className="h-24 text-center"><Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" /></TableCell></TableRow>
                                    ) : orderItems.map(item => (
                                        <TableRow key={item.id}>
                                            <TableCell>
                                                <ProductAutocomplete 
                                                    products={products}
                                                    value={item.name}
                                                    onChange={(value) => handleItemChange(item.id, 'name', value)}
                                                    onSelect={(product) => handleProductSelect(item.id, product)}
                                                />
                                            </TableCell>
                                            <TableCell>
                                                <Checkbox
                                                    checked={item.isNew}
                                                    onCheckedChange={(checked) => handleItemChange(item.id, 'isNew', !!checked)}
                                                />
                                            </TableCell>
                                            <TableCell><Input type="number" value={item.price} onChange={e => handleItemChange(item.id, 'price', e.target.valueAsNumber || 0)} step="0.01" /></TableCell>
                                            <TableCell>
                                                <div className="flex items-center gap-2">
                                                    <Input type="number" value={item.quantity} onChange={e => handleItemChange(item.id, 'quantity', e.target.valueAsNumber || 0)} min="1" step="0.01" />
                                                    <Badge variant="secondary">Stock: {item.currentStock}</Badge>
                                                </div>
                                            </TableCell>
                                            <TableCell><Input readOnly value={((item.price || 0) * (item.quantity || 0)).toFixed(2)} className="font-mono" /></TableCell>
                                            <TableCell className="text-right">
                                                <Button variant="ghost" size="icon" className="text-destructive" onClick={() => removeProductRow(item.id)}><Trash2 className="h-4 w-4" /></Button>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                        <div className="flex gap-2 mt-4">
                            <Button size="sm" variant="outline" onClick={addProductRow}><Plus className="mr-2 h-4 w-4" /> Add Item</Button>
                            <Dialog open={isProductModalOpen} onOpenChange={setIsProductModalOpen}>
                                <DialogTrigger asChild><Button size="sm" variant="outline"><Save className="mr-2 h-4 w-4" /> Save New Product</Button></DialogTrigger>
                                <DialogContent>
                                    <DialogHeader><DialogTitle>Add New Product</DialogTitle></DialogHeader>
                                    <div className="space-y-4 py-4">
                                        <div className="space-y-2">
                                            <Label htmlFor="newProductName">Product Name</Label>
                                            <Input id="newProductName" value={newProductName} onChange={e => setNewProductName(e.target.value)} />
                                        </div>
                                         <div className="space-y-2">
                                            <Label htmlFor="newProductPrice">Price</Label>
                                            <Input id="newProductPrice" type="number" step="0.01" value={newProductPrice} onChange={e => setNewProductPrice(e.target.value)} />
                                        </div>
                                    </div>
                                    <DialogFooter>
                                        <Button variant="ghost" onClick={() => setIsProductModalOpen(false)}>Cancel</Button>
                                        <Button onClick={saveNewProduct}>Save Product</Button>
                                    </DialogFooter>
                                </DialogContent>
                            </Dialog>
                        </div>
                    </CardContent>
                    <CardFooter>
                        <div className="w-full bg-muted p-4 rounded-lg">
                             <div className="flex justify-between items-center text-lg">
                                <h4 className="font-bold">Total Products: <span className="font-mono text-primary">{totalProducts}</span></h4>
                                <h4 className="font-bold">Total Amount: <span className="font-mono text-primary">{totalAmount.toFixed(2)}</span> BDT</h4>
                             </div>
                        </div>
                    </CardFooter>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>Finalize & Send</CardTitle>
                        <CardDescription>Save the purchase order or send it via SMS or WhatsApp.</CardDescription>
                    </CardHeader>
                    <CardContent className="flex flex-col sm:flex-row justify-center gap-4">
                        <Button onClick={handleSavePurchaseOrder} size="lg" variant="default" className="w-full sm:w-auto"><Save className="mr-2 h-4 w-4"/> Save Purchase Order</Button>
                        <Button onClick={handleSendSms} size="lg" variant="outline" className="w-full sm:w-auto"><MessageSquare className="mr-2 h-4 w-4"/> Send SMS</Button>
                        <Button onClick={handleSendWhatsapp} size="lg" variant="outline" className="bg-green-100 text-green-700 hover:bg-green-200 w-full sm:w-auto"><Phone className="mr-2 h-4 w-4"/> Send on WhatsApp</Button>
                    </CardContent>
                </Card>

                <Separator />

                 <Card>
                    <CardHeader>
                        <CardTitle>Saved Purchase Orders</CardTitle>
                        <CardDescription>View previously saved purchase orders.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="rounded-md border">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Order Date</TableHead>
                                        <TableHead>Supplier</TableHead>
                                        <TableHead>Total Amount</TableHead>
                                        <TableHead>Status</TableHead>
                                        <TableHead className="text-right">Action</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {purchaseOrders.length > 0 ? (
                                        purchaseOrders.map(po => (
                                            <TableRow key={po.id}>
                                                <TableCell>{po.createdAt && typeof po.createdAt === 'string' ? formatDate(po.createdAt) : 'N/A'}</TableCell>
                                                <TableCell>{po.supplier.name}</TableCell>
                                                <TableCell>{po.totalAmount.toFixed(2)} BDT</TableCell>
                                                <TableCell>
                                                    {po.status === 'completed' ? (
                                                        <Badge variant="default" className="bg-green-100 text-green-700"><CheckCircle2 className="mr-1 h-3 w-3" />Completed</Badge>
                                                    ) : (
                                                        <Badge variant="secondary">Pending</Badge>
                                                    )}
                                                </TableCell>
                                                <TableCell className="text-right space-x-2">
                                                    <Button variant="outline" size="sm" onClick={() => handleViewPo(po)}><Eye className="mr-2 h-4 w-4"/> View</Button>
                                                    <Button variant="default" size="sm" onClick={() => setConvertingPO(po)} disabled={po.status === 'completed'}><ArrowRightLeft className="mr-2 h-4 w-4"/> Create Purchase</Button>
                                                    <AlertDialog>
                                                        <AlertDialogTrigger asChild>
                                                            <Button variant="destructive" size="sm"><Trash2 className="mr-2 h-4 w-4"/> Delete</Button>
                                                        </AlertDialogTrigger>
                                                        <AlertDialogContent>
                                                          <AlertDialogHeader><AlertDialogTitle>Are you sure?</AlertDialogTitle></AlertDialogHeader>
                                                          <AlertDialogDescriptionComponent>This will permanently delete the purchase order. This action cannot be undone.</AlertDialogDescriptionComponent>
                                                          <AlertDialogFooter>
                                                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                            <AlertDialogAction onClick={() => handleDeletePo(po.id)}>Delete</AlertDialogAction>
                                                          </AlertDialogFooter>
                                                        </AlertDialogContent>
                                                    </AlertDialog>
                                                </TableCell>
                                            </TableRow>
                                        ))
                                    ) : (
                                        <TableRow><TableCell colSpan={5} className="h-24 text-center">No saved orders found.</TableCell></TableRow>
                                    )}
                                </TableBody>
                            </Table>
                        </div>
                    </CardContent>
                </Card>

            </main>

            {/* SMS Modal */}
            <Dialog open={isSmsModalOpen} onOpenChange={setIsSmsModalOpen}>
                <DialogContent>
                    <DialogHeader><DialogTitle>Send SMS</DialogTitle></DialogHeader>
                    <div className="space-y-4">
                        <div>
                            <Label htmlFor="smsMessage">Message</Label>
                            <Textarea id="smsMessage" value={smsMessage} readOnly rows={8} />
                        </div>
                         <div>
                            <Label htmlFor="smsNumber">Phone Number</Label>
                            <Input id="smsNumber" value={supplierPhone} readOnly />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="secondary" onClick={handleCopySms}><Copy className="mr-2 h-4 w-4"/> Copy Text</Button>
                        <Button onClick={handleOpenSmsApp}>Open SMS App</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    </div>
  )
}

export default function PoRtPage() {
    return (
        <Suspense fallback={<div className="flex justify-center items-center h-screen"><Loader2 className="h-12 w-12 animate-spin text-primary" /></div>}>
            <PoRtPageContent />
        </Suspense>
    )
}
