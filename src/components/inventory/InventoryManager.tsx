'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import type { InventoryItem, InventoryCategory, Party, AppSettings } from '@/types';
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
import { uploadImage } from '@/services/storageService';
import { useToast } from '@/hooks/use-toast';
import { useRouter, useSearchParams } from 'next/navigation';

import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
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

import { Archive, Plus, Edit, Trash2, MoreVertical, Search, Package, ImageIcon, Camera, Upload, ChevronsUpDown, Check, RefreshCcw, AlertTriangle, SlidersHorizontal, Loader2, X } from 'lucide-react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { cn } from '@/lib/utils';
import { formatAmount } from '@/lib/utils';
import { getAppSettings } from '@/services/settingsService';
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
});
type ItemFormValues = z.infer<typeof itemSchema>;

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
      });
      setImagePreview(item.imageUrl || null);
    } else {
      form.reset({
        name: '', description: '', category: categories[0]?.name || '', brand: '', minStockLevel: 0,
        sku: `SKU-${Date.now()}`, via: appSettings?.businessProfiles?.[0]?.name || '',
        location: appSettings?.inventoryLocations?.[0] || 'default', barcode: '', supplier: '',
        imageUrl: '', price: 0, wholesalePrice: 0,
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
            <div className="space-y-1"><Label>Cost Price</Label><Input type="number" step="0.01" {...form.register('cost' as any)} placeholder="0.00" disabled={!!item} /></div>
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
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [isItemDialogOpen, setIsItemDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [adjustingItem, setAdjustingItem] = useState<InventoryItem | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [isRecalculating, setIsRecalculating] = useState(false);
  
  const { toast } = useToast();
  const searchParams = useSearchParams();
  const editId = searchParams.get('edit');

  useEffect(() => {
    setLoading(true);
    const unsubItems = subscribeToInventoryItems(setItems, (err) => toast({ variant: 'destructive', title: 'Error', description: err.message }));
    const unsubCats = subscribeToInventoryCategories(setCategories, console.error);
    const unsubParties = subscribeToParties(setParties, console.error);
    getAppSettings().then(setAppSettings);
    setLoading(false);
    return () => { unsubItems(); unsubCats(); unsubParties(); };
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
                         (item.sku && item.sku.toLowerCase().includes(searchTerm.toLowerCase()));
        const categoryMatch = selectedCategory === 'all' || item.category === selectedCategory;
        return nameMatch && categoryMatch;
    });
  }, [items, searchTerm, selectedCategory]);

  return (
    <div className="space-y-6">
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

      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2"><Archive /> Inventory Management</h1>
          <p className="text-muted-foreground mt-1">Add products, track stock levels, and manage categories.</p>
        </div>
        <div className="flex gap-2">
            <Button onClick={handleRecalculateAll} variant="outline" disabled={isRecalculating}>
                {isRecalculating ? <Loader2 className="animate-spin mr-2 h-4 w-4" /> : <RefreshCcw className="mr-2 h-4 w-4" />}
                Sync All Stock
            </Button>
            <Button onClick={() => { setEditingItem(null); setIsItemDialogOpen(true); }}>
                <Plus className="mr-2 h-4 w-4" /> Add Product
            </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="md:col-span-1 space-y-4">
            <Card>
                <CardHeader><CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Quick Filters</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-2">
                        <Label>Search</Label>
                        <div className="relative">
                            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input placeholder="Name or SKU..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="pl-8" />
                        </div>
                    </div>
                    <div className="space-y-2">
                        <Label>Category</Label>
                        <Select value={selectedCategory} onValueChange={setSelectedCategory}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Categories</SelectItem>
                                {categories.map(c => <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </div>
                </CardContent>
            </Card>
            
            <Card className="bg-primary/5">
                <CardHeader className="p-4"><CardTitle className="text-sm">Stock Summary</CardTitle></CardHeader>
                <CardContent className="p-4 pt-0 space-y-2">
                    <div className="flex justify-between text-sm"><span>Total Items:</span> <span className="font-bold">{items.length}</span></div>
                    <div className="flex justify-between text-sm"><span>Low Stock:</span> <span className="font-bold text-red-600">{items.filter(i => i.quantity <= i.minStockLevel).length}</span></div>
                </CardContent>
            </Card>
        </div>

        <div className="md:col-span-3">
             <Card>
                <CardContent className="p-0">
                    <div className="rounded-md border overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="w-[80px]">Image</TableHead>
                                    <TableHead>Product Details</TableHead>
                                    <TableHead>Category</TableHead>
                                    <TableHead className="text-right">Price</TableHead>
                                    <TableHead className="text-center">Stock</TableHead>
                                    <TableHead className="w-[50px]"></TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {loading ? (
                                    <TableRow><TableCell colSpan={6} className="h-48 text-center"><Loader2 className="animate-spin h-8 w-8 mx-auto text-primary" /></TableCell></TableRow>
                                ) : filteredItems.length > 0 ? filteredItems.map(item => (
                                    <TableRow key={item.id}>
                                        <TableCell>
                                            <Avatar className="h-12 w-12 rounded-md">
                                                <AvatarImage src={item.imageUrl} className="object-cover" />
                                                <AvatarFallback className="rounded-md"><Package /></AvatarFallback>
                                            </Avatar>
                                        </TableCell>
                                        <TableCell>
                                            <p className="font-bold text-sm">{item.name}</p>
                                            <div className="flex gap-2 items-center mt-1">
                                                <Badge variant="outline" className="text-[10px] font-mono">{item.sku}</Badge>
                                                {item.brand && <span className="text-[10px] text-muted-foreground">{item.brand}</span>}
                                            </div>
                                        </TableCell>
                                        <TableCell><Badge variant="secondary">{item.category}</Badge></TableCell>
                                        <TableCell className="text-right">
                                            <div className="text-sm font-bold">{formatAmount(item.price)}</div>
                                            {item.wholesalePrice > 0 && <div className="text-[10px] text-muted-foreground">WS: {formatAmount(item.wholesalePrice)}</div>}
                                        </TableCell>
                                        <TableCell className="text-center">
                                            <TooltipProvider>
                                                <Tooltip>
                                                    <TooltipTrigger asChild>
                                                        <div className="cursor-help">
                                                            <div className={cn("text-lg font-bold", item.quantity <= item.minStockLevel ? 'text-red-600' : 'text-primary')}>
                                                                {item.quantity}
                                                            </div>
                                                            {item.quantity <= item.minStockLevel && <AlertTriangle className="h-3 w-3 text-red-600 mx-auto" />}
                                                        </div>
                                                    </TooltipTrigger>
                                                    <TooltipContent className="p-0">
                                                        <div className="p-2 bg-popover text-popover-foreground text-xs space-y-1">
                                                            <p className="font-bold border-b pb-1 mb-1">Stock by Location</p>
                                                            {item.stock && Object.entries(item.stock).map(([loc, qty]) => (
                                                                <div key={loc} className="flex justify-between gap-4">
                                                                    <span>{loc}:</span> <span className="font-mono">{qty}</span>
                                                                </div>
                                                            ))}
                                                            {(!item.stock || Object.keys(item.stock).length === 0) && <p>No location data</p>}
                                                        </div>
                                                    </TooltipContent>
                                                </Tooltip>
                                            </TooltipProvider>
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild><Button variant="ghost" size="icon"><MoreVertical className="h-4 w-4" /></Button></DropdownMenuTrigger>
                                                <DropdownMenuContent align="end">
                                                    <DropdownMenuItem onClick={() => { setEditingItem(item); setIsItemDialogOpen(true); }}><Edit className="mr-2 h-4 w-4" /> Edit Product</DropdownMenuItem>
                                                    <DropdownMenuItem onClick={() => setAdjustingItem(item)}><SlidersHorizontal className="mr-2 h-4 w-4" /> Stock Adjustment</DropdownMenuItem>
                                                    <DropdownMenuItem onClick={() => recalculateStockForItem(item.id)}><RefreshCcw className="mr-2 h-4 w-4" /> Recalculate Stock</DropdownMenuItem>
                                                    <DropdownMenuSeparator />
                                                    <AlertDialog>
                                                        <AlertDialogTrigger asChild>
                                                            <DropdownMenuItem onSelect={e => e.preventDefault()} className="text-destructive"><Trash2 className="mr-2 h-4 w-4" /> Delete</DropdownMenuItem>
                                                        </AlertDialogTrigger>
                                                        <AlertDialogContent>
                                                            <AlertDialogHeader><AlertDialogTitle>Confirm Deletion</AlertDialogTitle><AlertDialogDescriptionComponent>Are you sure you want to delete {item.name}? This will remove all history for this product.</AlertDialogDescriptionComponent></AlertDialogHeader>
                                                            <AlertDialogFooter>
                                                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                                <AlertDialogAction onClick={() => deleteInventoryItem(item.id)} className={cn(buttonVariants({ variant: 'destructive' }))}>Delete</AlertDialogAction>
                                                            </AlertDialogFooter>
                                                        </AlertDialogContent>
                                                    </AlertDialog>
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                        </TableCell>
                                    </TableRow>
                                )) : (
                                    <TableRow><TableCell colSpan={6} className="h-32 text-center text-muted-foreground">No products found.</TableCell></TableRow>
                                )}
                            </TableBody>
                        </Table>
                    </div>
                </CardContent>
             </Card>
        </div>
      </div>
    </div>
  );
}