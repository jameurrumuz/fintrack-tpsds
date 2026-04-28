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
    const [quantity, s