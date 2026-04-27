'use client';

import React, { useState, useEffect, useMemo, useRef, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger, DialogClose, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { Plus, Trash2, Save, Users, Loader2, ArrowLeft, Printer, Share2, ShoppingCart, User, Building, Phone, MapPin, ChevronsUpDown, Check, Calendar as CalendarIcon, Minus, ImageIcon, Camera, Upload, Truck, DollarSign, ScanLine, Pencil, Copy, Users2, CreditCard, Search, Package, Settings, X, RefreshCcw } from 'lucide-react';
import { subscribeToParties, addParty } from '@/services/partyService';
import { subscribeToInventoryItems, addInventoryItem, recalculateStockForItem } from '@/services/inventoryService';
import { addTransaction, subscribeToAllTransactions, handleSmsNotification } from '@/services/transactionService';
import { subscribeToAccounts } from '@/services/accountService';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import type { Party, InventoryItem, TransactionVia, Account, Payment, Transaction, AppSettings, InventoryCategory, Quotation, CustomerService } from '@/types';
import { formatAmount, getPartyBalanceEffect } from '@/lib/utils';
import InvoiceDialog from '@/components/pos/InvoiceDialog';
import { getAppSettings } from '@/services/settingsService';
import { uploadImage } from '@/services/storageService';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { format } from 'date-fns';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { ItemFormDialog, StockAdjustmentDialog } from '@/components/inventory/InventoryManager';
import { PartyFormDialog } from '@/components/PartyManager';
import { DatePicker } from '@/components/ui/date-picker';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { getQuotationById } from '@/services/quotationService';
import { motion, AnimatePresence } from 'framer-motion';
import { Switch } from '@/components/ui/switch';

interface CartItem extends InventoryItem {
  cartItemId: string;
  sellQuantity: number;
  sellPrice: number;
  itemProfit?: number;
  itemProfitPercentage?: number;
  itemDiscount?: number;
  location?: string;
  isService?: boolean;
}

type SaleType = 'cash' | 'credit';
type PricingTier = 'retail' | 'wholesale';

type SaleState = {
  billDate: Date;
  selectedPartyId: string;
  deliveryById: string;
  selectedVia: TransactionVia;
  cart: CartItem[];
  saleType: SaleType;
  payments: Payment[];
  discount: number;
  lastInvoice: Transaction | null;
  pricingTier: PricingTier;
  deliveryCharge: number;
  deliveryChargePaidBy: string;
  payDeliveryChargeNow: boolean;
  notes?: string;
  sendSmsOnSave: boolean;
};

type SaleTab = {
  id: string;
  name: string;
  state: SaleState;
};

const PartyCombobox = ({ parties, value, onChange, placeholder = "Select a customer..." }: { parties: Party[], value: string, onChange: (value: string, name?: string) => void, placeholder?: string }) => {
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
                    <CommandInput placeholder="Search..." />
                    <CommandList>
                        <CommandEmpty>Not found.</CommandEmpty>
                        <CommandGroup>
                            <CommandItem
                                key="unknown-person"
                                value="unknown"
                                onSelect={() => { onChange("", placeholder === "Select a customer..." ? 'Walk-in Customer' : 'Unknown Person'); setOpen(false); }}
                            >
                                <Check className={cn("mr-2 h-4 w-4", !value ? "opacity-100" : "opacity-0")} />
                                {placeholder === "Select a customer..." ? 'Walk-in Customer' : 'Unknown Person'}
                            </CommandItem>
                            {parties.map((party) => (
                                <CommandItem
                                    key={party.id}
                                    value={party.name}
                                    onSelect={() => {
                                        onChange(party.id, party.name);
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

function PosPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const partyIdFromQuery = searchParams.get('partyId');
  const quotationIdFromQuery = searchParams.get('quotationId');
  const { toast } = useToast();
  const invoiceRef = useRef<HTMLDivElement>(null);

  const [parties, setParties] = useState<Party[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [tabs, setTabs] = useState<SaleTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string>('');
  const [isSaving, setIsSaving] = useState(false);
  const [isRecalculatingStock, setIsRecalculatingStock] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [isItemFormOpen, setIsItemFormOpen] = useState(false);
  const [isNewPartyDialogOpen, setIsNewPartyDialogOpen] = useState(false);
  const [adjustingItem, setAdjustingItem] = useState<InventoryItem | null>(null);
  const [posTab, setPosTab] = useState('items');

  const activeTabIndex = useMemo(() => tabs.findIndex(tab => tab.id === activeTabId), [tabs, activeTabId]);
  const activeTabState = useMemo(() => tabs[activeTabIndex]?.state, [tabs, activeTabIndex]);

  const updateActiveTabState = useCallback((newState: Partial<SaleState> | ((prevState: SaleState) => Partial<SaleState>)) => {
    setTabs(prevTabs => {
      const activeIndex = prevTabs.findIndex(tab => tab.id === activeTabId);
      if (activeIndex === -1) return prevTabs;
      const newTabs = [...prevTabs];
      const oldState = newTabs[activeIndex].state;
      const updatedFields = typeof newState === 'function' ? newState(oldState) : newState;
      const newStateObj = { ...oldState, ...updatedFields };
      newTabs[activeIndex] = { ...newTabs[activeIndex], state: newStateObj };
      
      if (updatedFields.selectedPartyId !== undefined) {
        const party = parties.find(p => p.id === updatedFields.selectedPartyId);
        newTabs[activeIndex].name = party ? party.name : `Order ${activeIndex + 1}`;
      }
      return newTabs;
    });
  }, [activeTabId, parties]);

  const createNewTab = useCallback((partyId = '', name = `Order ${tabs.length + 1}`): string => {
    const newTabId = `tab-${Date.now()}`;
    const defaultVia = appSettings?.businessProfiles?.[0]?.name as TransactionVia || 'Personal';
    
    const newTab: SaleTab = {
      id: newTabId, 
      name,
      state: {
        billDate: new Date(), 
        selectedPartyId: partyId, 
        deliveryById: '', 
        selectedVia: defaultVia,
        cart: [], 
        saleType: 'cash', 
        payments: [], 
        discount: 0, 
        lastInvoice: null,
        pricingTier: 'retail', 
        deliveryCharge: 0, 
        deliveryChargePaidBy: 'customer',
        payDeliveryChargeNow: false, 
        notes: '', 
        sendSmsOnSave: true,
      },
    };
    setTabs(prev => [...prev, newTab]);
    setActiveTabId(newTabId);
    return newTabId;
  }, [appSettings, tabs.length]);

  useEffect(() => {
    const unsubParties = subscribeToParties(setParties, console.error);
    const unsubInventory = subscribeToInventoryItems(setInventory, console.error);
    const unsubAccounts = subscribeToAccounts(setAccounts, console.error);
    const unsubTransactions = subscribeToAllTransactions(setTransactions, console.error);
    getAppSettings().then(setAppSettings);
    setLoading(false);
    return () => { unsubParties(); unsubInventory(); unsubAccounts(); unsubTransactions(); };
  }, []);

  useEffect(() => {
    if (partyIdFromQuery && parties.length > 0 && !loading) {
      const party = parties.find(p => p.id === partyIdFromQuery);
      if (party) {
        const existingTab = tabs.find(t => t.state.selectedPartyId === party.id);
        if (existingTab) {
          setActiveTabId(existingTab.id);
        } else {
          createNewTab(party.id, party.name);
        }
      }
    } else if (tabs.length === 0 && !loading) {
        createNewTab();
    }
  }, [partyIdFromQuery, parties, loading, createNewTab, tabs]);

  const searchableItems = useMemo(() => {
    const incomeServices = (appSettings?.customerServices || [])
      .filter(s => s.type === 'income' || s.type === 'sale')
      .map(s => ({
        ...s,
        quantity: Infinity,
        cost: 0,
        isService: true
      }));

    return [...inventory, ...incomeServices];
  }, [inventory, appSettings]);

  const filteredInventory = useMemo(() => {
    if (!searchQuery) return [];
    const lowercasedQuery = searchQuery.toLowerCase();
    return searchableItems.filter(item => 
        item.name.toLowerCase().includes(lowercasedQuery) ||
        ('sku' in item && item.sku && item.sku.toLowerCase().includes(lowercasedQuery))
    );
  }, [searchQuery, searchableItems]);

  const deliveryPersonnel = useMemo(() => {
    return parties.filter(p => p.partyType === 'Delivery');
  }, [parties]);

  const handleAddItemToCart = useCallback((item: InventoryItem | (CustomerService & { isService?: boolean })) => {
    updateActiveTabState(prev => {
        const fresh = searchableItems.find(i => i.id === item.id);
        if (!fresh) return prev;
        
        let sellPrice = fresh.price || 0;
        if (!('isService' in fresh) && prev.pricingTier === 'wholesale' && fresh.wholesalePrice) {
            sellPrice = fresh.wholesalePrice;
        }

        const loc = ('via' in fresh ? (fresh as any).via : '') || appSettings?.inventoryLocations?.[0] || 'default';
        const existingIdx = prev.cart.findIndex(c => c.id === fresh.id && c.location === loc);
        let newCart = [...prev.cart];
        
        if (existingIdx > -1) {
            const existing = newCart[existingIdx];
            const stock = ('stock' in fresh ? (fresh as any).stock?.[loc] : Infinity) || 0;
            if (existing.isService || existing.sellQuantity < stock) {
                newCart[existingIdx] = { ...existing, sellQuantity: existing.sellQuantity + 1 };
            } else {
                 toast({ variant: 'destructive', title: 'Stock Limit', description: `Only ${stock} available.` });
            }
        } else {
            newCart.push({ 
                ...fresh, 
                cartItemId: `cart-${Date.now()}-${Math.random()}`, 
                sellQuantity: 1, 
                sellPrice, 
                location: loc,
                isService: 'isService' in fresh ? (fresh as any).isService : false
            } as CartItem);
        }
        return { cart: newCart };
    });
    setSearchQuery('');
  }, [updateActiveTabState, searchableItems, appSettings, toast]);

  const handleCartItemChange = useCallback((cartItemId: string, field: string, value: any) => {
     updateActiveTabState(prev => ({
        cart: prev.cart.map((item) => {
            if (item.cartItemId === cartItemId) {
                if (field === 'sellQuantity') {
                    const fresh = searchableItems.find(i => i.id === item.id);
                    const stock = ('stock' in (fresh || {}) ? (fresh as any).stock?.[item.location || 'default'] : Infinity) || 0;
                    if (value > 0 && (item.isService || value <= stock)) return { ...item, sellQuantity: value };
                    else return item;
                } else if (field === 'sellPrice') return { ...item, sellPrice: value };
                else if (field === 'itemDiscount') return { ...item, itemDiscount: value };
                else if (field === 'location') return { ...item, location: value };
            }
            return item;
        })
    }));
  }, [updateActiveTabState, searchableItems]);

  const handleAdjustQuantity = useCallback((cartItemId: string, amount: number) => {
    updateActiveTabState(prev => {
        const updatedCart = prev.cart.map(item => {
            if (item.cartItemId === cartItemId) {
                const newQuantity = item.sellQuantity + amount;
                const fresh = searchableItems.find(i => i.id === item.id) || item;
                const stock = ('stock' in fresh ? (fresh as any).stock?.[item.location || 'default'] : Infinity) || 0;
                if (item.isService || (newQuantity > 0 && newQuantity <= stock)) {
                    return { ...item, sellQuantity: newQuantity };
                } else if (newQuantity > stock) {
                    toast({ variant: 'destructive', title: 'Stock Limit Exceeded', description: `Only ${stock} units available.` });
                }
            }
            return item;
        }).filter(item => item.sellQuantity > 0);
        return { cart: updatedCart };
    });
  }, [updateActiveTabState, searchableItems, toast]);

  const handleRemoveFromCart = (cartItemId: string) => {
    updateActiveTabState(prev => ({
        cart: prev.cart.filter(item => item.cartItemId !== cartItemId)
    }));
  };

  const handleCloseTab = (tabId: string) => {
    setTabs(prevTabs => {
        if (prevTabs.length === 1) return prevTabs;
        const newTabs = prevTabs.filter(tab => tab.id !== tabId);
        if (activeTabId === tabId) {
            setActiveTabId(newTabs[0]?.id || '');
        }
        return newTabs;
    });
  };

  const handleAddPayment = useCallback(() => {
    updateActiveTabState(prev => {
        const cashAccount = accounts.find(a => a.name.toLowerCase() === 'cash');
        const defaultAccountId = cashAccount?.id || (accounts[0]?.id || '');
        return {
            payments: [...(prev.payments || []), { accountId: defaultAccountId, amount: 0 }]
        };
    });
  }, [accounts, updateActiveTabState]);

  const handlePaymentChange = (index: number, field: keyof Payment, value: any) => {
    updateActiveTabState(prev => ({
        payments: prev.payments.map((p, i) => i === index ? { ...p, [field]: value } : p)
    }));
  };

  const handleRemovePayment = (index: number) => {
    updateActiveTabState(prev => ({
        payments: prev.payments.filter((_, i) => i !== index)
    }));
  };

  if (!activeTabState) return null;

  const { cart: activeCart, pricingTier, selectedPartyId, billDate, deliveryById, selectedVia, notes, discount, deliveryCharge, deliveryChargePaidBy, payments, sendSmsOnSave, saleType } = activeTabState;
  
  const subTotalAmount = activeCart.reduce((sum, item) => sum + (item.sellPrice * item.sellQuantity), 0);
  const totalItemDisc = activeCart.reduce((sum, item) => sum + (item.itemDiscount || 0), 0);
  const netTotalAmount = subTotalAmount - totalItemDisc;
  const finalPayableAmount = netTotalAmount - discount + (deliveryChargePaidBy === 'customer' ? deliveryCharge : 0);
  const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);
  const dueAmount = finalPayableAmount - totalPaid;
  const totalItemsCount = activeCart.reduce((sum, i) => sum + i.sellQuantity, 0);

  const handleCompleteSale = async () => {
    if (!activeTabState) return;
    if (activeCart.length === 0) {
      toast({ variant: 'destructive', title: 'Empty Cart', description: 'Please add items to the cart.' });
      return;
    }
    if (dueAmount > 0.01 && !selectedPartyId) {
      toast({ variant: 'destructive', title: 'Customer Required', description: 'Credit sales require a customer.' });
      return;
    }

    setIsSaving(true);
    try {
      const invoiceNumber = `INV-${Date.now()}`;
      const currentParty = parties.find(p => p.id === selectedPartyId);
      
      // Calculate previous due for SMS
      const previousDue = transactions
            .filter(tx => tx.partyId === selectedPartyId && tx.enabled)
            .reduce((balance, tx) => balance + getPartyBalanceEffect(tx, false), 0);

      const txData: any = {
          date: format(billDate, 'yyyy-MM-dd'),
          via: selectedVia,
          items: activeCart.map(i => ({ 
            id: i.id, 
            name: i.name, 
            quantity: i.sellQuantity, 
            price: i.sellPrice, 
            cost: i.cost, 
            location: i.location 
          })),
          invoiceNumber,
          amount: finalPayableAmount,
          partyId: selectedPartyId || 'walkin', 
          description: notes || `Sale. Invoice: ${invoiceNumber}`,
          type: (dueAmount > 0.01) ? 'credit_sale' : 'sale',
          payments: payments,
          deliveredBy: deliveryById || undefined,
          deliveryCharge,
          deliveryChargePaidBy,
          discount: discount + totalItemDisc,
          enabled: true,
          sendSms: sendSmsOnSave,
      };

      const resultId = await addTransaction(txData);
      
      if (sendSmsOnSave && currentParty) {
          const savedTransaction = { ...txData, id: resultId };
          handleSmsNotification(savedTransaction, currentParty, totalPaid, previousDue).catch(err => {
              console.error("SMS notification failed:", err);
          });
      }
      
      toast({ title: 'Sale Completed', description: `Invoice #${invoiceNumber} created.` });
      
      setTabs(prev => {
          if (prev.length === 1) {
              const resetTab = { 
                ...prev[0], 
                state: { 
                    ...prev[0].state, 
                    cart: [], 
                    payments: [], 
                    discount: 0, 
                    notes: '', 
                    selectedPartyId: '',
                    deliveryCharge: 0
                }, 
                name: 'Order 1' 
              };
              return [resetTab];
          }
          return prev.filter(t => t.id !== activeTabId);
      });

      if (partyIdFromQuery) {
        router.push(`/parties/${partyIdFromQuery}`);
      } else {
        router.push('/transactions');
      }
    } catch (e: any) {
      console.error("Sale failed:", e);
      toast({ variant: 'destructive', title: 'Error', description: e.message });
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveNewParty = async (data: any, p: Party | null, imageFile: File | null) => {
    try {
      let imageUrl = '';
      if (imageFile) imageUrl = await uploadImage(imageFile, 'party-images');
      const partyId = await addParty({ ...data, imageUrl });
      updateActiveTabState({ selectedPartyId: partyId });
      setIsNewPartyDialogOpen(false);
      toast({ title: 'Customer Added' });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error', description: e.message });
    }
  };

  const handleRecalculateStock = async (itemId: string) => {
      setIsRecalculatingStock(true);
      try {
          await recalculateStockForItem(itemId);
          toast({ title: 'Success!', description: 'Stock updated.' });
      } catch (error: any) {
          toast({ variant: 'destructive', title: 'Error', description: error.message });
      } finally {
          setIsRecalculatingStock(false);
      }
  };

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-black flex flex-col">
      <header className="bg-primary text-primary-foreground p-2 flex items-center justify-between shadow-md">
        <div className="flex items-center gap-1 overflow-x-auto">
            <Button variant="ghost" size="icon" onClick={() => router.back()} className="text-white hover:bg-white/10 shrink-0">
                <ArrowLeft />
            </Button>
            {tabs.map(tab => (
                <Button 
                  key={tab.id} 
                  variant={tab.id === activeTabId ? 'secondary' : 'ghost'}
                  className="h-auto px-3 py-1.5 text-sm shrink-0 flex items-center gap-1.5"
                  onClick={() => setActiveTabId(tab.id)}
                >
                  {tab.name}
                  <X className="h-4 w-4 text-muted-foreground" onClick={(e) => { e.stopPropagation(); handleCloseTab(tab.id); }}/>
                </Button>
            ))}
            <Button variant="ghost" size="icon" onClick={() => createNewTab()} className="text-white hover:bg-white/10 shrink-0">
                <Plus />
            </Button>
        </div>
      </header>

      <ItemFormDialog open={isItemFormOpen} onOpenChange={setIsItemFormOpen} onSave={() => {}} item={null} categories={appSettings?.inventoryCategories || []} parties={[]} appSettings={appSettings} />
      <PartyFormDialog open={isNewPartyDialogOpen} onOpenChange={setIsNewPartyDialogOpen} onSave={handleSaveNewParty} party={null} appSettings={appSettings} allParties={parties} />
      <StockAdjustmentDialog item={adjustingItem} open={!!adjustingItem} onOpenChange={() => setAdjustingItem(null)} appSettings={appSettings} />

      <main className="flex-grow overflow-y-auto pb-24">
        <Tabs value={posTab} onValueChange={setPosTab} className="w-full">
            <TabsList className="grid w-full grid-cols-3 rounded-none bg-muted/50 border-b">
                <TabsTrigger value="items"><ShoppingCart className="mr-1 h-4 w-4"/>ITEMS</TabsTrigger>
                <TabsTrigger value="details"><Users2 className="mr-1 h-4 w-4"/>BILL DETAILS</TabsTrigger>
                <TabsTrigger value="payment"><CreditCard className="mr-1 h-4 w-4"/>PAYMENT</TabsTrigger>
            </TabsList>
            
            <TabsContent value="items" className="p-3 space-y-3">
                <div className="flex gap-2">
                    <Select value={pricingTier} onValueChange={(v: any) => updateActiveTabState({ pricingTier: v })}>
                        <SelectTrigger className="w-[120px] h-9"><SelectValue /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="retail">Retail</SelectItem>
                            <SelectItem value="wholesale">Wholesale</SelectItem>
                        </SelectContent>
                    </Select>
                    <div className="relative flex-grow">
                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground"/><Input placeholder="Search product..." className="pl-8 h-9" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}/>
                    </div>
                </div>
                {searchQuery && (
                    <Card className="max-h-60 overflow-y-auto">
                        {filteredInventory.map(item => (
                            <div key={item.id} className="p-3 border-b flex justify-between items-center cursor-pointer hover:bg-muted" onClick={() => handleAddItemToCart(item as any)}>
                                <div className="flex items-center gap-3">
                                    <Avatar className="h-10 w-10 rounded-md">
                                        <AvatarImage src={(item as any).imageUrl}/>
                                        <AvatarFallback><Package/></AvatarFallback>
                                    </Avatar>
                                    <div>
                                        <p className="font-bold text-sm">{item.name}</p>
                                        <p className="text-[10px] text-muted-foreground">
                                            {item.category} {('sku' in item && item.sku) ? ` | SKU: ${item.sku}` : ''}
                                        </p>
                                    </div>
                                </div>
                                <div className="text-right">
                                    <p className="font-bold text-sm">{formatAmount(item.price || 0)}</p>
                                    <Badge variant={item.quantity > 0 ? "outline" : "destructive"} className="text-[10px] h-4">
                                        Stock: {item.quantity === Infinity ? '∞' : item.quantity}
                                    </Badge>
                                </div>
                            </div>
                        ))}
                    </Card>
                )}
                {activeCart.map(item => {
                    const freshItem = inventory.find(i => i.id === item.id);
                    const stockInLocation = freshItem?.stock?.[item.location || 'default'] || 0;
                    const itemTotal = (item.sellPrice * item.sellQuantity) - (item.itemDiscount || 0);
                    const profit = itemTotal - ((item.cost || 0) * item.sellQuantity);
                    return (
                        <Card key={item.cartItemId} className="p-3">
                            <div className="flex justify-between items-start mb-2">
                                <div className="flex gap-3">
                                    <Avatar className="h-12 w-12 rounded-md"><AvatarImage src={item.imageUrl}/><AvatarFallback><Package/></AvatarFallback></Avatar>
                                    <div>
                                        <h4 className="font-bold text-sm">{item.name}</h4>
                                        <div className="flex gap-1 items-center mt-1">
                                            <Select value={item.location} onValueChange={(v) => handleCartItemChange(item.cartItemId, 'location', v)}>
                                                <SelectTrigger className="h-6 text-[10px] w-24">
                                                    <SelectValue placeholder="Location" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {(appSettings?.inventoryLocations || ['default']).map(loc => (
                                                        <SelectItem key={loc} value={loc}>{loc}</SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                            <Badge variant="outline" className="h-6 text-[10px]">Stock: {item.isService ? '∞' : stockInLocation}</Badge>
                                            {!item.isService && (
                                                <>
                                                    <Button variant="outline" size="sm" className="h-6 px-1.5 text-[10px]" onClick={() => setAdjustingItem(item)}>Adjust</Button>
                                                    <Button variant="outline" size="sm" className="h-6 px-1.5" onClick={() => handleRecalculateStock(item.id)} disabled={isRecalculatingStock}>
                                                        {isRecalculatingStock ? <Loader2 className="h-3 w-3 animate-spin"/> : <RefreshCcw className="h-3 w-3"/>}
                                                    </Button>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                </div>
                                <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full" onClick={() => handleRemoveFromCart(item.cartItemId)}><Trash2 className="h-4 w-4 text-red-500"/></Button>
                            </div>
                            <div className="flex justify-between items-center gap-2">
                                <div className="flex items-center gap-1.5">
                                    <Button size="icon" variant="outline" className="h-7 w-7 rounded-full" onClick={() => handleAdjustQuantity(item.cartItemId, -1)}><Minus className="h-3 w-3"/></Button>
                                    <Input type="number" value={item.sellQuantity} className="h-8 w-14 text-center text-sm" onChange={e => handleCartItemChange(item.cartItemId, 'sellQuantity', parseInt(e.target.value) || 1)} />
                                    <Button size="icon" variant="outline" className="h-7 w-7 rounded-full" onClick={() => handleAdjustQuantity(item.cartItemId, 1)}><Plus className="h-3 w-3"/></Button>
                                </div>
                                <Input type="number" value={item.sellPrice} className="h-8 w-24 text-right font-bold text-sm" onChange={e => handleCartItemChange(item.cartItemId, 'sellPrice', parseFloat(e.target.value) || 0)} />
                            </div>
                            <div className="mt-2 pt-2 border-t flex justify-between items-center">
                                <div className="space-y-0.5">
                                    <p className="text-muted-foreground font-bold text-[10px]">CP: {formatAmount(item.cost || 0)}</p>
                                    <p className="font-bold text-xs">Total: {formatAmount(itemTotal)}</p>
                                </div>
                                <div className="flex items-center gap-1">
                                    <Label className="text-[10px] text-muted-foreground uppercase font-bold">Disc:</Label>
                                    <Input type="number" className="h-7 w-20 text-right text-xs" value={item.itemDiscount || ''} onFocus={(e) => e.target.select()} onChange={e => handleCartItemChange(item.cartItemId, 'itemDiscount', parseFloat(e.target.value) || 0)} />
                                </div>
                            </div>
                            <div className={cn("mt-2 p-1 text-[10px] font-bold rounded flex justify-between", profit >= 0 ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700")}>
                                <span>ITEM PROFIT</span><span>{formatAmount(profit)} ({((profit / (Math.max(item.cost, 1) * item.sellQuantity)) * 100).toFixed(1)}%)</span>
                            </div>
                        </Card>
                    );
                })}
            </TabsContent>
            
            <TabsContent value="details" className="p-3 space-y-4">
                <Card className="p-3 space-y-3">
                    <Label className="text-xs font-bold uppercase text-muted-foreground">Customer</Label>
                    <div className="flex gap-2">
                        <PartyCombobox parties={parties} value={selectedPartyId} onChange={id => updateActiveTabState({ selectedPartyId: id })} />
                        <Button variant="outline" size="icon" className="h-10 w-10 shrink-0" onClick={() => setIsNewPartyDialogOpen(true)}><Plus className="h-5 w-5"/></Button>
                    </div>
                    <Label className="text-xs font-bold uppercase text-muted-foreground">Bill Date</Label><DatePicker value={billDate} onChange={d => updateActiveTabState({ billDate: d as Date })} />
                    <Label className="text-xs font-bold uppercase text-muted-foreground">Business Profile</Label>
                    <Select value={selectedVia} onValueChange={(v: any) => updateActiveTabState({ selectedVia: v })}>
                        <SelectTrigger className="h-10"><SelectValue/></SelectTrigger>
                        <SelectContent>{(appSettings?.businessProfiles || []).map(p => <SelectItem key={p.name} value={p.name}>{p.name}</SelectItem>)}</SelectContent>
                    </Select>
                    <Label className="text-xs font-bold uppercase text-muted-foreground">Notes</Label><Textarea value={notes} className="min-h-[80px]" onChange={e => updateActiveTabState({ notes: e.target.value })} />
                    <Card className="border shadow-none"><CardHeader className="p-3 bg-muted/30"><CardTitle className="text-sm flex items-center gap-2 font-bold uppercase tracking-tight"><Truck className="h-4 w-4"/> Delivery</CardTitle></CardHeader>
                        <CardContent className="p-3 space-y-4">
                            <Label className="text-xs font-bold uppercase text-muted-foreground">Delivered By</Label><PartyCombobox parties={deliveryPersonnel} value={deliveryById} onChange={id => updateActiveTabState({ deliveryById: id })} />
                            <Label className="text-xs font-bold uppercase text-muted-foreground">Charge</Label><Input type="number" value={deliveryCharge} className="h-10" onChange={e => updateActiveTabState({ deliveryCharge: parseFloat(e.target.value) || 0 })} />
                            <RadioGroup value={deliveryChargePaidBy} onValueChange={v => updateActiveTabState({ deliveryChargePaidBy: v })} className="flex gap-4">
                                <div className="flex items-center space-x-2"><RadioGroupItem value="customer" id="paid-by-customer" /><Label htmlFor="paid-by-customer" className="text-sm font-medium">Customer</Label></div>
                                <div className="flex items-center space-x-2"><RadioGroupItem value={selectedVia} id="paid-by-profile" /><Label htmlFor="paid-by-profile" className="text-sm font-medium">{selectedVia}</Label></div>
                            </RadioGroup>
                        </CardContent>
                    </Card>
                </Card>
            </TabsContent>
            
            <TabsContent value="payment" className="p-3 space-y-4">
                <Card className="p-4 space-y-4">
                    <div className="space-y-2">
                        <Label className="text-xs font-bold uppercase text-muted-foreground">Sale Type</Label>
                        <Select value={saleType} onValueChange={(v) => updateActiveTabState({ saleType: v as SaleType })}>
                            <SelectTrigger className="h-10"><SelectValue/></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="cash">Cash/Bank Sale</SelectItem>
                                <SelectItem value="credit">Credit Sale</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="flex justify-start">
                        <Button 
                            variant="outline" 
                            size="sm" 
                            className="h-7 px-3 text-[10px] uppercase font-bold" 
                            onClick={handleAddPayment}
                        >
                            <Plus className="h-3 w-3 mr-1"/> Add Payment
                        </Button>
                    </div>

                    <div className="space-y-3">
                        {payments.map((p, i) => (
                            <div key={i} className="flex gap-2 items-end bg-muted/30 p-2 rounded-xl relative border">
                                <div className="flex-grow space-y-1">
                                    <Label className="text-[10px] font-bold text-muted-foreground uppercase">Account</Label>
                                    <Select value={p.accountId} onValueChange={v => handlePaymentChange(i, 'accountId', v)}>
                                        <SelectTrigger className="h-8 text-xs"><SelectValue/></SelectTrigger>
                                        <SelectContent>{accounts.map(acc => <SelectItem key={acc.id} value={acc.id}>{acc.name}</SelectItem>)}</SelectContent>
                                    </Select>
                                </div>
                                <div className="w-24 space-y-1">
                                    <Label className="text-[10px] font-bold text-muted-foreground uppercase">Amount</Label>
                                    <Input type="number" className="h-8 text-right text-xs" value={p.amount || ''} onFocus={(e) => e.target.select()} onChange={e => handlePaymentChange(i, 'amount', parseFloat(e.target.value) || 0)}/>
                                </div>
                                <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:bg-destructive/10" onClick={() => handleRemovePayment(i)}><Trash2 className="h-4 w-4"/></Button>
                            </div>
                        ))}
                    </div>

                    <div className="space-y-2 border-b pb-4">
                        <div className="flex justify-between items-center text-sm font-medium"><span className="text-muted-foreground uppercase text-[10px] font-bold">Sub Total</span><span className="font-mono">{formatAmount(subTotalAmount)}</span></div>
                        <div className="flex justify-between items-center text-sm font-medium text-red-500"><span className="text-muted-foreground uppercase text-[10px] font-bold">Discount</span><span className="font-mono">-{formatAmount(discount + totalItemDisc)}</span></div>
                        <Separator/>
                        <div className="flex justify-between items-center font-black text-lg">
                            <span className="uppercase text-xs text-muted-foreground">Net Payable</span>
                            <span className="text-primary font-mono">{formatAmount(finalPayableAmount)}</span>
                        </div>
                    </div>

                    <div className="p-3 rounded-2xl bg-red-50 dark:bg-red-900/20 flex justify-between items-center border border-red-100 dark:border-red-800">
                        <span className="text-xs font-bold text-red-600 uppercase tracking-tighter">Due Amount</span>
                        <span className="text-xl font-black text-red-700 font-mono">{formatAmount(dueAmount)}</span>
                    </div>
                    
                    <div className="flex items-center justify-between gap-4 pt-2">
                        <Label htmlFor="overall-discount" className="font-bold text-xs uppercase text-muted-foreground">Overall Discount</Label>
                        <Input 
                            id="overall-discount"
                            type="number" 
                            className="w-32 text-right h-10 font-black text-red-600"
                            value={discount || ''} 
                            onFocus={(e) => e.target.select()} 
                            onChange={e => updateActiveTabState({ discount: parseFloat(e.target.value) || 0 })} 
                            placeholder="0.00"
                        />
                    </div>

                    <div className="flex items-center justify-center gap-2 py-2">
                        <Switch checked={sendSmsOnSave} onCheckedChange={v => updateActiveTabState({ sendSmsOnSave: v })} />
                        <Label className="text-xs font-bold uppercase text-muted-foreground">Send SMS</Label>
                    </div>
                    
                    <Button 
                        className="w-full h-12 bg-green-600 hover:bg-green-700 text-base font-bold shadow-lg rounded-2xl transition-all active:scale-95" 
                        onClick={handleCompleteSale} 
                        disabled={isSaving || activeCart.length === 0}
                    >
                        {isSaving ? <Loader2 className="animate-spin mr-2 h-5 w-5" /> : <Save className="mr-2 h-5 w-5" />}
                        Complete Sale
                    </Button>
                </Card>
            </TabsContent>
        </Tabs>
      </main>

      <footer className="fixed bottom-0 bg-white/80 backdrop-blur-md dark:bg-gray-950 border-t shadow-[0_-4px_10px_rgba(0,0,0,0.05)] p-3 w-full z-10">
        <div className="flex justify-between items-center text-[10px] font-bold text-muted-foreground uppercase mb-1">
            <span className="flex items-center gap-1"><ShoppingCart className="h-3 w-3"/> Items {activeCart.length} (Qty {totalItemsCount})</span>
            <span className="font-mono">Sub: {formatAmount(subTotalAmount)}</span>
        </div>
        <div className="flex justify-between items-center font-black">
            <div className="flex items-center gap-1.5 max-w-[60%]">
                <div className="p-1.5 rounded-full bg-primary/10 text-primary"><User className="h-3.5 w-3.5"/></div>
                <span className="truncate text-sm text-gray-700 dark:text-gray-200">{parties.find(p => p.id === selectedPartyId)?.name || 'Walk-in Customer'}</span>
            </div>
            <span className="text-lg text-primary font-mono">{formatAmount(finalPayableAmount)}</span>
        </div>
      </footer>
    </div>
  );
}

export default function PosPageWrapper() {
  return (
    <Suspense fallback={
        <div className="flex justify-center items-center h-screen">
            <Loader2 className="h-12 w-12 animate-spin text-primary" />
        </div>
    }>
        <PosPage />
    </Suspense>
  );
}