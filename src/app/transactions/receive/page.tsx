
'use client';

import React, { useState, useEffect, Suspense, useMemo, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DatePicker } from '@/components/ui/date-picker';
import { useToast } from '@/hooks/use-toast';
import { addTransaction, subscribeToAllTransactions } from '@/services/transactionService';
import { subscribeToAccounts } from '@/services/accountService';
import { subscribeToInventoryItems, addInventoryItem } from '@/services/inventoryService';
import { getAppSettings } from '@/services/settingsService';
import { subscribeToParties } from '@/services/partyService';
import type { Party, Account, AppSettings, Transaction, InventoryItem, TransactionVia } from '@/types';
import { formatAmount, getPartyBalanceEffect } from '@/lib/utils';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';

import {
  ArrowLeft,
  Save,
  Loader2,
  Package,
  Trash2,
  Plus,
  Wallet,
  Receipt,
  ArrowDownToLine,
  HandCoins,
  X,
  ChevronDown
} from 'lucide-react';
import { format as formatFns, parseISO, isValid } from 'date-fns';
import { Switch } from '@/components/ui/switch';

interface ReceivedItem {
    id: string;
    name: string;
    quantity: number;
    price: number;
    salePrice: number;
    wholesalePrice: number;
    category: string;
    isNew: boolean;
    location?: string;
    batchNumber?: string;
    expiryDate?: string;
    receiveDate?: string;
}

const receiveAsOptions = [
    { value: 'cash_bank', label: 'Payment', icon: Wallet, mobileLabel: 'Payment' },
    { value: 'credit_purchase', label: 'Credit Purchase', icon: Receipt, mobileLabel: 'Credit' },
    { value: 'cash_purchase', label: 'Cash Purchase', icon: Package, mobileLabel: 'Cash' },
    { value: 'income', label: 'Other Income', icon: ArrowDownToLine, mobileLabel: 'Income' },
    { value: 'credit_income', label: 'Credit Income', icon: HandCoins, mobileLabel: 'Cr Income' },
];

function ReceiveTransactionPage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const partyId = searchParams.get('partyId') || '';
    const partyName = searchParams.get('partyName') || 'Unknown';
    
    const [accounts, setAccounts] = useState<Account[]>([]);
    const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
    const [parties, setParties] = useState<Party[]>([]);
    const [allTransactions, setAllTransactions] = useState<Transaction[]>([]);
    const [appSettings, setAppSettings] = useState<AppSettings | null>(null);
    const [receivedItems, setReceivedItems] = useState<ReceivedItem[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [windowWidth, setWindowWidth] = useState(0);

    const [amount, setAmount] = useState('');
    const [date, setDate] = useState<Date>(new Date());
    const [note, setNote] = useState('');
    const [via, setVia] = useState<TransactionVia>('Personal');

    const [receivedAs, setReceivedAs] = useState<'cash_bank' | 'credit_purchase' | 'cash_purchase' | 'income' | 'credit_income'>('cash_bank');
    const [accountId, setAccountId] = useState('');
    const [sendSmsOnSave, setSendSmsOnSave] = useState(true);

    const [isSaving, setIsSaving] = useState(false);
    const { toast } = useToast();

    useEffect(() => {
        const handleResize = () => setWindowWidth(window.innerWidth);
        handleResize();
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);
    
    useEffect(() => {
        let isMounted = true;
        setIsLoading(true);
        
        getAppSettings().then(s => isMounted && setAppSettings(s));
        const unsubAcc = subscribeToAccounts(d => isMounted && setAccounts(d), console.error);
        const unsubInv = subscribeToInventoryItems(d => isMounted && setInventoryItems(d), console.error);
        const unsubParties = subscribeToParties(d => isMounted && setParties(d), console.error);
        const unsubTx = subscribeToAllTransactions(d => isMounted && setAllTransactions(d), console.error);
        
        setTimeout(() => isMounted && setIsLoading(false), 800);
        return () => { isMounted = false; unsubAcc(); unsubInv(); unsubParties(); unsubTx(); };
    }, []);

    useEffect(() => {
        if (accounts.length > 0 && !accountId) {
            const cash = accounts.find(a => a.name?.toLowerCase() === 'cash');
            setAccountId(cash?.id || accounts[0].id);
        }
    }, [accounts, accountId]);
    
    const currentPartyBalance = useMemo(() => {
        return allTransactions
            .filter(t => t.partyId === partyId && t.enabled)
            .reduce((balance, tx) => balance + getPartyBalanceEffect(tx, false), 0);
    }, [allTransactions, partyId]);

    const partyBalanceText = useMemo(() => {
        if (currentPartyBalance > 0.01) return `Payable: ${formatAmount(currentPartyBalance)}`;
        if (currentPartyBalance < -0.01) return `Receivable: ${formatAmount(Math.abs(currentPartyBalance))}`;
        return 'Balance: 0.00';
    }, [currentPartyBalance]);

    useEffect(() => {
        if (partyId && parties.length > 0) {
            const p = parties.find(p => p.id === partyId);
            if (p?.group) setVia(p.group as TransactionVia);
            else if (appSettings?.businessProfiles?.[0]) setVia(appSettings.businessProfiles[0].name as TransactionVia);
        }
    }, [partyId, parties, appSettings]);

    const totalAmountValue = useMemo(() => {
        if ((receivedAs === 'credit_purchase' || receivedAs === 'cash_purchase') && receivedItems.length > 0) {
            return receivedItems.reduce((sum, item) => sum + ((item.price || 0) * (item.quantity || 0)), 0);
        }
        return parseFloat(amount) || 0;
    }, [receivedItems, receivedAs, amount]);
    
    const handleAddItem = () => {
        const newItem: ReceivedItem = { 
            id: `new-${Date.now()}`, 
            name: '', quantity: 1, price: 0, salePrice: 0, wholesalePrice: 0, 
            category: appSettings?.inventoryCategories?.[0]?.name || 'Uncategorized', 
            isNew: true, location: appSettings?.inventoryLocations?.[0] || 'default',
            batchNumber: `B${Date.now()}`, receiveDate: formatFns(new Date(), 'yyyy-MM-dd'), expiryDate: '',
        };
        setReceivedItems([...receivedItems, newItem]);
    };
    
    const handleItemChange = (index: number, field: keyof ReceivedItem, value: any) => {
        const newItems = [...receivedItems];
        if (field === 'id') {
            const selected = inventoryItems.find(i => i.id === value);
            if (selected) {
                newItems[index] = { ...newItems[index], id: selected.id, name: selected.name, price: selected.cost, salePrice: selected.price, wholesalePrice: selected.wholesalePrice || 0, isNew: false };
            }
        } else {
            (newItems[index] as any)[field] = value;
        }
        setReceivedItems(newItems);
    }

    const handleSave = async () => {
        if (totalAmountValue <= 0) {
            toast({ variant: 'destructive', title: 'Invalid Amount' });
            return;
        }
        setIsSaving(true);
        try {
            let txType: Transaction['type'] = 'receive';
            let txAccountId: string | undefined = (receivedAs === 'cash_bank' || receivedAs === 'income' || receivedAs === 'cash_purchase') ? accountId : undefined;
            
            if (receivedAs === 'credit_purchase') txType = 'credit_purchase';
            else if (receivedAs === 'cash_purchase') txType = 'purchase';
            else if (receivedAs === 'income') txType = 'income';
            else if (receivedAs === 'credit_income') txType = 'credit_income';

            const itemsToSave = (receivedAs === 'credit_purchase' || receivedAs === 'cash_purchase') ? receivedItems.map(item => ({
                id: item.id, name: item.name, quantity: item.quantity, price: item.price, location: item.location
            })) : undefined;

            await addTransaction({
                date: formatFns(date, 'yyyy-MM-dd'),
                amount: totalAmountValue,
                type: txType,
                partyId: partyId || undefined,
                description: note || `Received ${receivedAs.replace('_', ' ')} from ${partyName}`,
                accountId: txAccountId,
                items: itemsToSave,
                via: via,
                enabled: true,
            });
            
            toast({ title: 'Success', description: 'Transaction recorded.' });
            router.back();
        } catch (error: any) {
            toast({ variant: 'destructive', title: 'Error', description: error.message });
        } finally {
            setIsSaving(false);
        }
    };
    
    const isMobile = windowWidth < 768;

    return (
        <div className="flex flex-col h-screen bg-gray-100 overflow-hidden w-full relative">
            <header className="bg-blue-600 text-white p-3 flex items-center justify-between shadow-md z-10 w-full">
                <Button variant="ghost" size="icon" onClick={() => router.back()} className="text-white shrink-0"><ArrowLeft className="h-5 w-5" /></Button>
                <div className="text-center flex-1 min-w-0 px-2">
                    <h1 className="text-sm font-semibold truncate">I Received From</h1>
                    <p className="text-xs opacity-90 truncate">{partyName}</p>
                    <p className="text-xs font-bold truncate">{partyBalanceText}</p>
                </div>
                <div className="w-10 shrink-0"/>
            </header>

            <main className="flex-1 overflow-y-auto p-2">
                <div className="bg-white rounded-lg shadow-sm p-4 space-y-4">
                    <div className="space-y-2">
                        <label className="text-xs font-medium uppercase text-gray-500">Receive as</label>
                        <div className="grid grid-cols-5 gap-1 bg-gray-100 p-1 rounded-lg">
                            {receiveAsOptions.map(option => (
                                <button
                                    key={option.value}
                                    type="button"
                                    onClick={() => setReceivedAs(option.value as any)}
                                    className={cn(
                                        "flex flex-col items-center justify-center gap-1 p-2 rounded-md transition-all",
                                        receivedAs === option.value ? "bg-white text-blue-600 shadow-sm" : "text-gray-500"
                                    )}
                                >
                                    <option.icon className="h-4 w-4" />
                                    <span className="text-[9px] font-bold leading-tight text-center">{isMobile ? option.mobileLabel : option.label}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                            <label className="text-xs font-bold text-gray-400 uppercase">Date</label>
                            <DatePicker value={date} onChange={(d) => d && setDate(d as Date)} />
                        </div>
                        {(receivedAs === 'cash_bank' || receivedAs === 'income' || receivedAs === 'credit_income') && (
                            <div className="space-y-1">
                                <label className="text-xs font-bold text-gray-400 uppercase">Amount (৳)</label>
                                <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" className="text-lg font-bold" />
                            </div>
                        )}
                    </div>
                    
                    <div className="grid grid-cols-2 gap-4">
                        {(receivedAs === 'cash_bank' || receivedAs === 'income' || receivedAs === 'cash_purchase') && (
                            <div className="space-y-1">
                                <label className="text-xs font-bold text-gray-400 uppercase">Account</label>
                                <Select value={accountId} onValueChange={setAccountId}>
                                    <SelectTrigger className="h-10"><SelectValue placeholder="Select account..." /></SelectTrigger>
                                    <SelectContent>
                                        {accounts.map(acc => (
                                            <SelectItem key={acc.id} value={acc.id}>
                                                {acc.name} ({formatAmount(acc.balance || 0)})
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        )}
                        <div className="space-y-1">
                            <label className="text-xs font-bold text-gray-400 uppercase">Business Profile</label>
                            <Select value={via} onValueChange={(v) => setVia(v as TransactionVia)}>
                                <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                                <SelectContent>{(appSettings?.businessProfiles || []).map(p => <SelectItem key={p.name} value={p.name}>{p.name}</SelectItem>)}</SelectContent>
                            </Select>
                        </div>
                    </div>

                    {(receivedAs === 'credit_purchase' || receivedAs === 'cash_purchase') && (
                        <div className="border rounded-lg p-3 space-y-3 bg-gray-50">
                            <div className="flex justify-between items-center"><h4 className="text-xs font-bold uppercase text-gray-500 flex items-center gap-2"><Package className="h-4 w-4"/> Items</h4></div>
                            <div className="space-y-3">
                                {receivedItems.map((item, index) => (
                                    <div key={index} className="p-3 bg-white rounded-md border shadow-sm relative">
                                        <Button variant="ghost" size="icon" onClick={() => handleRemoveItem(index)} className="absolute top-1 right-1 h-6 w-6"><X className="h-4 w-4 text-red-500"/></Button>
                                        <div className="space-y-2">
                                            <Select value={item.isNew ? '' : item.id} onValueChange={v => handleItemChange(index, 'id', v)}>
                                                <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Select Product..." /></SelectTrigger>
                                                <SelectContent>{inventoryItems.map(i => <SelectItem key={i.id} value={i.id}>{i.name}</SelectItem>)}</SelectContent>
                                            </Select>
                                            {item.isNew && <Input placeholder="New Item Name" value={item.name} onChange={e => handleItemChange(index, 'name', e.target.value)} className="h-8 text-sm" />}
                                            <div className="grid grid-cols-2 gap-2">
                                                <div className="space-y-1"><Label className="text-[10px] uppercase">Qty</Label><Input type="number" value={item.quantity} onChange={e => handleItemChange(index, 'quantity', parseInt(e.target.value) || 1)} className="h-8" /></div>
                                                <div className="space-y-1"><Label className="text-[10px] uppercase">Price</Label><Input type="number" value={item.price} onChange={e => handleItemChange(index, 'price', parseFloat(e.target.value) || 0)} className="h-8" /></div>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                                <Button variant="outline" size="sm" onClick={handleAddItem} className="w-full h-9 border-dashed"><Plus className="h-4 w-4 mr-2"/> Add Item</Button>
                            </div>
                        </div>
                    )}
                    
                    <div className="space-y-1">
                        <label className="text-xs font-bold text-gray-400 uppercase">Add Note (Optional)</label>
                        <Textarea value={note} onChange={e => setNote(e.target.value)} rows={2} className="resize-none" />
                    </div>
                </div>
            </main>

            <footer className="bg-white border-t p-4 space-y-3 z-10 w-full shadow-[0_-2px_10px_rgba(0,0,0,0.05)]">
                <div className="flex justify-between items-end px-2">
                    <div className="text-left">
                        <p className="text-[10px] font-bold text-gray-400 uppercase">Total Amount</p>
                        <p className="text-2xl font-black text-blue-600">৳{totalAmountValue.toLocaleString()}</p>
                    </div>
                    <div className="flex items-center gap-3">
                        <div className="flex items-center gap-2 bg-gray-50 p-2 rounded-lg border">
                            <Switch checked={sendSmsOnSave} onCheckedChange={setSendSmsOnSave} />
                            <label className="text-[10px] font-bold uppercase cursor-pointer">Send SMS</label>
                        </div>
                    </div>
                </div>
                <Button className="w-full h-12 text-base font-bold bg-blue-600 hover:bg-blue-700 shadow-lg rounded-xl" onClick={handleSave} disabled={isSaving}>
                    {isSaving ? <Loader2 className="animate-spin mr-2 h-5 w-5" /> : <Save className="mr-2 h-5 w-5" />}
                    Save Transaction
                </Button>
            </footer>
        </div>
    );
}

export default function ReceiveTransactionPageWrapper() {
    return (
        <Suspense fallback={<div className="flex items-center justify-center h-screen"><Loader2 className="h-12 w-12 animate-spin text-primary" /></div>}>
            <ReceiveTransactionPage />
        </Suspense>
    );
}
