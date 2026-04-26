'use client';

import React, { useState, useEffect, useMemo, useRef, useCallback, Suspense } from 'react';
import type { InventoryItem, InventoryCategory, Party, AppSettings } from '@/types';
import { 
  subscribeToInventoryItems, 
  subscribeToInventoryCategories, 
  addInventoryItem, 
  updateInventoryItem, 
  deleteInventoryItem, 
  recordInventoryMovement, 
  addInventoryCategory, 
  deleteInventoryCategory,
  recalculateStockForItem, 
  recalculateAllStocks,
  importInventoryFromCSV 
} from '@/services/inventoryService';
import { subscribeToParties } from '@/services/partyService';
import { uploadImage } from '@/services/storageService';
import { useToast } from '@/hooks/use-toast';
import Papa from 'papaparse';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter, useSearchParams } from 'next/navigation';
import html2canvas from 'html2canvas';


import { Button } from '@/components/ui/button';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";


import { Archive, Plus, Edit, Trash2, MoreVertical, Search, Package, ImageIcon, Camera, Upload, Settings, ChevronsUpDown, Check, RefreshCcw, Boxes, AlertTriangle, ListFilter, Download, RefreshCw, Loader2, FileText, SlidersHorizontal, ArrowLeft, Grip, List, DatabaseZap, FilePlus, UserSearch, History } from 'lucide-react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { cn } from '@/lib/utils';
import { formatAmount } from '@/lib/utils';
import { getAppSettings } from '@/services/settingsService';
import { CameraCaptureDialog } from '../ui/camera-capture-dialog';
import { FormField, FormItem, FormLabel } from '../ui/form';
import { subscribeToAllTransactions } from '@/services/transactionService';


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
    const [fromLocation, setFromLocation] = useState<string | undefined>(undefined);
    const [toLocation, setToLocation] = useState<string | undefined>(undefined);
    const { toast } = useToast();

    useEffect(() => {
        if (open) {
            setAdjustmentType('addition');
            setQuantity(0);
            setNotes('');
            setFromLocation(appSettings?.inventoryLocations?.[0] || 'default');
            setToLocation(appSettings?.inventoryLocations?.[0] || 'default');
        }
    }, [open, appSettings]);
    
    if (!item) return null;

    const handleConfirmAdjustment = async () => {
        if (quantity <= 0) {
            toast({ variant: 'destructive', title: 'Invalid Quantity', description: 'Adjustment quantity must be greater than zero.'});
            return;
        }

        try {
            if (adjustmentType === 'transfer') {
                if (!fromLocation || !toLocation || fromLocation === toLocation) {
                    toast({ variant: 'destructive', title: 'Invalid Locations', description: 'Please select two different locations for a transfer.' });
                    return;
                }
                await recordInventoryMovement(item.id, 'transfer', -quantity, `Transfer to ${toLocation}. ${notes}`, `TRN-${Date.now()}`, fromLocation);
                await recordInventoryMovement(item.id, 'transfer', quantity, `Transfer from ${fromLocation}. ${notes}`, `TRN-${Date.now()}`, toLocation);
            } else {
                 const quantityChange = adjustmentType === 'addition' ? quantity : -quantity;
                 await recordInventoryMovement(item.id, 'adjustment', quantityChange, notes, `ADJ-${Date.now()}`, fromLocation);
            }

            toast({ title: 'Success', description: 'Stock has been adjusted.' });
            onOpenChange(false);
        } catch (error: any) {
             toast({ variant: 'destructive', title: 'Adjustment Failed', description: error.message });
        }
    }
    
    const renderLocationSelector = () => {
        const allLocations = ['default', ...(appSettings?.inventoryLocations || [])];
        if (adjustmentType === 'transfer') {
            return (
                <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <Label>From Location</Label>
                        <Select value={fromLocation} onValueChange={setFromLocation}>
                            <SelectTrigger><SelectValue placeholder="Select location..."/></SelectTrigger>
                            <SelectContent>
                                {allLocations.map(loc => (
                                    <SelectItem key={loc} value={loc}>{loc} - {item.stock?.[loc] || 0}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-2">
                        <Label>To Location</Label>
                        <Select value={toLocation} onValueChange={setToLocation}>
                            <SelectTrigger><SelectValue placeholder="Select location..."/></SelectTrigger>
                            <SelectContent>
                                 {allLocations.map(loc => (
                                    <SelectItem key={loc} value={loc}>{loc} - {item.stock?.[loc] || 0}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                </div>
            )
        }
        return (
            <div className="space-y-2">
                <Label>Location</Label>
                <Select value={fromLocation} onValueChange={setFromLocation}>
                    <SelectTrigger><SelectValue placeholder="Select location..."/></SelectTrigger>
                    <SelectContent>
                        {allLocations.map(loc => (
                            <SelectItem key={loc} value={loc}>{loc} - {item.stock?.[loc] || 0}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>
        )
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Adjust Stock for {item.name}</DialogTitle>
                    <DialogDescription>Current Total Stock: {item.quantity}</DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                    {renderLocationSelector()}
                    <div className="space-y-2">
                        <Label>Adjustment Type</Label>
                        <Select value={adjustmentType} onValueChange={(v) => setAdjustmentType(v as any)}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="addition">Add to Stock</SelectItem>
                                <SelectItem value="subtraction">Subtract from Stock</SelectItem>
                                <SelectItem value="transfer">Transfer Stock</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                     <div className="space-y-2">
                        <Label htmlFor="quantity">Quantity to {adjustmentType}</Label>
                        <Input id="quantity" type="number" value={quantity} onFocus={(e) => e.target.select()} onChange={e => setQuantity(parseInt(e.target.value) || 0)} min="0" />
                    </div>
                     <div className="space-y-2">
                        <Label htmlFor="notes">Reason / Notes</Label>
                        <Textarea id="notes" value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g., Stock count correction, damaged goods" />
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
                    <Button onClick={handleConfirmAdjustment}>Confirm Adjustment</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

const CategoryManagerDialog = ({ open, onOpenChange, categories }: { open: boolean; onOpenChange: (open: boolean) => void; categories: InventoryCategory[] }) => {
    const [newCategoryName, setNewCategoryName] = useState('');
    const { toast } = useToast();

    const handleAddCategory = async () => {
        if (!newCategoryName.trim()) {
            toast({ variant: 'destructive', title: 'Cannot add empty category.' });
            return;
        }
        try {
            await addInventoryCategory({ name: newCategoryName.trim() });
            toast({ title: 'Success', description: `Category "${newCategoryName}" added.` });
            setNewCategoryName('');
        } catch (error: any) {
            toast({ variant: 'destructive', title: 'Error', description: error.message });
        }
    };

    const handleDeleteCategory = async (id: string) => {
        try {
            await deleteInventoryCategory(id);
            toast({ title: 'Success', description: 'Category deleted.' });
        } catch (error: any) {
            toast({ variant: 'destructive', title: 'Error', description: error.message });
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader><DialogTitle>Manage Categories</DialogTitle></DialogHeader>
                <div className="space-y-4 py-4">
                    <div className="flex gap-2">
                        <Input value={newCategoryName} onChange={(e) => setNewCategoryName(e.target.value)} placeholder="New category name..." />
                        <Button onClick={handleAddCategory}><Plus className="h-4 w-4" /></Button>
                    </div>
                    <div className="max-h-64 overflow-y-auto space-y-2">
                        {categories.map(cat => (
                            <div key={cat.id} className="flex justify-between items-center p-2 border rounded-md">
                                <span>{cat.name}</span>
                                <Button variant="ghost" size="icon" onClick={() => handleDeleteCategory(cat.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                            </div>
                        ))}
                    </div>
                </div>
                <DialogFooter>
                    <DialogClose asChild><Button>Close</Button></DialogClose>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

export const ItemFormDialog = ({
    open,
    onOpenChange,
    onSave,
    item,
    categories,
    parties,
    allItems,
    appSettings,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSave: (data: ItemFormValues, item: InventoryItem | null, imageFile: File | null) => void;
    item: InventoryItem | null;
    categories: InventoryCategory[];
    parties: Party[];
    allItems?: InventoryItem[];
    appSettings: AppSettings | null;
}) => {
    const form = useForm<ItemFormValues>({
        resolver: zodResolver(itemSchema),
    });
    
    const { register, handleSubmit, control, reset, setValue, watch, formState: { errors } } = form;
    
    const [imageFile, setImageFile] = useState<File | null>(null);
    const [imagePreview, setImagePreview] = useState<string | null>(null);
    const [isCameraOpen, setIsCameraOpen] = useState(false);
    const [nameSuggestions, setNameSuggestions] = useState<InventoryItem[]>([]);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const prevItemIdRef = useRef<string | undefined>(undefined);
    
    const watchedName = watch('name');

    useEffect(() => {
        if (watchedName && watchedName.length > 2 && allItems) {
            const suggestions = allItems.filter(i =>
                i.id !== item?.id && i.name.toLowerCase().includes(watchedName.toLowerCase())
            );
            setNameSuggestions(suggestions);
        } else {
            setNameSuggestions([]);
        }
    }, [watchedName, allItems, item]);


    useEffect(() => {
        if (open) {
            const defaultValues = {
                name: '', 
                description: '', 
                category: categories[0]?.name || '', 
                brand: '',
                minStockLevel: 0, 
                sku: '',
                via: appSettings?.businessProfiles?.[0]?.name || 'Personal',
                location: appSettings?.inventoryLocations?.[0] || 'default', 
                barcode: '', 
                supplier: '', 
                imageUrl: '', 
                price: 0, 
                wholesalePrice: 0
            };
    
            const isSameItem = item && prevItemIdRef.current === item.id;

            if (item) {
                reset({ 
                    ...defaultValues,
                    ...item,
                    imageUrl: item.imageUrl || '',
                    price: item.price || 0,
                    wholesalePrice: item.wholesalePrice || 0,
                    location: item.location || defaultValues.location
                });

                if (!isSameItem) {
                     setImagePreview(item.imageUrl || null);
                     setImageFile(null);
                }
            } else {
                if (prevItemIdRef.current !== undefined) {
                    reset(defaultValues);
                    setImagePreview(null);
                    setImageFile(null);
                } else if (!imageFile) { 
                    reset(defaultValues);
                }
            }
            
            prevItemIdRef.current = item?.id;
        }
    }, [open, item, reset, categories, appSettings, imageFile]);


    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            setImageFile(file);
            setImagePreview(URL.createObjectURL(file));
        }
    };

    const handleCapture = (file: File) => {
        setImageFile(file);
        const reader = new FileReader();
        reader.onloadend = () => {
            setImagePreview(reader.result as string);
        };
        reader.readAsDataURL(file);
    };
    
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <CameraCaptureDialog open={isCameraOpen} onOpenChange={setIsCameraOpen} onCapture={handleCapture} />
            <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{item ? 'Edit Item' : 'Add New Item'}</DialogTitle>
                    <DialogDescription>Add details about the item below.</DialogDescription>
                </DialogHeader>
                <form onSubmit={handleSubmit(data => onSave(data, item, imageFile))} className="space-y-4 py-4">
                    <Tabs defaultValue="details" className="w-full">
                        <TabsList className="grid w-full grid-cols-2">
                            <TabsTrigger value="details">Details</TabsTrigger>
                            <TabsTrigger value="prices">Specific Prices</TabsTrigger>
                        </TabsList>
                        <TabsContent value="details">
                            <div className="grid gap-4 py-4">
                            <div className="flex flex-col items-center gap-4">
                                <Avatar className="h-24 w-24 rounded-lg">
                                <AvatarImage src={imagePreview || undefined} alt="Item image" />
                                <AvatarFallback><ImageIcon className="h-10 w-10 text-muted-foreground" /></AvatarFallback>
                                </Avatar>
                                <div className="flex gap-2">
                                    <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()}><Upload className="mr-2 h-4 w-4" /> Upload</Button>
                                    <Button type="button" variant="outline" onClick={() => setIsCameraOpen(true)}>
                                    <Camera className="mr-2 h-4 w-4" /> Capture
                                    </Button>
                                </div>
                                <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleFileChange} />
                            </div>

                            <div className="space-y-2">
                                <Label>Item Name <span className="text-destructive">*</span></Label>
                                <Input {...register('name')} />
                                 {nameSuggestions.length > 0 && (
                                    <div className="p-2 border border-yellow-300 bg-yellow-50 rounded-md text-xs">
                                        <p className="font-semibold">Possible duplicate found:</p>
                                        <ul className="list-disc pl-5">
                                            {nameSuggestions.map(s => <li key={s.id}>{s.name} (SKU: {s.sku}, Category: {s.category})</li>)}
                                        </ul>
                                    </div>
                                )}
                                {errors.name && <p className="text-destructive text-xs mt-1">{errors.name.message}</p>}
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label>Category <span className="text-destructive">*</span></Label>
                                    <Controller name="category" control={control} render={({ field }) => (
                                        <Select onValueChange={field.onChange} value={field.value}>
                                            <SelectTrigger><SelectValue placeholder="Select category..." /></SelectTrigger>
                                            <SelectContent>
                                                {categories.map(c => <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>)}
                                            </SelectContent>
                                        </Select>
                                    )} />
                                    {errors.category && <p className="text-destructive text-xs mt-1">{errors.category.message}</p>}
                                </div>
                                <div className="space-y-2"><Label>Brand</Label><Input {...register('brand')} /></div>
                            </div>
                            
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label>Sale Price <span className="text-destructive">*</span></Label>
                                    <Input type="number" step="0.01" onFocus={(e) => e.target.select()} {...register('price')} />
                                     {errors.price && <p className="text-destructive text-xs mt-1">{errors.price.message}</p>}
                                </div>
                                <div className="space-y-2">
                                    <Label>Wholesale Price <span className="text-destructive">*</span></Label>
                                    <Input type="number" step="0.01" onFocus={(e) => e.target.select()} {...register('wholesalePrice')} />
                                     {errors.wholesalePrice && <p className="text-destructive text-xs mt-1">{errors.wholesalePrice.message}</p>}
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <div className="space-y-2">
                                    <Label>SKU / Item Code <span className="text-destructive">*</span></Label>
                                    <Input {...register('sku')} />
                                    {errors.sku && <p className="text-destructive text-xs mt-1">{errors.sku.message}</p>}
                                </div>
                                <div className="space-y-2">
                                  <Label>Business Profile</Label>
                                  <Controller
                                    name="via"
                                    control={control}
                                    render={({ field }) => (
                                      <Select onValueChange={field.onChange} value={field.value}>
                                        <SelectTrigger>
                                          <SelectValue placeholder="Select business..." />
                                        </SelectTrigger>
                                        <SelectContent>
                                          {(appSettings?.businessProfiles || []).map(profile => (
                                            <SelectItem key={profile.name} value={profile.name}>{profile.name}</SelectItem>
                                          ))}
                                        </SelectContent>
                                      </Select>
                                    )}
                                  />
                                </div>
                                 <div className="space-y-2">
                                    <Label>Location / Warehouse</Label>
                                    <Controller
                                        name="location"
                                        control={control}
                                        render={({ field }) => (
                                            <Select onValueChange={field.onChange} value={field.value || 'default'}>
                                                <SelectTrigger><SelectValue placeholder="Select location..." /></SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="default">Default</SelectItem>
                                                    {(appSettings?.inventoryLocations || []).map(loc => (
                                                        <SelectItem key={loc} value={loc}>{loc}</SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        )}
                                    />
                                </div>
                                <div className="space-y-2 md:col-span-2">
                                    <Label>Min. Stock Level</Label>
                                    <Input type="number" onFocus={(e) => e.target.select()} {...register('minStockLevel')} />
                                </div>
                            </div>
                            <div className="space-y-2"><Label>Description</Label><Textarea {...register('description')} /></div>
                            </div>
                        </TabsContent>
                        <TabsContent value="prices">
                             <div className="flex justify-center items-center h-40 text-muted-foreground">
                                Specific Prices feature coming soon...
                             </div>
                        </TabsContent>
                    </Tabs>
                    <DialogFooter>
                    <DialogClose asChild><Button type="button" variant="ghost">Cancel</Button></DialogClose>
                    <Button type="submit">Save</Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
};


export default function InventoryManager() {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [categories, setCategories] = useState<InventoryCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [isItemDialogOpen, setIsItemDialogOpen] = useState(false);
  const [isCategoryDialogOpen, setIsCategoryDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [adjustingItem, setAdjustingItem] = useState<InventoryItem | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterCategory, setFilterCategory] = useState("all");
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const { toast } = useToast();
  const [isRecalculating, setIsRecalculating] = useState(false);
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);
  const [allTransactions, setAllTransactions] = useState<Transaction[]>([]);

  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    setLoading(true);
    
    const editItemId = searchParams.get('edit');

    const unsubItems = subscribeToInventoryItems(
      (newItems) => {
        setItems(newItems);
        if (editItemId) {
          const itemToEdit = newItems.find(i => i.id === editItemId);
          if (itemToEdit) {
            setEditingItem(itemToEdit);
            setIsItemDialogOpen(true);
          }
        }
      },
      (err) => toast({ variant: 'destructive', title: 'Error', description: err.message })
    );

    const unsubCategories = subscribeToInventoryCategories(setCategories, (err) => toast({ variant: 'destructive', title: 'Error', description: err.message }));
    const unsubTransactions = subscribeToAllTransactions(setAllTransactions, (err) => toast({ variant: 'destructive', title: 'Error', description: 'Could not fetch transactions for context.' }));
    getAppSettings().then(setAppSettings);
    
    const timer = setTimeout(() => setLoading(false), 500);

    return () => {
      unsubItems();
      unsubCategories();
      unsubTransactions();
      clearTimeout(timer);
    };
  }, [toast, searchParams]);
  
  const { totalStockValueCost, totalStockValueSale, lowStockCount } = useMemo(() => {
    const costValue = items.reduce((sum, item) => sum + (item.cost * item.quantity), 0);
    const saleValue = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const lowCount = items.filter(item => item.quantity > 0 && item.quantity <= item.minStockLevel).length;
    return { totalStockValueCost: costValue, totalStockValueSale: saleValue, lowStockCount: lowCount };
  }, [items]);


  const handleRecalculateStock = async (itemId: string) => {
      toast({ title: 'Recalculating...', description: 'Please wait while we update the stock.' });
      try {
          await recalculateStockForItem(itemId);
          toast({ title: 'Success!', description: 'Stock has been recalculated and updated.' });
      } catch (error: any) {
          toast({ variant: 'destructive', title: 'Error', description: `Could not recalculate stock: ${error.message}` });
      }
  };
  
   const handleGlobalRecalculate = async () => {
      setIsRecalculating(true);
      toast({ title: 'Global Recalculation Started', description: 'Recalculating all stock balances. This may take some time...' });
      try {
        const result = await recalculateAllStocks();
        toast({ title: 'Recalculation Complete!', description: `${result.updatedItems} inventory items were updated.` });
      } catch (error: any) {
        toast({ variant: 'destructive', title: 'Recalculation Failed', description: error.message });
      } finally {
        setIsRecalculating(false);
      }
  };

  const filteredItems = useMemo(() => {
    return items.filter(item => {
        const categoryMatch = filterCategory === 'all' || item.category === filterCategory;
        const searchMatch = searchTerm 
            ? item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
              (item.sku && item.sku.toLowerCase().includes(searchTerm.toLowerCase())) ||
              (item.brand && item.brand.toLowerCase().includes(searchTerm.toLowerCase()))
            : true;
        return categoryMatch && searchMatch;
    });
  }, [items, searchTerm, filterCategory]);
  
const handleSaveItem = async (data: ItemFormValues, item: InventoryItem | null, imageFile: File | null) => {
    try {
        let currentImageUrl = item?.imageUrl || '';

        if (imageFile) {
            toast({ title: 'Uploading...', description: 'Please wait while the image updates.' });
            currentImageUrl = await uploadImage(imageFile, 'inventory');
        }

        const finalData: Partial<InventoryItem> = {
            ...data,
            imageUrl: currentImageUrl,
        };

        if (item) {
            await updateInventoryItem(item.id, finalData);
            toast({ title: 'Success', description: 'Item updated successfully.' });
        } else {
            const newItemData: Omit<InventoryItem, 'id' | 'createdAt' | 'updatedAt'> = {
                ...finalData,
                quantity: 0,
                cost: 0,
                stock: {},
            };
            await addInventoryItem(newItemData as any);
            toast({ title: 'Success', description: 'Item added successfully.' });
        }

        setIsItemDialogOpen(false);
        router.replace('/inventory', { scroll: false });

    } catch (error: any) {
        console.error("Save Error:", error);
        toast({ variant: 'destructive', title: 'Save Failed', description: error.message || 'Something went wrong' });
    }
};

  const handleDownloadImage = (elementId: string, itemName: string) => {
    const element = document.getElementById(elementId);
    if (element) {
        html2canvas(element, { useCORS: true, backgroundColor: null, scale: 3 }).then(canvas => {
            const link = document.createElement('a');
            link.download = `${itemName.replace(/\s+/g, '_')}.png`;
            link.href = canvas.toDataURL("image/png");
            link.click();
        });
    }
  };

  const handleLastPurchase = (item: InventoryItem) => {
    const lastPurchaseTx = allTransactions
        .filter(tx => 
            (tx.type === 'purchase' || tx.type === 'credit_purchase') && 
            tx.items?.some(i => i.id === item.id)
        )
        .sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];

    if (!lastPurchaseTx) {
        toast({
            variant: 'default',
            title: 'No Purchase History',
            description: `No purchase record found for ${item.name}.`
        });
        return;
    }
    
    if (lastPurchaseTx.partyId) {
        const params = new URLSearchParams({
            dateFrom: lastPurchaseTx.date,
            dateTo: lastPurchaseTx.date,
            productIds: item.id,
            partyIds: lastPurchaseTx.partyId,
        });
        router.push(`/reports/purchase?${params.toString()}`);
    } else {
        toast({
            title: 'Purchase Found without Party',
            description: `A purchase was found on ${formatDate(lastPurchaseTx.date)}, but it's not linked to a specific supplier.`
        });
    }
};


  const renderItemCard = (item: InventoryItem) => {
    const isLowStock = item.quantity > 0 && item.quantity <= item.minStockLevel;
    const isOutOfStock = item.quantity <= 0;
    
    const gradientColor = isOutOfStock
      ? 'from-red-500/80'
      : isLowStock
      ? 'from-yellow-400/80'
      : 'from-green-500/80';
    
    const profile = appSettings?.businessProfiles.find(p => p.name === item.via);
    const elementId = `item-card-image-${item.id}`;

    return (
        <Card key={item.id} className="group flex flex-col overflow-hidden rounded-lg">
            <div className="relative aspect-square w-full" >
                <div id={elementId} className="absolute inset-0">
                    <Image 
                        src={item.imageUrl || `https://placehold.co/400x400.png`} 
                        alt={item.name}
                        fill
                        sizes="(max-width: 768px) 50vw, (max-width: 1200px) 33vw, 25vw"
                        className="object-cover"
                        
                    />
                    <div className={cn("absolute top-0 left-0 w-full p-2 bg-gradient-to-r to-transparent", gradientColor)}>
                        <p className="text-white text-base font-extrabold truncate leading-tight">{item.name}</p>
                    </div>
                    {profile?.logoUrl && (
                        <div className="absolute bottom-2 right-2 z-10 h-16 w-24">
                            <Image
                            src={profile.logoUrl}
                            alt={`${profile.name} logo`}
                            fill
                            className="object-contain drop-shadow-lg"
                            
                            />
                        </div>
                    )}
                </div>
                 <div className="absolute top-2 right-2 z-10 opacity-0 group-hover:opacity-100 transition-opacity">
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="secondary" size="icon" className="h-7 w-7 bg-black/50 text-white hover:bg-black/70">
                                <MoreVertical className="h-4 w-4" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuItem asChild><Link href={`/reports/stock-in-out?productName=${encodeURIComponent(item.name)}`}><FileText className="mr-2 h-4 w-4" /> View Report</Link></DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleLastPurchase(item)}><History className="mr-2 h-4 w-4" /> Last Purchase</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setAdjustingItem(item)}>Adjust Stock</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleRecalculateStock(item.id)}>Recalculate Stock</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleDownloadImage(elementId, item.name)}>Download Image</DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => { setEditingItem(item); setIsItemDialogOpen(true); }}><Edit className="mr-2 h-4 w-4" /> Edit Item</DropdownMenuItem>
                            <AlertDialog>
                                <AlertDialogTrigger asChild><DropdownMenuItem onSelect={(e) => e.preventDefault()} className="text-destructive">Delete Item</DropdownMenuItem></AlertDialogTrigger>
                                <AlertDialogContent>
                                    <AlertDialogHeader><AlertDialogTitle>Are you sure?</AlertDialogTitle><AlertDialogDescriptionComponent>This will permanently delete the item. This action cannot be undone and might affect historical reports.</AlertDialogDescriptionComponent></AlertDialogHeader>
                                    <AlertDialogFooter>
                                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                                        <AlertDialogAction onClick={() => deleteInventoryItem(item.id)}>Delete</AlertDialogAction>
                                    </AlertDialogFooter>
                                </AlertDialogContent>
                            </AlertDialog>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            </div>
            <CardContent className="p-3 flex-grow flex flex-col justify-between">
                <div>
                    <Badge variant="outline" className="mb-1">{item.category}</Badge>
                </div>
                <div className="flex justify-between items-end mt-2">
                    <p className="font-semibold text-base">{formatAmount(item.price)}</p>
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger>
                                <div 
                                    className={cn(
                                        'shrink-0 rounded-md px-2.5 py-1 text-sm font-semibold text-white', 
                                        isOutOfStock ? 'bg-red-500' : 
                                        isLowStock ? 'bg-yellow-400' : 
                                        'bg-green-500'
                                    )}
                                >
                                    Stock: {item.quantity}
                                </div>
                            </TooltipTrigger>
                             <TooltipContent>
                                {item.stock && Object.keys(item.stock).length > 0 ? (
                                    <div className="space-y-1 text-xs">
                                        {Object.entries(item.stock).map(([location, qty]) => (
                                            <div key={location} className="flex justify-between gap-4">
                                                <span>{location}:</span>
                                                <span className="font-semibold">{qty}</span>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <p className="text-xs">No location-specific stock data.</p>
                                )}
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                </div>
            </CardContent>
        </Card>
    );
  };
  
  const renderItemRow = (item: InventoryItem) => (
      <TableRow key={item.id}>
          <TableCell className="font-medium flex items-center gap-3">
              <Avatar className="h-9 w-9 rounded-md"><AvatarImage src={item.imageUrl} alt={item.name} /><AvatarFallback className="rounded-md"><Package/></AvatarFallback></Avatar>
              {item.name}
          </TableCell>
          <TableCell><Badge variant="outline">{item.category}</Badge></TableCell>
          <TableCell>{item.sku}</TableCell>
          <TableCell className="text-right font-mono">{formatAmount(item.cost)}</TableCell>
          <TableCell className="text-right font-mono">{formatAmount(item.price)}</TableCell>
          <TableCell className={cn("text-right font-semibold", item.quantity <= item.minStockLevel && "text-red-500")}>
               <TooltipProvider>
                  <Tooltip>
                      <TooltipTrigger asChild>
                          <span>{item.quantity}</span>
                      </TooltipTrigger>
                      <TooltipContent>
                          {item.stock && Object.keys(item.stock).length > 0 ? (
                              <div className="space-y-1 text-xs">
                                  {Object.entries(item.stock).map(([location, qty]) => (
                                      <div key={location} className="flex justify-between gap-4">
                                          <span>{location}:</span>
                                          <span className="font-semibold">{qty}</span>
                                      </div>
                                  ))}
                              </div>
                          ) : (
                              <p className="text-xs">No location-specific stock data.</p>
                          )}
                      </TooltipContent>
                  </Tooltip>
              </TooltipProvider>
          </TableCell>
          <TableCell className="text-center">
              <DropdownMenu>
                  <DropdownMenuTrigger asChild><Button variant="ghost" size="icon"><MoreVertical className="h-4 w-4" /></Button></DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                      <DropdownMenuItem asChild><Link href={`/reports/stock-in-out?productName=${encodeURIComponent(item.name)}`}><FileText className="mr-2 h-4 w-4" /> View Report</Link></DropdownMenuItem>
                       <DropdownMenuItem onClick={() => handleLastPurchase(item)}><History className="mr-2 h-4 w-4" /> Last Purchase</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setAdjustingItem(item)}>Adjust Stock</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleRecalculateStock(item.id)}>Recalculate Stock</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => { setEditingItem(item); setIsItemDialogOpen(true); }}><Edit className="mr-2 h-4 w-4" /> Edit Item</DropdownMenuItem>
                      <AlertDialog>
                          <AlertDialogTrigger asChild>
                              <DropdownMenuItem onSelect={(e) => e.preventDefault()} className="text-destructive">Delete Item</DropdownMenuItem>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                              <AlertDialogHeader>
                                  <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                                  <AlertDialogDescriptionComponent>This will permanently delete the item. This action cannot be undone and might affect historical reports.</AlertDialogDescriptionComponent>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction onClick={() => deleteInventoryItem(item.id)}>Delete</AlertDialogAction>
                              </AlertDialogFooter>
                          </AlertDialogContent>
                      </AlertDialog>
                  </DropdownMenuContent>
              </DropdownMenu>
          </TableCell>
      </TableRow>
  );

  return (
    <div className="space-y-6">
      <StockAdjustmentDialog item={adjustingItem} open={!!adjustingItem} onOpenChange={() => setAdjustingItem(null)} appSettings={appSettings} />
      <CategoryManagerDialog open={isCategoryDialogOpen} onOpenChange={setIsCategoryDialogOpen} categories={categories} />
      <ItemFormDialog 
        open={isItemDialogOpen} 
        onOpenChange={(open) => {
            setIsItemDialogOpen(open);
            if (!open) {
                setEditingItem(null);
                router.replace('/inventory', { scroll: false });
            }
        }} 
        onSave={handleSaveItem} 
        item={editingItem} 
        categories={categories} 
        parties={[]}
        allItems={items}
        appSettings={appSettings}
      />
      
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card><CardHeader className="p-3 flex-row items-center justify-between"><CardTitle className="text-sm font-medium">Total Items</CardTitle><Boxes className="h-4 w-4 text-muted-foreground"/></CardHeader><CardContent className="p-3 pt-0"><div className="text-2xl font-bold">{items.length}</div></CardContent></Card>
          <Card><CardHeader className="p-3 flex-row items-center justify-between"><CardTitle className="text-sm font-medium">Stock Value (Cost)</CardTitle><Archive className="h-4 w-4 text-muted-foreground"/></CardHeader><CardContent className="p-3 pt-0"><div className="text-2xl font-bold">{formatAmount(totalStockValueCost)}</div></CardContent></Card>
          <Card><CardHeader className="p-3 flex-row items-center justify-between"><CardTitle className="text-sm font-medium">Stock Value (Sale)</CardTitle><Archive className="h-4 w-4 text-muted-foreground"/></CardHeader><CardContent className="p-3 pt-0"><div className="text-2xl font-bold">{formatAmount(totalStockValueSale)}</div></CardContent></Card>
          <Card><CardHeader className="p-3 flex-row items-center justify-between"><CardTitle className="text-sm font-medium">Low Stock</CardTitle><AlertTriangle className="h-4 w-4 text-muted-foreground"/></CardHeader><CardContent className="p-3 pt-0"><div className="text-2xl font-bold text-orange-600">{lowStockCount}</div></CardContent></Card>
      </div>

      <Card>
        <CardContent className="p-4 space-y-4">
           <div className="flex flex-col md:flex-row gap-2">
                <div className="relative flex-grow">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input placeholder="Search by name, SKU, or brand..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-10" />
                </div>
                 <div className="flex gap-2 flex-wrap">
                    <Select value={filterCategory} onValueChange={setFilterCategory}>
                        <SelectTrigger className="w-full sm:w-[180px]"><SelectValue placeholder="All Categories" /></SelectTrigger>
                        <SelectContent><SelectItem value="all">All Categories</SelectItem>{categories.map(c => <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>)}</SelectContent>
                    </Select>
                     <Button variant="outline" onClick={() => setIsCategoryDialogOpen(true)}><SlidersHorizontal className="mr-2 h-4 w-4"/>Manage</Button>
                    <div className="p-1 bg-muted rounded-md flex items-center">
                        <Button variant={viewMode === 'grid' ? 'secondary' : 'ghost'} size="icon" onClick={() => setViewMode('grid')}><Grip className="h-5 w-5"/></Button>
                        <Button variant={viewMode === 'list' ? 'secondary' : 'ghost'} size="icon" onClick={() => setViewMode('list')}><List className="h-5 w-5"/></Button>
                    </div>
                     <AlertDialog>
                        <AlertDialogTrigger asChild><Button variant="destructive" disabled={isRecalculating}>{isRecalculating ? <Loader2 className="animate-spin mr-2"/> : <DatabaseZap className="mr-2"/>} Recalculate All</Button></AlertDialogTrigger>
                        <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Confirm Global Recalculation</AlertDialogTitle><AlertDialogDescriptionComponent>This will recalculate all item stocks based on historical sales and purchases. Use this if you find major discrepancies. This can take a while.</AlertDialogDescriptionComponent></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={handleGlobalRecalculate}>Recalculate</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
                    </AlertDialog>
                     <Button onClick={() => { setEditingItem(null); setIsItemDialogOpen(true); }}><Plus className="mr-2 h-4 w-4" /> Add Item</Button>
                 </div>
          </div>
          
          {loading ? (
             <div className="flex justify-center items-center h-64"><Loader2 className="animate-spin h-8 w-8 text-primary"/></div>
          ) : viewMode === 'grid' ? (
             <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                 {filteredItems.map(renderItemCard)}
             </div>
          ) : (
          <div className="rounded-md border overflow-x-auto">
            <Table>
                <TableHeader><TableRow><TableHead>Item</TableHead><TableHead>Category</TableHead><TableHead>SKU</TableHead><TableHead className="text-right">Cost</TableHead><TableHead className="text-right">Price</TableHead><TableHead className="text-right">Stock</TableHead><TableHead className="text-center">Actions</TableHead></TableRow></TableHeader>
                <TableBody>
                    {filteredItems.length > 0 ? (
                        filteredItems.map(renderItemRow)
                    ) : (
                        <TableRow><TableCell colSpan={7} className="h-24 text-center">No items found.</TableCell></TableRow>
                    )}
                </TableBody>
            </Table>
          </div>
          )}

        </CardContent>
      </Card>
    </div>
  )
}