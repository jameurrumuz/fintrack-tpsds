
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
import { Plus, Trash2, Save, Users, Loader2, ArrowLeft, Printer, Share2, ShoppingCart, User, Building, Phone, MapPin, ChevronsUpDown, Check, Calendar as CalendarIcon, Minus, ImageIcon, Camera, Upload, Truck, DollarSign, ScanLine, Pencil, Copy, Users2, CreditCard, Search, Package, Settings, X } from 'lucide-react';
import { subscribeToParties, addParty } from '@/services/partyService';
import { subscribeToInventoryItems, addInventoryItem } from '@/services/inventoryService';
import { addTransaction, subscribeToAllTransactions } from '@/services/transactionService';
import { handleSmsNotification } from '@/services/possmsnotificationService';
import { subscribeToAccounts } from '@/services/accountService';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import type { Party, InventoryItem, TransactionVia, Account, Payment, Transaction, AppSettings, InventoryCategory, Quotation } from '@/types';
import { formatAmount } from '@/lib/utils';
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
import { writeBatch, doc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { cleanUndefined, getPartyBalanceEffect } from '@/lib/utils';
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
                    className="w-full justify-between font-normal h-10"
                >
                    {value && selectedParty ? selectedParty.name : placeholder}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[320px] p-0" align="start">
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

export default function PosPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const partyIdFromQuery = searchParams.get('partyId');
  const quotationIdFromQuery = searchParams.get('quotationId');
  const { toast } = useToast();

  const [parties, setParties] = useState<Party[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [transactions, setTransactions] = useState<Transaction[]>([]);

  const [tabs, setTabs] = useState<SaleTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string>('');
  const [posTab, setPosTab] = useState('items');

  const [isSaving, setIsSaving] = useState(false);
  const [isInvoiceDialogOpen, setIsInvoiceDialogOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [isItemFormOpen, setIsItemFormOpen] = useState(false);
  const [isNewPartyDialogOpen, setIsNewPartyDialogOpen] = useState(false);
  const [adjustingItem, setAdjustingItem] = useState<InventoryItem | null>(null);

  const activeTabIndex = useMemo(() => tabs.findIndex(tab => tab.id === activeTabId), [tabs, activeTabId]);
  const activeTabState = useMemo(() => tabs[activeTabIndex]?.state, [tabs, activeTabIndex]);

  const updateActiveTabState = useCallback((newState: Partial<SaleState> | ((prevState: SaleState) => Partial<SaleState>)) => {
    setTabs(prevTabs => {
      const activeIndex = prevTabs.findIndex(tab => tab.id === activeTabId);
      if (activeIndex === -1) return prevTabs;
      const newTabs = [...prevTabs];
      const oldState = newTabs[activeIndex].state;
      const updatedFields = typeof newState === 'function' ? newState(oldState) : newState;
      newTabs[activeIndex] = { ...newTabs[activeIndex], state: { ...oldState, ...updatedFields } };
      return newTabs;
    });
  }, [activeTabId]);

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
    setLoading(true);
    subscribeToParties(setParties, console.error);
    subscribeToInventoryItems(setInventory, console.error);
    subscribeToAccounts(setAccounts, console.error);
    subscribeToAllTransactions(setTransactions, console.error);
    getAppSettings().then(settings => {
      setAppSettings(settings);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (!loading && tabs.length === 0 && appSettings) {
        createNewTab();
    }
  }, [loading, tabs.length, createNewTab, appSettings]);

  const handleAddItemToCart = useCallback((item: InventoryItem) => {
    updateActiveTabState(prev => {
        const fresh = inventory.find(i => i.id === item.id);
        if (!fresh) return prev;
        
        const sellPrice = prev.pricingTier === 'wholesale' && fresh.wholesalePrice ? fresh.wholesalePrice : fresh.price;
        const loc = fresh.via || appSettings?.inventoryLocations?.[0] || 'default';
        const existingIdx = prev.cart.findIndex(c => c.id === fresh.id && c.location === loc);
        let newCart = [...prev.cart];
        
        if (existingIdx > -1) {
            const existing = newCart[existingIdx];
            const stockAtLoc = fresh.stock?.[loc] || 0;
            if (existing.sellQuantity < stockAtLoc) {
                newCart[existingIdx] = { ...existing, sellQuantity: existing.sellQuantity + 1 };
            } else {
                 toast({ variant: 'destructive', title: 'Stock Limit', description: `Only ${stockAtLoc} available in ${loc}.` });
            }
        } else {
            newCart.push({ 
                ...fresh, 
                cartItemId: `cart-${Date.now()}`, 
                sellQuantity: 1, 
                sellPrice, 
                location: loc 
            } as CartItem);
        }
        return { cart: newCart };
    });
    setSearchQuery('');
  }, [updateActiveTabState, inventory, appSettings, toast]);

  const handleAdjustQuantity = useCallback((cartItemId: string, amount: number) => {
    updateActiveTabState(prev => {
        const updatedCart = prev.cart.map(item => {
            if (item.cartItemId === cartItemId) {
                const newQuantity = item.sellQuantity + amount;
                const stockInLocation = item.stock?.[item.location || 'default'] || 0;
                if (newQuantity > 0 && newQuantity <= stockInLocation) {
                    return { ...item, sellQuantity: newQuantity };
                } else if (newQuantity > stockInLocation) {
                    toast({ variant: 'destructive', title: 'Stock Limit Exceeded', description: `Only ${stockInLocation} units of ${item.name} available.` });
                }
            }
            return item;
        }).filter(item => item.sellQuantity > 0);
        return { cart: updatedCart };
    });
  }, [updateActiveTabState, toast]);

  const handleCartItemChange = useCallback((cartItemId: string, field: string, value: any) => {
    updateActiveTabState(prev => ({
        cart: prev.cart.map(item => {
            if (item.cartItemId === cartItemId) {
                return { ...item, [field]: value };
            }
            return item;
        })
    }));
  }, [updateActiveTabState]);

  const handleRemoveFromCart = useCallback((cartItemId: string) => {
    updateActiveTabState(prev => ({
        cart: prev.cart.filter(item => item.cartItemId !== cartItemId)
    }));
  }, [updateActiveTabState]);

  const handleCompleteSale = async () => {
    if (!activeTabState) return;
    const { cart, selectedPartyId, billDate, deliveryById, deliveryCharge, deliveryChargePaidBy, payDeliveryChargeNow, discount, payments, notes, sendSmsOnSave, selectedVia } = activeTabState;

    if (cart.length === 0) {
      toast({ variant: 'destructive', title: 'Empty Cart', description: 'Your cart is empty.' });
      return;
    }
  
    setIsSaving(true);
    try {
      const batch = writeBatch(db);
      const saleDate = format(billDate, 'yyyy-MM-dd');
      const invoiceNumber = `INV-${Date.now()}`;
      
      const totalItemValue = cart.reduce((sum, i) => sum + (i.sellPrice * i.sellQuantity), 0);
      const finalAmount = totalItemValue - discount + (deliveryChargePaidBy === 'customer' ? deliveryCharge : 0);
      const paidAmount = payments.reduce((sum, p) => sum + p.amount, 0);
      const dueAmount = finalAmount - paidAmount;

      const txData: Omit<Transaction, 'id'> = {
          date: saleDate,
          via: selectedVia,
          items: cart.map(i => ({ id: i.id, name: i.name, quantity: i.sellQuantity, price: i.sellPrice, cost: i.cost, location: i.location })),
          invoiceNumber,
          amount: finalAmount,
          partyId: selectedPartyId || 'walkin',
          description: notes || `Sale Invoice: ${invoiceNumber}`,
          type: dueAmount > 0.01 ? 'credit_sale' : 'sale',
          payments: dueAmount > 0.01 ? undefined : payments,
          enabled: true,
          sendSms: sendSmsOnSave,
      };

      const saleRef = doc(collection(db, 'transactions'));
      batch.set(saleRef, cleanUndefined(txData));
      
      await batch.commit();
      toast({ title: 'Sale Completed' });
      router.push('/transactions');
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Sale Failed', description: error.message });
    } finally {
      setIsSaving(false);
    }
  };

  const handleCloseTab = (id: string) => {
    setTabs(prev => {
        if (prev.length === 1) return prev;
        const newTabs = prev.filter(t => t.id !== id);
        if (activeTabId === id) setActiveTabId(newTabs[0].id);
        return newTabs;
    });
  }

  if (loading || !appSettings || accounts.length === 0) {
    return <div className="flex justify-center items-center h-screen"><Loader2 className="animate-spin h-12 w-12 text-primary" /></div>;
  }
  if (!activeTabState) {
    return <div className="flex justify-center items-center h-screen">Loading session...</div>;
  }

  const subTotalAmount = activeTabState.cart.reduce((sum, item) => sum + (item.sellPrice * item.sellQuantity), 0);
  const finalPayableAmount = subTotalAmount - activeTabState.discount + (activeTabState.deliveryChargePaidBy === 'customer' ? activeTabState.deliveryCharge : 0);
  const totalPaid = activeTabState.payments.reduce((sum, p) => sum + p.amount, 0);
  const dueAmount = finalPayableAmount - totalPaid;

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-black flex flex-col">
      <header className="bg-primary text-primary-foreground p-2 flex items-center justify-between shadow-md">
        <div className="flex items-center gap-1 overflow-x-auto">
            <Button variant="ghost" size="icon" onClick={() => router.back()} className="text-white shrink-0"><ArrowLeft /></Button>
            {tabs.map(tab => (
                <Button 
                  key={tab.id} 
                  variant={tab.id === activeTabId ? 'secondary' : 'ghost'}
                  className="h-auto px-3 py-1.5 text-sm shrink-0 flex items-center gap-1.5"
                  onClick={() => setActiveTabId(tab.id)}
                >
                  {tab.name}
                  <X className="h-4 w-4" onClick={(e) => { e.stopPropagation(); handleCloseTab(tab.id); }}/>
                </Button>
            ))}
            <Button variant="ghost" size="icon" onClick={() => createNewTab()} className="text-white shrink-0"><Plus /></Button>
        </div>
      </header>

      <main className="flex-grow overflow-y-auto pb-24">
        <Tabs value={posTab} onValueChange={setPosTab} className="w-full">
            <TabsList className="grid w-full grid-cols-3 rounded-none">
                <TabsTrigger value="items">ITEMS</TabsTrigger>
                <TabsTrigger value="details">BILL DETAILS</TabsTrigger>
                <TabsTrigger value="payment">PAYMENT</TabsTrigger>
            </TabsList>
            
            <TabsContent value="items" className="p-3 space-y-3">
                <div className="relative"><Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground"/><Input placeholder="Search..." className="pl-8" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}/></div>
                {searchQuery && (
                    <div className="bg-background border rounded-lg p-2 space-y-2 max-h-60 overflow-y-auto">
                        {filteredInventory.map(item => (
                            <div key={item.id} className="flex justify-between items-center p-2 border-b last:border-b-0 cursor-pointer hover:bg-muted" onClick={() => handleAddItemToCart(item)}>
                                <span>{item.name}</span>
                                <span className="font-bold">৳{item.price}</span>
                            </div>
                        ))}
                    </div>
                )}
                {activeTabState.cart.map(item => {
                    const freshItem = inventory.find(i => i.id === item.id);
                    return (
                        <Card key={item.cartItemId} className="p-3">
                            <div className="flex justify-between items-start mb-2">
                                <div className="flex gap-3">
                                    <Avatar className="h-10 w-10 rounded-md"><AvatarImage src={item.imageUrl}/><AvatarFallback><Package/></AvatarFallback></Avatar>
                                    <div>
                                        <h4 className="font-bold text-sm">{item.name}</h4>
                                        <div className="flex gap-1 mt-1">
                                            <Select value={item.location} onValueChange={(v) => handleCartItemChange(item.cartItemId, 'location', v)}>
                                                <SelectTrigger className="h-6 text-[10px] w-32">
                                                    <SelectValue placeholder="Location" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {(appSettings?.inventoryLocations || ['default']).map(loc => {
                                                        const stockAtLocation = freshItem?.stock?.[loc] || 0;
                                                        return (
                                                            <SelectItem key={loc} value={loc}>
                                                                {loc} (Stock: {stockAtLocation})
                                                            </SelectItem>
                                                        )
                                                    })}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                    </div>
                                </div>
                                <Button variant="ghost" size="icon" onClick={() => handleRemoveFromCart(item.cartItemId)}><Trash2 className="h-4 w-4 text-red-500"/></Button>
                            </div>
                            <div className="flex justify-between items-center">
                                <div className="flex items-center gap-1.5">
                                    <Button size="icon" variant="outline" className="h-7 w-7 rounded-full" onClick={() => handleAdjustQuantity(item.cartItemId, -1)}><Minus className="h-3 w-3"/></Button>
                                    <span className="w-8 text-center font-bold">{item.sellQuantity}</span>
                                    <Button size="icon" variant="outline" className="h-7 w-7 rounded-full" onClick={() => handleAdjustQuantity(item.cartItemId, 1)}><Plus className="h-3 w-3"/></Button>
                                </div>
                                <p className="font-bold">৳{formatAmount(item.sellPrice * item.sellQuantity, false)}</p>
                            </div>
                        </Card>
                    );
                })}
            </TabsContent>
            
            <TabsContent value="details" className="p-3 space-y-4">
                <Card className="p-3 space-y-3">
                    <Label className="text-xs font-bold uppercase">Customer</Label>
                    <PartyCombobox parties={parties} value={activeTabState.selectedPartyId} onChange={id => updateActiveTabState({ selectedPartyId: id })} />
                    <Label className="text-xs font-bold uppercase">Bill Date</Label><DatePicker value={activeTabState.billDate} onChange={d => updateActiveTabState({ billDate: d as Date })} />
                    <Label className="text-xs font-bold uppercase">Business Profile</Label>
                    <Select value={activeTabState.selectedVia} onValueChange={(v: any) => updateActiveTabState({ selectedVia: v })}>
                        <SelectTrigger><SelectValue placeholder="Select Profile" /></SelectTrigger>
                        <SelectContent>{(appSettings?.businessProfiles || []).map(p => <SelectItem key={p.name} value={p.name}>{p.name}</SelectItem>)}</SelectContent>
                    </Select>
                    <Label className="text-xs font-bold uppercase">Notes</Label><Textarea value={activeTabState.notes} onChange={e => updateActiveTabState({ notes: e.target.value })} />
                </Card>
            </TabsContent>
            
            <TabsContent value="payment" className="p-3 space-y-4">
                <Card className="p-4 space-y-4">
                    <div className="flex justify-between items-center text-lg font-bold"><span>Total Payable</span><span className="text-primary">{formatAmount(finalPayableAmount)}</span></div>
                    <div className="p-3 rounded-xl bg-red-50 dark:bg-red-900/20 flex justify-between items-center">
                        <span className="text-xs font-bold text-red-600 uppercase">Due Amount</span>
                        <span className="text-xl font-black text-red-700">{formatAmount(dueAmount)}</span>
                    </div>
                    <div className="flex items-center justify-center gap-2 py-2">
                        <Switch id="send-sms" checked={activeTabState.sendSmsOnSave} onCheckedChange={v => updateActiveTabState({ sendSmsOnSave: v })} />
                        <Label htmlFor="send-sms">Send SMS</Label>
                    </div>
                    <Button className="w-full h-12 text-base font-bold" onClick={handleCompleteSale} disabled={isSaving}>
                        {isSaving ? <Loader2 className="animate-spin mr-2" /> : <Save className="mr-2" />} Complete Sale
                    </Button>
                </Card>
            </TabsContent>
        </Tabs>
      </main>

      <footer className="fixed bottom-0 bg-white dark:bg-gray-950 border-t p-3 w-full z-10">
        <div className="flex justify-between items-center font-black">
            <span className="text-sm">Items: {activeTabState.cart.length}</span>
            <span className="text-lg text-primary">{formatAmount(finalPayableAmount)}</span>
        </div>
      </footer>
    </div>
  );
}

export default function PosPageWrapper() {
  return <PosPage />;
}
