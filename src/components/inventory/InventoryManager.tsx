'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import type { InventoryItem, InventoryCategory, Party, AppSettings, Transaction, InventoryMovement } from '@/types';
import { 
  subscribeToInventoryItems, 
  subscribeToInventoryCategories, 
  addInventoryItem, 
  updateInventoryItem, 
  deleteInventoryItem, 
  recordInventoryMovement, 
  recalculateStockForItem, 
  recalculateAllStocks 
} from '@/services/inventoryService';
import { subscribeToParties } from '@/services/partyService';
import { subscribeToAllTransactions } from '@/services/transactionService';
import { getAppSettings } from '@/services/settingsService';
import { uploadImage } from '@/services/storageService';
import { useToast } from '@/hooks/use-toast';
import { useRouter, useSearchParams } from 'next/navigation';

import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription as AlertDialogDescriptionComponent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipProvider, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

import { Archive, Plus, Edit, Trash2, MoreVertical, Search, Package, ImageIcon, Camera, Upload, ChevronsUpDown, Check, RefreshCcw, AlertTriangle, SlidersHorizontal, Loader2, X, Grid, List, Boxes, DollarSign, ShoppingCart, Settings, FileText, History, Download } from 'lucide-react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { cn, formatAmount, formatDate } from '@/lib/utils';
import Image from 'next/image';
import { CameraCaptureDialog } from '../ui/camera-capture-dialog';

const itemSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  category: z.string().min(1, "Category is required"),
  brand: z.string().optional(),
  minStockLevel: z.coerce.number().min(0, "Min. stock level must be non-negative"),
  sku: z.string().min(1, "SKU is required"),
  via: z.string().optional(),
  location: z.string().optional(),
  barcode: z.string().optional(),
  supplier: z.string().optional(),
  imageUrl: z.string().optional(),
  price: z.coerce.number().min(0, "Price must be non-negative"),
  wholesalePrice: z.coerce.number().min(0, "Wholesale price must be non-negative"),
  cost: z.coerce.number().min(0, "Cost must be non-negative"),
});
type ItemFormValues = z.infer<typeof itemSchema>;

// Summary Card Component
const SummaryCard = ({ title, value, icon: Icon, colorClass }: { title: string; value: string | number; icon: any; colorClass: string }) => (
    <Card className="shadow-sm border-0">
        <CardContent className="p-4 flex flex-col gap-1">
            <div className="flex justify-between items-start">
                <p className="text-sm font-semibold text-muted-foreground">{title}</p>
                <div className={cn("p-1.5 rounded-lg bg-muted", colorClass)}>
                    <Icon className="h-4 w-4" />
                </div>
            </div>
            <p className="text-2xl font-bold tracking-tight">{value}</p>
        </CardContent>
    </Card>
);

const LastPurchaseDialog = ({ item, open, onOpenChange, transactions, parties }: { item: InventoryItem | null, open: boolean, onOpenChange: (open: boolean) => void, transactions: Transaction[], parties: Party[] }) => {
    const lastPurchase = useMemo(() => {
        if (!item) return null;
        return transactions
            .filter(t => (t.type === 'purchase' || t.type === 'credit_purchase') && t.enabled && t.items?.some(i => i.id === item.id))
            .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];
    }, [item, transactions]);

    const supplierName = useMemo(() => {
        if (!lastPurchase?.partyId) return 'Unknown Supplier';
        return parties.find(p => p.id === lastPurchase.partyId)?.name || 'Unknown Supplier';
    }, [lastPurchase, parties]);

    if (!item) return null;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Last Purchase: {item.name}</DialogTitle>
                </DialogHeader>
                <div className="py-4 space-y-4">
                    {lastPurchase ? (
                        <div className="grid grid-cols-2 gap-4 text-sm">
                            <div className="space-y-1">
                                <Label className="text-muted-foreground">Date</Label>
                                <p className="font-bold">{formatDate(lastPurchase.date)}</p>
                            </div>
                            <div className="space-y-1">
                                <Label className="text-muted-foreground">Supplier</Label>
                                <p className="font-bold">{supplierName}</p>
                            </div>
                            <div className="space-y-1">
                                <Label className="text-muted-foreground">Cost Price</Label>
                                <p className="font-bold text-red-600">{formatAmount(lastPurchase.items?.find(i => i.id === item.id)?.price || 0)}</p>
                            </div>
                            <div className="space-y-1">
                                <Label className="text-muted-foreground">Quantity</Label>
                                <p className="font-bold">{lastPurchase.items?.find(i => i.id === item.id)?.quantity || 0}</p>
                            </div>
                            <div className="col-span-2 space-y-1 pt-2 border-t">
                                <Label className="text-muted-foreground">Transaction Details</Label>
                                <p className="italic">{lastPurchase.description}</p>
                            </div>
                        </div>
                    ) : (
                        <div className="text-center py-6 text-muted-foreground">
                            <History className="h-10 w-10 mx-auto mb-2 opacity-20" />
                            <p>No purchase records found for this item.</p>
                        </div>
                    )}
                </div>
                <DialogFooter>
                    <DialogClose asChild><Button>Close</Button></DialogClose>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

export const StockAdjustmentDialog = ({ item, open, onOpenChange, appSettings }: { item: InventoryItem | null; open: boolean; onOpenChange: (open: boolean) => void; appSettings: AppSettings | null; }) => {
    const [adjustmentType, setAdjustmentType] = useState<'addition' | 'subtraction' | 'transfer'>('addition');
    const [quantity, setQuantity] = useState(0);
    const [notes, setNotes] = useState('');
    const [fromLocation, setFromLocation] = useState('');
    const [toLocation, setToLocation] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const { toast } = useToast();

    useEffect(() => {
        if (open) {
            setQuantity(0);
            setNotes('');
            setAdjustmentType('addition');
            setFromLocation(item?.location || 'default');
            setToLocation('');
        }
    }, [open, item]);

    const handleSave = async () => {
        if (!item || quantity <= 0) return;
        setIsSaving(true);
        try {
            if (adjustmentType === 'transfer') {
                if (!toLocation || fromLocation === toLocation) {
                    toast({ variant: 'destructive', title: 'Invalid locations for transfer' });
                    setIsSaving(false);
                    return;
                }
                await recordInventoryMovement(item.id, 'transfer', -quantity, `Transfer to ${toLocation}. ${notes}`, undefined, fromLocation);
                await recordInventoryMovement(item.id, 'transfer', quantity, `Transfer from ${fromLocation}. ${notes}`, undefined, toLocation);
            } else {
                const actualQty = adjustmentType === 'addition' ? quantity : -quantity;
                await recordInventoryMovement(item.id, 'adjustment', actualQty, notes, undefined, fromLocation);
            }
            toast({ title: 'Stock Adjusted Successfully' });
            onOpenChange(false);
        } catch (error: any) {
            toast({ variant: 'destructive', title: 'Error', description: error.message });
        } finally {
            setIsSaving(false);
        }
    };

    if (!item) return null;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Stock Adjustment: {item.name}</DialogTitle>
                    <DialogDescription>Manually add, remove, or transfer stock for this item.</DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                    <div className="space-y-1">
                        <Label>Adjustment Type</Label>
                        <Select value={adjustmentType} onValueChange={(v: any) => setAdjustmentType(v)}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="addition">Stock Addition (+)</SelectItem>
                                <SelectItem value="subtraction">Stock Subtraction (-)</SelectItem>
                                <SelectItem value="transfer">Warehouse Transfer</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                            <Label>{adjustmentType === 'transfer' ? 'Transfer Quantity' : 'Quantity'}</Label>
                            <Input type="number" value={quantity} onChange={e => setQuantity(parseFloat(e.target.value) || 0)} />
                        </div>
                        <div className="space-y-1">
                            <Label>{adjustmentType === 'transfer' ? 'From Location' : 'Location'}</Label>
                            <Select value={fromLocation} onValueChange={setFromLocation}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="default">Default</SelectItem>
                                    {appSettings?.inventoryLocations?.map(loc => (
                                        <SelectItem key={loc} value={loc}>{loc}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    {adjustmentType === 'transfer' && (
                        <div className="space-y-1">
                            <Label>To Location</Label>
                            <Select value={toLocation} onValueChange={setToLocation}>
                                <SelectTrigger><SelectValue placeholder="Select target location..." /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="default">Default</SelectItem>
                                    {appSettings?.inventoryLocations?.map(loc => (
                                        <SelectItem key={loc} value={loc}>{loc}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    )}

                    <div className="space-y-1">
                        <Label>Notes / Reason</Label>
                        <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g., Damaged item, physical audit correction..." />
                    </div>
                </div>
                <DialogFooter>
                    <DialogClose asChild><Button variant="ghost">Cancel</Button></DialogClose>
                    <Button onClick={handleSave} disabled={isSaving || quantity <= 0}>
                        {isSaving ? <Loader2 className="animate-spin mr-2 h-4 w-4" /> : <Save className="mr-2 h-4 w-4" />}
                        Apply Adjustment
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

export const ItemFormDialog = ({ open, onOpenChange, onSave, item, categories, parties, appSettings }: { open: boolean; onOpenChange: (open: boolean) => void; onSave: (data: ItemFormValues, imageFile: File | null) => void; item: InventoryItem | null; categories: InventoryCategory[]; parties: Party[]; appSettings: AppSettings | null; }) => {
  const form = useForm<ItemFormValues>({
    resolver: zodResolver(itemSchema),
  });

  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (item) {
      form.reset({
        name: item.name,
        description: item.description || '',
        category: item.category,
        brand: item.brand || '',
        minStockLevel: item.minStockLevel,
        sku: item.sku,
        via: item.via || '',
        location: item.location || '',
        barcode: item.barcode || '',
        supplier: item.supplier || '',
        imageUrl: item.imageUrl || '',
        price: item.price,
        wholesalePrice: item.wholesalePrice || 0,
        cost: item.cost || 0,
      });
      setImagePreview(item.imageUrl || null);
    } else {
      form.reset({
        name: '', description: '', category: categories[0]?.name || '', brand: '', minStockLevel: 0,
        sku: `SKU-${Date.now()}`, via: appSettings?.businessProfiles?.[0]?.name || '',
        location: appSettings?.inventoryLocations?.[0] || 'default', barcode: '', supplier: '',
        imageUrl: '', price: 0, wholesalePrice: 0, cost: 0,
      });
      setImagePreview(null);
    }
    setImageFile(null);
  }, [item, open, form, categories, appSettings]);

  const handleImageFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setImageFile(file);
      setImagePreview(URL.createObjectURL(file));
    }
  };

  const handleCaptureImage = (file: File) => {
      setImageFile(file);
      setImagePreview(URL.createObjectURL(file));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
       <CameraCaptureDialog open={isCameraOpen} onOpenChange={setIsCameraOpen} onCapture={handleCaptureImage} />
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{item ? 'Edit Product' : 'Add New Product'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(data => onSave(data, imageFile))} className="space-y-4 py-4">
          <div className="flex flex-col items-center gap-4">
            <Avatar className="h-24 w-24 rounded-md">
              <AvatarImage src={imagePreview || undefined} alt="Product image" className="object-cover" />
              <AvatarFallback className="rounded-md"><ImageIcon className="h-10 w-10 text-muted-foreground" /></AvatarFallback>
            </Avatar>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()}><Upload className="mr-2 h-4 w-4" /> Upload</Button>
              <Button type="button" variant="outline" onClick={() => setIsCameraOpen(true)}><Camera className="mr-2 h-4 w-4" /> Take Photo</Button>
            </div>
            <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleImageFileChange} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1"><Label>Product Name *</Label><Input {...form.register('name')} /></div>
            <div className="space-y-1"><Label>SKU / Stock Code *</Label><Input {...form.register('sku')} /></div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1"><Label>Category *</Label>
              <Controller name="category" control={form.control} render={({ field }) => (
                <Select onValueChange={field.onChange} value={field.value}>
                  <SelectTrigger><SelectValue placeholder="Select category..." /></SelectTrigger>
                  <SelectContent>{categories.map(c => <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>)}</SelectContent>
                </Select>
              )} />
            </div>
            <div className="space-y-1"><Label>Brand / Manufacturer</Label><Input {...form.register('brand')} /></div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-1"><Label>Cost Price *</Label><Input type="number" step="0.01" {...form.register('cost')} placeholder="0.00" /></div>
            <div className="space-y-1"><Label>Sale Price *</Label><Input type="number" step="0.01" {...form.register('price')} placeholder="0.00" /></div>
            <div className="space-y-1"><Label>Wholesale Price</Label><Input type="number" step="0.01" {...form.register('wholesalePrice')} placeholder="0.00" /></div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-1"><Label>Min. Stock Alert</Label><Input type="number" {...form.register('minStockLevel')} /></div>
            <div className="space-y-1"><Label>Warehouse Location</Label>
               <Controller name="location" control={form.control} render={({ field }) => (
                <Select onValueChange={field.onChange} value={field.value}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                      <SelectItem value="default">Default</SelectItem>
                      {appSettings?.inventoryLocations?.map(loc => <SelectItem key={loc} value={loc}>{loc}</SelectItem>)}
                  </SelectContent>
                </Select>
              )} />
            </div>
             <div className="space-y-1"><Label>Profile (Via)</Label>
               <Controller name="via" control={form.control} render={({ field }) => (
                <Select onValueChange={field.onChange} value={field.value}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{appSettings?.businessProfiles.map(p => <SelectItem key={p.name} value={p.name}>{p.name}</SelectItem>)}</SelectContent>
                </Select>
              )} />
            </div>
          </div>

          <div className="space-y-1"><Label>Description</Label><Textarea {...form.register('description')} /></div>

          <DialogFooter>
            <DialogClose asChild><Button type="button" variant="ghost">Cancel</Button></DialogClose>
            <Button type="submit">Save Product</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default function InventoryManager() {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [categories, setCategories] = useState<InventoryCategory[]>([]);
  const [parties, setParties] = useState<Party[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [isItemDialogOpen, setIsItemDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [adjustingItem, setAdjustingItem] = useState<InventoryItem | null>(null);
  const [viewingLastPurchaseItem, setViewingLastPurchaseItem] = useState<InventoryItem | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [isRecalculating, setIsRecalculating] = useState(false);
  
  const { toast } = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();
  const editId = searchParams.get('edit');

  useEffect(() => {
    setLoading(true);
    const unsubItems = subscribeToInventoryItems(setItems, (err) => toast({ variant: 'destructive', title: 'Error', description: err.message }));
    const unsubCats = subscribeToInventoryCategories(setCategories, console.error);
    const unsubParties = subscribeToParties(setParties, console.error);
    const unsubTransactions = subscribeToAllTransactions(setTransactions, console.error);
    getAppSettings().then(setAppSettings);
    setLoading(false);
    return () => { unsubItems(); unsubCats(); unsubParties(); unsubTransactions(); };
  }, [toast]);
  
  useEffect(() => {
    if (editId && items.length > 0) {
      const itemToEdit = items.find(i => i.id === editId);
      if (itemToEdit) {
        setEditingItem(itemToEdit);
        setIsItemDialogOpen(true);
      }
    }
  }, [editId, items]);

  const handleDownloadImage = async (url: string, name: string) => {
    try {
        const response = await fetch(url);
        const blob = await response.blob();
        const blobUrl = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = blobUrl;
        link.download = `${name.replace(/\s+/g, '_')}_image.jpg`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(blobUrl);
        toast({ title: 'Download Started' });
    } catch (error) {
        console.error("Download failed", error);
        toast({ variant: 'destructive', title: 'Download Failed' });
    }
  };

  const handleSaveItem = async (data: ItemFormValues, item: InventoryItem | null, imageFile: File | null) => {
    try {
        let imageUrl = item?.imageUrl || '';
        if (imageFile) {
            imageUrl = await uploadImage(imageFile, 'inventory-images');
        }
        
        if (item) {
            await updateInventoryItem(item.id, { ...data, imageUrl });
            toast({ title: 'Success', description: 'Product updated successfully.' });
        } else {
            await addInventoryItem({ ...data, imageUrl, quantity: 0, stock: {} });
            toast({ title: 'Success', description: 'New product added to inventory.' });
        }
        setIsItemDialogOpen(false);
    } catch (error: any) {
        toast({ variant: 'destructive', title: 'Error', description: error.message });
    }
  };

  const handleRecalculateAll = async () => {
      setIsRecalculating(true);
      toast({ title: 'Syncing Stock...', description: 'Recalculating stock levels from all transactions.' });
      try {
          const result = await recalculateAllStocks();
          toast({ title: 'Stock Synced', description: `Successfully updated ${result.updatedItems} items.` });
      } catch (error: any) {
          toast({ variant: 'destructive', title: 'Recalculation Failed', description: error.message });
      } finally {
          setIsRecalculating(false);
      }
  };

  const filteredItems = useMemo(() => {
    return items.filter(item => {
        const nameMatch = item.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                         (item.sku && item.sku.toLowerCase().includes(searchTerm.toLowerCase())) ||
                         (item.brand && item.brand.toLowerCase().includes(searchTerm.toLowerCase()));
        const categoryMatch = selectedCategory === 'all' || item.category === selectedCategory;
        return nameMatch && categoryMatch;
    });
  }, [items, searchTerm, selectedCategory]);

  const stats = useMemo(() => {
    const totalItems = items.length;
    const stockValueCost = items.reduce((sum, item) => sum + (item.quantity * item.cost), 0);
    const stockValueSale = items.reduce((sum, item) => sum + (item.quantity * item.price), 0);
    const lowStockCount = items.filter(i => i.quantity <= i.minStockLevel).length;
    return { totalItems, stockValueCost, stockValueSale, lowStockCount };
  }, [items]);

  return (
    <div className="space-y-6 bg-slate-100/50 -m-4 md:-m-6 lg:-m-8 p-4 md:p-6 lg:p-8 min-h-screen">
      <ItemFormDialog 
        open={isItemDialogOpen} 
        onOpenChange={setIsItemDialogOpen} 
        onSave={(data, img) => handleSaveItem(data, editingItem, img)} 
        item={editingItem} 
        categories={categories} 
        parties={parties} 
        appSettings={appSettings} 
      />
      
      <StockAdjustmentDialog 
        item={adjustingItem} 
        open={!!adjustingItem} 
        onOpenChange={() => setAdjustingItem(null)} 
        appSettings={appSettings} 
      />

      <LastPurchaseDialog
        item={viewingLastPurchaseItem}
        open={!!viewingLastPurchaseItem}
        onOpenChange={() => setViewingLastPurchaseItem(null)}
        transactions={transactions}
        parties={parties}
      />

      {/* Top Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <SummaryCard title="Total Items" value={stats.totalItems} icon={Boxes} colorClass="text-blue-600" />
        <SummaryCard title="Stock Value (Cost)" value={formatAmount(stats.stockValueCost)} icon={Archive} colorClass="text-orange-600" />
        <SummaryCard title="Stock Value (Sale)" value={formatAmount(stats.stockValueSale)} icon={DollarSign} colorClass="text-green-600" />
        <SummaryCard title="Low Stock" value={stats.lowStockCount} icon={AlertTriangle} colorClass="text-red-600" />
      </div>

      {/* Filter and Action Bar */}
      <Card className="shadow-sm border-0 sticky top-16 z-20 bg-white/95 backdrop-blur-sm">
        <CardContent className="p-3 flex flex-wrap items-center gap-3">
            <div className="relative flex-grow min-w-[200px]">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input 
                    placeholder="Search by name, SKU, or brand..." 
                    value={searchTerm} 
                    onChange={e => setSearchTerm(e.target.value)} 
                    className="pl-9 bg-gray-50 border-gray-200"
                />
            </div>
            
            <Select value={selectedCategory} onValueChange={setSelectedCategory}>
                <SelectTrigger className="w-[180px] bg-gray-50 border-gray-200">
                    <SelectValue placeholder="All Categories" />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="all">All Categories</SelectItem>
                    {categories.map(c => <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>)}
                </SelectContent>
            </Select>

            <Button variant="outline" className="gap-2 border-gray-200" onClick={() => router.push('/settings')}>
                <SlidersHorizontal className="h-4 w-4" /> Manage
            </Button>

            <div className="flex items-center gap-1 border rounded-lg p-1 bg-gray-50">
                <Button variant={viewMode === 'grid' ? 'secondary' : 'ghost'} size="icon" className="h-8 w-8" onClick={() => setViewMode('grid')}><Grid className="h-4 w-4" /></Button>
                <Button variant={viewMode === 'list' ? 'secondary' : 'ghost'} size="icon" className="h-8 w-8" onClick={() => setViewMode('list')}><List className="h-4 w-4" /></Button>
            </div>

            <Button onClick={handleRecalculateAll} className="bg-red-500 hover:bg-red-600 text-white gap-2 shadow-sm" disabled={isRecalculating}>
                {isRecalculating ? <Loader2 className="animate-spin h-4 w-4" /> : <RefreshCcw className="h-4 w-4" />}
                <span className="hidden sm:inline">Recalculate All</span>
            </Button>

            <Button onClick={() => { setEditingItem(null); setIsItemDialogOpen(true); }} className="bg-slate-700 hover:bg-slate-800 text-white gap-2 shadow-sm">
                <Plus className="h-4 w-4" /> Add Item
            </Button>
        </CardContent>
      </Card>

      {/* Main Content Area */}
      {loading ? (
          <div className="flex justify-center items-center h-64"><Loader2 className="animate-spin h-12 w-12 text-primary" /></div>
      ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {filteredItems.map(item => {
                  const businessProfile = appSettings?.businessProfiles.find(p => p.name === item.via);
                  const isLowStock = item.quantity <= item.minStockLevel;
                  
                  return (
                    <Card key={item.id} className="overflow-hidden border-0 shadow-sm hover:shadow-lg transition-all duration-300 flex flex-col group relative bg-white">
                        {/* Header with Title Overlay */}
                        <div className="absolute top-0 left-0 right-0 z-10 p-2 bg-gradient-to-b from-black/50 to-transparent text-white drop-shadow-sm font-bold text-xs truncate">
                            {item.name}
                        </div>

                        {/* Actions Overlay */}
                        <div className="absolute top-8 right-2 z-20 opacity-0 group-hover:opacity-100 transition-opacity">
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button variant="secondary" size="icon" className="h-8 w-8 rounded-full shadow-lg bg-white/90 backdrop-blur-sm"><MoreVertical className="h-4 w-4" /></Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                    <DropdownMenuItem onClick={() => router.push(`/reports/stock-in-out?productName=${encodeURIComponent(item.name)}`)}>
                                        <FileText className="mr-2 h-4 w-4" /> View Report
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => setViewingLastPurchaseItem(item)}>
                                        <History className="mr-2 h-4 w-4" /> Last Purchase
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => setAdjustingItem(item)}>
                                        <SlidersHorizontal className="mr-2 h-4 w-4" /> Adjust Stock
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => recalculateStockForItem(item.id)}>
                                        <RefreshCcw className="mr-2 h-4 w-4" /> Recalculate Stock
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => item.imageUrl && handleDownloadImage(item.imageUrl, item.name)} disabled={!item.imageUrl}>
                                        <Download className="mr-2 h-4 w-4" /> Download Image
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem onClick={() => { setEditingItem(item); setIsItemDialogOpen(true); }}>
                                        <Edit className="mr-2 h-4 w-4" /> Edit Item
                                    </DropdownMenuItem>
                                    <AlertDialog>
                                        <AlertDialogTrigger asChild>
                                            <DropdownMenuItem onSelect={e => e.preventDefault()} className="text-destructive">
                                                <Trash2 className="mr-2 h-4 w-4" /> Delete Item
                                            </DropdownMenuItem>
                                        </AlertDialogTrigger>
                                        <AlertDialogContent>
                                            <AlertDialogHeader><AlertDialogTitle>Delete {item.name}?</AlertDialogTitle><AlertDialogDescriptionComponent>This will remove the product and all associated history.</AlertDialogDescriptionComponent></AlertDialogHeader>
                                            <AlertDialogFooter>
                                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                <AlertDialogAction onClick={() => deleteInventoryItem(item.id)} className={cn(buttonVariants({ variant: 'destructive' }))}>Delete</AlertDialogAction>
                                            </AlertDialogFooter>
                                        </AlertDialogContent>
                                    </AlertDialog>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </div>

                        {/* Image Container */}
                        <div className="relative aspect-square w-full bg-muted flex items-center justify-center overflow-hidden">
                            {item.imageUrl ? (
                                <Image src={item.imageUrl} alt={item.name} fill className="object-cover group-hover:scale-105 transition-transform duration-500" />
                            ) : (
                                <div className="text-muted-foreground/20 font-bold text-xl select-none">400 × 400</div>
                            )}
                            
                            {/* Profile Logo Overlay */}
                            {businessProfile?.logoUrl && (
                                <div className="absolute bottom-2 right-2 w-10 h-10 rounded-full border bg-white/80 backdrop-blur-sm p-1 shadow-sm">
                                    <Image src={businessProfile.logoUrl} alt="Via" fill className="object-contain p-1" />
                                </div>
                            )}
                        </div>

                        {/* Footer Info */}
                        <CardContent className="p-3 space-y-3 mt-auto">
                            <Badge variant="outline" className="text-[10px] h-6 px-3 bg-gray-50 border-gray-100">{item.category}</Badge>
                            
                            <div className="flex justify-between items-center">
                                <p className="font-black text-sm">৳{item.price.toLocaleString()}</p>
                                <Badge className={cn(
                                    "text-[10px] px-2 py-0.5 border-0 font-bold",
                                    isLowStock ? "bg-yellow-400 text-yellow-900" : "bg-green-50 text-white"
                                )}>
                                    Stock: {item.quantity}
                                </Badge>
                            </div>
                        </CardContent>
                    </Card>
                  );
              })}
          </div>
      ) : (
          /* List View (Table) */
          <Card className="border-0 shadow-sm overflow-hidden bg-white">
              <CardContent className="p-0">
                  <div className="rounded-md border-x overflow-x-auto">
                      <Table>
                          <TableHeader className="bg-muted/50">
                              <TableRow>
                                  <TableHead className="w-[60px]"></TableHead>
                                  <TableHead>Product Name</TableHead>
                                  <TableHead>SKU</TableHead>
                                  <TableHead>Category</TableHead>
                                  <TableHead className="text-right">Price</TableHead>
                                  <TableHead className="text-center">Stock</TableHead>
                                  <TableHead className="w-[50px]"></TableHead>
                              </TableRow>
                          </TableHeader>
                          <TableBody>
                              {filteredItems.length > 0 ? filteredItems.map(item => (
                                  <TableRow key={item.id} className="hover:bg-muted/30">
                                      <TableCell>
                                          <div className="relative h-10 w-10 rounded-md overflow-hidden bg-muted">
                                              {item.imageUrl ? <Image src={item.imageUrl} alt="" fill className="object-cover" /> : <Package className="p-2 text-muted-foreground/30" />}
                                          </div>
                                      </TableCell>
                                      <TableCell>
                                          <p className="font-bold text-sm">{item.name}</p>
                                          <p className="text-[10px] text-muted-foreground">{item.brand}</p>
                                      </TableCell>
                                      <TableCell><span className="text-xs font-mono">{item.sku}</span></TableCell>
                                      <TableCell><Badge variant="secondary" className="text-[10px]">{item.category}</Badge></TableCell>
                                      <TableCell className="text-right font-bold">{formatAmount(item.price)}</TableCell>
                                      <TableCell className="text-center">
                                          <Badge className={cn(item.quantity <= item.minStockLevel ? "bg-red-500" : "bg-green-500")}>
                                              {item.quantity}
                                          </Badge>
                                      </TableCell>
                                      <TableCell>
                                          <DropdownMenu>
                                              <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8"><MoreVertical className="h-4 w-4" /></Button></DropdownMenuTrigger>
                                              <DropdownMenuContent align="end">
                                                  <DropdownMenuItem onClick={() => router.push(`/reports/stock-in-out?productName=${encodeURIComponent(item.name)}`)}>
                                                      <FileText className="mr-2 h-4 w-4" /> View Report
                                                  </DropdownMenuItem>
                                                  <DropdownMenuItem onClick={() => setViewingLastPurchaseItem(item)}>
                                                      <History className="mr-2 h-4 w-4" /> Last Purchase
                                                  </DropdownMenuItem>
                                                  <DropdownMenuItem onClick={() => setAdjustingItem(item)}>
                                                      <SlidersHorizontal className="mr-2 h-4 w-4" /> Adjust Stock
                                                  </DropdownMenuItem>
                                                  <DropdownMenuItem onClick={() => recalculateStockForItem(item.id)}>
                                                      <RefreshCcw className="mr-2 h-4 w-4" /> Recalculate Stock
                                                  </DropdownMenuItem>
                                                  <DropdownMenuItem onClick={() => item.imageUrl && handleDownloadImage(item.imageUrl, item.name)} disabled={!item.imageUrl}>
                                                      <Download className="mr-2 h-4 w-4" /> Download Image
                                                  </DropdownMenuItem>
                                                  <DropdownMenuSeparator />
                                                  <DropdownMenuItem onClick={() => { setEditingItem(item); setIsItemDialogOpen(true); }}>
                                                      <Edit className="mr-2 h-4 w-4" /> Edit Item
                                                  </DropdownMenuItem>
                                                  <DropdownMenuItem onClick={() => deleteInventoryItem(item.id)} className="text-destructive">
                                                      <Trash2 className="mr-2 h-4 w-4" /> Delete Item
                                                  </DropdownMenuItem>
                                              </DropdownMenuContent>
                                          </DropdownMenu>
                                      </TableCell>
                                  </TableRow>
                              )) : (
                                  <TableRow><TableCell colSpan={7} className="h-32 text-center text-muted-foreground">No products match your search.</TableCell></TableRow>
                              )}
                          </TableBody>
                      </Table>
                  </div>
              </CardContent>
          </Card>
      )}
    </div>
  );
}
