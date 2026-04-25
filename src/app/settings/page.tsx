'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { getAppSettings, saveAppSettings } from '@/services/settingsService';
import { recalculateBalancesFromTransaction } from '@/services/transactionService';
import type { AppSettings, BusinessProfile, ColorTheme, CustomerService, InventoryItem, Party, PaymentInstruction, Account, DepositChannel, AutoTransactionRule, ExpenseBook, ExpenseCategory, ChargeRule, SmsBlocklistRule, TradeLicenceField, SmsPackage, MemberCategoryConfig, PageSecurity, NewsCategory } from '@/types';
import { Loader2, Plus, Trash2, Save, Settings, Palette, Database, RefreshCcw, DatabaseZap, Wrench, ChevronsUpDown, Check, Briefcase, Edit, X, Bot, Smartphone, CreditCard, ImageIcon, Upload, Camera, BookOpen, ShieldQuestion, Clock, Lock, KeyRound, Store } from 'lucide-react';
import { useFieldArray, useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Slider } from '@/components/ui/slider';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription as AlertDialogDescriptionComponent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { cn, cleanUndefined, applyTheme } from '@/lib/utils';
import { buttonVariants } from '@/components/ui/button';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { predefinedThemes } from '@/lib/themes';
import QrCodeCard from '@/components/QrCodeCard';
import { Switch } from '@/components/ui/switch';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { subscribeToInventoryItems } from '@/services/inventoryService';
import { subscribeToParties } from '@/services/partyService';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogClose } from '@/components/ui/dialog';
import { subscribeToAccounts } from '@/services/accountService';
import { doc, collection } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { uploadImage } from '@/services/storageService';
import Link from 'next/link';


const paymentInstructionSchema = z.object({
  method: z.string().min(1, 'Method is required'),
  number: z.string().min(1, 'Number is required'),
  type: z.string().min(1, 'Type is required'),
});

const businessProfileSchema = z.object({
  name: z.string().min(1, 'Profile name is required'),
  address: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email({ message: 'Invalid email address' }).optional().or(z.literal('')),
  themeName: z.string().optional(),
  logoUrl: z.string().optional(),
  location: z.string().optional(),
  paymentInstruction: paymentInstructionSchema.optional(),
});

const depositChannelSchema = z.object({
    accountId: z.string().min(1, 'Account is required'),
    senderIdentifier: z.string().min(1, 'Sender Name/Number is required'),
    messageFilterType: z.enum(['all', 'startsWith', 'endsWith', 'contains', 'exact']).optional(),
    messageFilterText: z.string().optional(),
});

const customerServiceSchema = z.object({
  id: z.string(),
  name: z.string().min(1, "Service name is required"),
  description: z.string().optional(),
  price: z.coerce.number().min(0, "Price must be non-negative").optional(),
  amountType: z.enum(['fixed', 'any']).optional(),
  depositChannels: z.array(depositChannelSchema).optional(),
  productId: z.string().optional(),
  productName: z.string().optional(),
  quantity: z.coerce.number().min(1, "Quantity must be at least 1").optional(),
  usageLimit: z.coerce.number().min(0, "Usage limit cannot be negative").optional(),
  type: z.enum(['income', 'sale', 'receive', 'give']),
  enabled: z.boolean(),
  isUnlimited: z.boolean().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  verifiableBy: z.array(z.string()).optional(),
  lastUpdatedAt: z.string().optional(),
  via: z.string().optional(),
});

const autoTransactionRuleSchema = z.object({
  id: z.string(),
  name: z.string().min(1, 'Rule name is required'),
  senderIdentifier: z.string().min(1, 'Sender identifier is required'),
  amountKeyword: z.string().optional(),
  messageFilter: z.string().optional(),
  transactionType: z.enum(['income', 'spent', 'receive', 'give']),
  accountId: z.string().min(1, 'Account is required'),
  partyId: z.string().optional(),
  via: z.string().optional(),
  enabled: z.boolean(),
});

const expenseCategorySchema = z.object({
  id: z.string(),
  name: z.string().min(1, "Category name is required."),
});

const expenseBookSchema = z.object({
  id: z.string(),
  name: z.string().min(1, "Book name is required."),
  type: z.enum(['income', 'spent', 'receive', 'give']),
  categories: z.array(expenseCategorySchema),
  via: z.string().optional(),
});

const smsTemplateSchema = z.object({
  id: z.string(),
  type: z.enum(['creditSale', 'cashSale', 'receivePayment', 'givePayment', 'paymentReminder', 'creditSaleWithPartPayment']),
  message: z.string().min(1, 'Template message cannot be empty.'),
});

const appSettingsSchema = z.object({
  businessProfiles: z.array(businessProfileSchema),
  partyTypes: z.array(z.object({ value: z.string().min(1) })),
  partyGroups: z.array(z.object({ value: z.string().min(1) })),
  inventoryLocations: z.array(z.object({ value: z.string().min(1) })).optional(),
  fontSize: z.number().min(12).max(20).optional(),
  customerServices: z.array(customerServiceSchema).optional(),
  autoTransactionRules: z.array(autoTransactionRuleSchema).optional(),
  expenseBooks: z.array(expenseBookSchema).optional(),
  smsServiceEnabled: z.boolean().optional(),
  smsTemplates: z.array(smsTemplateSchema).optional(),
  securityQuestion: z.string().optional(),
  securityAnswer: z.string().optional(),
  autoLockTimeout: z.coerce.number().optional(),
  tradeLicenceFieldOrder: z.array(z.object({
    id: z.string(),
    label: z.string(),
    order: z.coerce.number()
  })).optional(),
  smsqApiKey: z.string().optional(),
  smsqClientId: z.string().optional(),
  smsqSenderId: z.string().optional(),
  twilioAccountSid: z.string().optional(),
  twilioAuthToken: z.string().optional(),
  twilioMessagingServiceSid: z.string().optional(),
  pushbulletAccessToken: z.string().optional(),
  pushbulletDeviceId: z.string().optional(),
});

type AppSettingsFormValues = z.infer<typeof appSettingsSchema>;
type CustomerServiceFormValues = z.infer<typeof customerServiceSchema>;

const ProductCombobox = ({ items, value, onSelect, className }: { items: InventoryItem[], value: string | undefined, onSelect: (item: InventoryItem) => void, className?: string }) => {
    const [open, setOpen] = useState(false)
    const currentItemName = items.find((item) => item.id === value)?.name || "Select product...";

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={open}
                    className={cn("w-full justify-between font-normal", className)}
                >
                    {currentItemName}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
                <Command>
                    <CommandInput placeholder="Search product..." />
                    <CommandList>
                        <CommandEmpty>No item found.</CommandEmpty>
                        <CommandGroup>{items.map((item) => (<CommandItem key={item.id} value={item.name} onSelect={() => { onSelect(item); setOpen(false);}}>
                             <Check className={cn("mr-2 h-4 w-4", value === item.id ? "opacity-100" : "opacity-0")} />
                            {item.name}</CommandItem>))}</CommandGroup>
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    );
};

const PartyCombobox = ({ parties, value, onChange, className }: { parties: Party[], value: string | undefined, onChange: (value: string) => void, className?: string }) => {
    const [open, setOpen] = useState(false);
    const currentPartyName = parties.find((party) => party.id === value)?.name || "Select party...";

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button variant="outline" role="combobox" aria-expanded={open} className={cn("w-full justify-between font-normal", className)}>
                    {currentPartyName}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
                <Command>
                    <CommandInput placeholder="Search party..." />
                    <CommandList>
                        <CommandEmpty>No party found.</CommandEmpty>
                        <CommandGroup>
                            <CommandItem value="none" onSelect={() => { onChange(''); setOpen(false); }}>
                                <Check className={cn("mr-2 h-4 w-4", !value ? "opacity-100" : "opacity-0")} />
                                None
                            </CommandItem>
                            {parties.map((party) => (
                                <CommandItem key={party.id} value={party.name} onSelect={() => { onChange(party.id); setOpen(false); }}>
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


export const ServiceFormDialog = ({
  open,
  onOpenChange,
  onSave,
  service,
  inventoryItems,
  staffList,
  accounts,
  allowedTypes,
  appSettings
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (data: CustomerService) => void;
  service: CustomerService | null;
  inventoryItems: InventoryItem[];
  staffList: Party[];
  accounts: Account[];
  allowedTypes: ('income' | 'sale' | 'receive' | 'give')[];
  appSettings: AppSettings | null;
}) => {
  const form = useForm<CustomerServiceFormValues>({
    resolver: zodResolver(customerServiceSchema),
  });

  const { fields: channelFields, append: appendChannel, remove: removeChannel } = useFieldArray({
      control: form.control,
      name: "depositChannels",
  });
  
  const depositChannels = form.watch('depositChannels');
  const serviceType = form.watch('type');
  const amountType = form.watch('amountType');

  useEffect(() => {
    if (service) {
      form.reset({ ...service, depositChannels: service.depositChannels || [], amountType: service.amountType || 'fixed' });
    } else {
      const newServiceId = doc(collection(db, 'temp')).id;
      form.reset({
        id: newServiceId,
        name: '',
        description: '',
        price: 0,
        amountType: 'fixed',
        productId: '',
        productName: '',
        depositChannels: [],
        quantity: 1,
        usageLimit: 0,
        type: allowedTypes[0] || 'income',
        enabled: true,
        isUnlimited: true,
        verifiableBy: [],
        via: appSettings?.businessProfiles?.[0]?.name || 'Personal',
      });
    }
  }, [service, open, form, allowedTypes, appSettings]);

  const handleSave = (data: CustomerServiceFormValues) => {
    onSave({ ...data, lastUpdatedAt: new Date().toISOString() });
    onOpenChange(false);
  };
  
  const isUnlimited = form.watch('isUnlimited');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{service ? 'Edit Service' : 'Create New Service'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(handleSave)} className="space-y-4 py-4">
           <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-center">
                <div className="space-y-1">
                    <Label>Service Name *</Label>
                     <Input {...form.register(`name`)} placeholder="e.g., Normal Bike Wash" />
                </div>
                {(serviceType === 'sale') && (
                    <div className="space-y-1">
                        <Label>Product Name</Label>
                        <Controller
                            control={form.control}
                            name={`productId`}
                            render={({ field }) => (
                                <ProductCombobox
                                    items={inventoryItems}
                                    value={field.value}
                                    onSelect={(item) => {
                                        field.onChange(item.id);
                                        form.setValue(`productName`, item.name);
                                        form.setValue(`name`, item.name);
                                        form.setValue(`price`, item.price);
                                    }}
                                />
                            )}
                        />
                    </div>
                )}
                 <div className="space-y-1">
                    <Label>Type</Label>
                    <Controller
                        control={form.control}
                        name={`type`}
                        render={({ field }) => (
                            <Select onValueChange={field.onChange} value={field.value}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    {allowedTypes.map(type => (
                                      <SelectItem key={type} value={type}>{type.charAt(0).toUpperCase() + type.slice(1)}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        )}
                    />
                </div>
            </div>
             <div className="space-y-1">
                <Label>Business Profile (Via)</Label>
                <Controller
                    name="via"
                    control={form.control}
                    render={({ field }) => (
                        <Select onValueChange={field.onChange} value={field.value}>
                            <SelectTrigger><SelectValue placeholder="Select profile..." /></SelectTrigger>
                            <SelectContent>
                                {(appSettings?.businessProfiles || []).map(p => <SelectItem key={p.name} value={p.name}>{p.name}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    )}
                />
            </div>
            <div className="space-y-1"><Label>Description for Customer</Label><Textarea {...form.register(`description`)} placeholder="Describe the service..." /></div>

             <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                 <div className="space-y-1">
                    <Label>Amount Type</Label>
                     <Controller
                        control={form.control}
                        name={`amountType`}
                        render={({ field }) => (
                            <Select onValueChange={field.onChange} value={field.value}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                      <SelectItem value="fixed">Fixed Amount</SelectItem>
                                      <SelectItem value="any">Any Amount</SelectItem>
                                </SelectContent>
                            </Select>
                        )}
                    />
                 </div>
                {amountType === 'fixed' && (
                    <div className="space-y-1"><Label>Price</Label><Input type="number" {...form.register(`price`)} placeholder="0.00" /></div>
                )}
                {(serviceType === 'sale') && (
                    <>
                        <div className="space-y-1"><Label>Quantity</Label><Input type="number" {...form.register(`quantity`)} placeholder="1" /></div>
                        <div className="space-y-1"><Label>Usage Limit per Customer</Label><Input type="number" {...form.register(`usageLimit`)} placeholder="0 for unlimited" /></div>
                    </>
                )}
            </div>

            <div className="space-y-2 p-3 border rounded-md">
                <Label className="font-semibold">Deposit Accounts &amp; Senders *</Label>
                <div className="space-y-3">
                   {channelFields.map((field, index) => (
                      <div key={field.id} className="p-3 border rounded-md relative bg-muted/50 space-y-3">
                         <Button type="button" variant="ghost" size="icon" className="absolute -top-3 -right-3 h-6 w-6 bg-background" onClick={() => removeChannel(index)}><X className="h-4 w-4 text-destructive"/></Button>
                         <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                             <Controller
                                name={`depositChannels.${index}.accountId`}
                                control={form.control}
                                render={({ field }) => (
                                  <Select onValueChange={field.onChange} value={field.value}>
                                    <SelectTrigger><SelectValue placeholder="Select account..."/></SelectTrigger>
                                    <SelectContent>{accounts.map(acc => <SelectItem key={acc.id} value={acc.id}>{acc.name}</SelectItem>)}</SelectContent>
                                  </Select>
                                )}
                             />
                             <Input {...form.register(`depositChannels.${index}.senderIdentifier`)} placeholder="Sender Name/Number (e.g., BKASH)" />
                         </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                               <Controller
                                  name={`depositChannels.${index}.messageFilterType`}
                                  control={form.control}
                                  render={({ field }) => (
                                      <Select onValueChange={field.onChange} value={field.value || 'all'}>
                                          <SelectTrigger><SelectValue placeholder="Message filter..." /></SelectTrigger>
                                          <SelectContent>
                                              <SelectItem value="all">All Messages</SelectItem>
                                              <SelectItem value="startsWith">Starts With</SelectItem>
                                              <SelectItem value="endsWith">Ends With</SelectItem>
                                              <SelectItem value="contains">Contains</SelectItem>
                                              <SelectItem value="exact">Exact Match</SelectItem>
                                          </SelectContent>
                                      </Select>
                                  )}
                              />
                               {depositChannels?.[index]?.messageFilterType && depositChannels[index].messageFilterType !== 'all' && (
                                   <Input {...form.register(`depositChannels.${index}.messageFilterText`)} placeholder="Message text to filter..." />
                               )}
                          </div>
                      </div>
                   ))}
                </div>
                <Button type="button" variant="outline" size="sm" onClick={() => appendChannel({ accountId: '', senderIdentifier: '', messageFilterType: 'all', messageFilterText: '' })}>
                    <Plus className="mr-2 h-4 w-4"/> Add Deposit Channel
                </Button>
                {form.formState.errors.depositChannels && <p className="text-destructive text-xs mt-1">{Array.isArray(form.formState.errors.depositChannels) ? form.formState.errors.depositChannels[0]?.message : form.formState.errors.depositChannels.message}</p>}
            </div>

            {(serviceType === 'sale' || serviceType === 'income') && (
              <>
                <div className="flex items-center space-x-2 pt-2"><Controller control={form.control} name={`isUnlimited`} render={({ field }) => (<Checkbox id={`isUnlimited-dialog`} checked={field.value} onCheckedChange={field.onChange} />)} /><Label htmlFor={`isUnlimited-dialog`}>This service has no time limit</Label></div>
                {!isUnlimited && (<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="space-y-1"><Label>Start Date</Label><Input type="date" {...form.register(`startDate`)} /></div>
                    <div className="space-y-1"><Label>End Date</Label><Input type="date" {...form.register(`endDate`)} /></div>
                </div>)}
              </>
            )}
            
            <div className="space-y-1"><Label>Staff Who Can Verify Payment</Label>
              <Controller
                  name={`verifiableBy`}
                  control={form.control}
                  render={({ field }) => (
                    <Popover>
                        <PopoverTrigger asChild>
                          <Button variant="outline" className="w-full justify-start font-normal">
                            {field.value && field.value.length > 0 ? `${field.value.length} staff selected` : 'Select staff...'}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
                            <Command>
                              <CommandInput placeholder="Search staff..."/>
                              <CommandList>
                                <CommandEmpty>No staff found.</CommandEmpty>
                                <CommandGroup>
                                  {staffList.map((staff) => (
                                    <CommandItem
                                      key={staff.id}
                                      onSelect={() => {
                                        const currentValue = field.value || [];
                                        const newValue = currentValue.includes(staff.id)
                                          ? currentValue.filter((id) => id !== staff.id)
                                          : [...currentValue, staff.id];
                                        field.onChange(newValue);
                                      }}
                                    >
                                      <Check className={cn("mr-2 h-4 w-4", field.value?.includes(staff.id) ? "opacity-100" : "opacity-0")}/>
                                      {staff.name}
                                    </CommandItem>
                                  ))}
                                </CommandGroup>
                              </CommandList>
                            </Command>
                        </PopoverContent>
                    </Popover>
                  )}
              />
            </div>
             <div className="flex items-center space-x-2 pt-2"><Controller control={form.control} name={`enabled`} render={({ field }) => (<Switch id={`service-enabled-dialog`} checked={field.value} onCheckedChange={field.onChange} />)} /><Label htmlFor={`service-enabled-dialog`}>Service Enabled</Label></div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit">Save Changes</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};


const PIN_STORAGE_KEY = 'app-security-pin';
const DEFAULT_PIN = '0035';
const getPin = (): string => {
    if (typeof window === 'undefined') return DEFAULT_PIN;
    return localStorage.getItem(PIN_STORAGE_KEY) || DEFAULT_PIN;
};

const setPinInStorage = (newPin: string) => {
    localStorage.setItem(PIN_STORAGE_KEY, newPin);
};

const ChangePinDialog = ({ onOpenChange }: { onOpenChange: (open: boolean) => void }) => {
    const [currentPin, setCurrentPin] = useState('');
    const [newPin, setNewPin] = useState('');
    const [confirmPin, setConfirmPin] = useState('');
    const [error, setError] = useState('');
    const { toast } = useToast();

    const handleChangePin = () => {
        setError('');
        const storedPin = getPin();
        if (currentPin !== storedPin) {
            setError('Current PIN is incorrect.');
            return;
        }
        if (newPin.length !== 4) {
            setError('New PIN must be 4 digits.');
            return;
        }
        if (newPin !== confirmPin) {
            setError('New PINs do not match.');
            return;
        }

        setPinInStorage(newPin);
        toast({ title: 'Success!', description: 'Your PIN has been changed.' });
        onOpenChange(false);
    };

    return (
        <DialogContent>
            <DialogHeader>
                <DialogTitle>Change Security PIN</DialogTitle>
                <DialogDescription>Enter your current PIN and set a new one.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
                <div className="space-y-2">
                    <Label htmlFor="currentPin">Current PIN</Label>
                    <Input id="currentPin" type="password" value={currentPin} onChange={(e) => setCurrentPin(e.target.value)} maxLength={4} autoComplete="one-time-code" />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="newPin">New PIN</Label>
                    <Input id="newPin" type="password" value={newPin} onChange={(e) => setNewPin(e.target.value)} maxLength={4} autoComplete="one-time-code" />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="confirmPin">Confirm New PIN</Label>
                    <Input id="confirmPin" type="password" value={confirmPin} onChange={(e) => setConfirmPin(e.target.value)} maxLength={4} autoComplete="one-time-code" />
                </div>
                {error && <p className="text-sm text-destructive">{error}</p>}
            </div>
            <DialogFooter>
                 <DialogClose asChild>
                    <Button type="button" variant="ghost">Cancel</Button>
                </DialogClose>
                <Button onClick={handleChangePin}>Change PIN</Button>
            </DialogFooter>
        </DialogContent>
    )
}

export default function SettingsPage() {
  const [loading, setLoading] = useState(true);
  const [isRecalculating, setIsRecalculating] = useState(false);
  const [portalUrl, setPortalUrl] = useState('');
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [parties, setParties] = useState<Party[]>([]);
  const { toast } = useToast();

  const [isServiceFormOpen, setIsServiceFormOpen] = useState(false);
  const [editingService, setEditingService] = useState<CustomerService | null>(null);
  const [editingServiceType, setEditingServiceType] = useState<'product' | 'payment'>('product');
  
  // Keep appSettings in a separate state to pass to dialogs
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);
  const [imageFiles, setImageFiles] = useState<Record<number, File | null>>({});
  const [imagePreviews, setImagePreviews] = useState<Record<number, string>>({});
  const [isChangePinOpen, setIsChangePinOpen] = useState(false);


  const form = useForm<AppSettingsFormValues>({
    resolver: zodResolver(appSettingsSchema),
    defaultValues: {
      businessProfiles: [],
      partyTypes: [],
      partyGroups: [],
      inventoryLocations: [],
      fontSize: 16,
      customerServices: [],
      autoTransactionRules: [],
      expenseBooks: [],
      smsServiceEnabled: true,
      smsTemplates: [],
      securityQuestion: '',
      securityAnswer: '',
      autoLockTimeout: 0,
      tradeLicenceFieldOrder: [],
    },
  });
  
  const { fields: profileFields, append: appendProfile, remove: removeProfile } = useFieldArray({
    control: form.control,
    name: "businessProfiles",
  });
  const { fields: typeFields, append: appendType, remove: removeType } = useFieldArray({
    control: form.control,
    name: "partyTypes",
  });
  const { fields: groupFields, append: appendGroup, remove: removeGroup } = useFieldArray({
    control: form.control,
    name: "partyGroups",
  });
  const { fields: locationFields, append: appendLocation, remove: removeLocation } = useFieldArray({
    control: form.control,
    name: "inventoryLocations",
  });
   const { fields: serviceFields, remove: removeService, update: updateService, replace: replaceServices } = useFieldArray({
    control: form.control,
    name: "customerServices",
  });
  const { fields: autoTxFields, append: appendAutoTx, remove: removeAutoTx } = useFieldArray({
      control: form.control,
      name: "autoTransactionRules",
  });
   const { fields: expenseBookFields, append: appendExpenseBook, remove: removeExpenseBook, update: updateExpenseBook } = useFieldArray({
      control: form.control,
      name: "expenseBooks",
  });
  const { fields: tradeLicenceFields, append: appendTradeLicenceField, remove: removeTradeLicenceField } = useFieldArray({
    control: form.control,
    name: "tradeLicenceFieldOrder",
  });
  
  const [newPartyType, setNewPartyType] = useState('');
  const [newPartyGroup, setNewPartyGroup] = useState('');
  const [newLocation, setNewLocation] = useState('');
  const [newCategoryInputs, setNewCategoryInputs] = useState<Record<string, string>>({});
  
  const watchedSettings = form.watch();

  useEffect(() => {
    // This effect runs only on the client side
    setPortalUrl(`${window.location.origin}/portal/login`);
    
    async function loadSettings() {
      setLoading(true);
      try {
        const settings = await getAppSettings();
        setAppSettings(settings); // Set the separate state
        if (settings) {
          form.reset({
            ...settings,
            businessProfiles: settings.businessProfiles || [],
            partyTypes: (settings.partyTypes || []).map(t => ({value: t})),
            partyGroups: (settings.partyGroups || []).map(g => ({value: g})),
            inventoryLocations: (settings.inventoryLocations || []).map(l => ({value: l})),
            fontSize: settings.fontSize || 16,
            customerServices: settings.customerServices || [],
            autoTransactionRules: settings.autoTransactionRules || [],
            expenseBooks: settings.expenseBooks || [],
            smsServiceEnabled: settings.smsServiceEnabled,
            smsTemplates: settings.smsTemplates || [],
            securityQuestion: settings.securityQuestion || '',
            securityAnswer: settings.securityAnswer || '',
            autoLockTimeout: settings.autoLockTimeout || 0,
            tradeLicenceFieldOrder: settings.tradeLicenceFieldOrder || [],
            pushbulletDeviceId: settings.pushbulletDeviceId || '',
          });

          // Set initial image previews
          const previews: Record<number, string> = {};
          (settings.businessProfiles || []).forEach((profile, index) => {
            if (profile.logoUrl) {
              previews[index] = profile.logoUrl;
            }
          });
          setImagePreviews(previews);

          const activeThemeName = settings.businessProfiles?.[0]?.themeName || 'Default Gray';
          applyTheme(predefinedThemes.find(t => t.name === activeThemeName));
        }
        const unsubInventory = subscribeToInventoryItems(setInventoryItems, (e) => toast({ variant: 'destructive', title: 'Error', description: e.message }));
        const unsubParties = subscribeToParties(setParties, (e) => toast({ variant: 'destructive', title: 'Error fetching parties' }));
        const unsubAccounts = subscribeToAccounts(setAccounts, (e) => toast({ variant: 'destructive', title: 'Error fetching accounts' }));
        return () => {
          unsubInventory();
          unsubParties();
          unsubAccounts();
        }
      } catch (error: any) {
        toast({ variant: 'destructive', title: 'Error loading settings', description: error.message });
      } finally {
        setLoading(false);
      }
    }
    loadSettings();
  }, [toast, form]);

  useEffect(() => {
    if (watchedSettings.businessProfiles && watchedSettings.businessProfiles.length > 0) {
        const themeName = watchedSettings.businessProfiles[0]?.themeName || 'Default Gray';
        const selectedTheme = predefinedThemes.find(t => t.name === themeName);
        if (selectedTheme) {
            applyTheme(selectedTheme);
        }
    }
    if (watchedSettings.fontSize) {
      document.documentElement.style.fontSize = `${watchedSettings.fontSize}px`;
    }
  }, [watchedSettings.businessProfiles, watchedSettings.fontSize]);
  
  const handleAddNewPartyType = () => {
    if (newPartyType.trim()) {
      appendType({ value: newPartyType.trim() });
      setNewPartyType('');
    }
  };

  const handleAddNewPartyGroup = () => {
    if (newPartyGroup.trim()) {
      appendGroup({ value: newPartyGroup.trim() });
      setNewPartyGroup('');
    }
  };
  
  const handleAddNewLocation = () => {
    if (newLocation.trim()) {
      appendLocation({ value: newLocation.trim() });
      setNewLocation('');
    }
  };

  
  const handleLogoFileChange = (e: React.ChangeEvent<HTMLInputElement>, index: number) => {
    const file = e.target.files?.[0];
    if (file) {
      setImageFiles(prev => ({...prev, [index]: file}));
      setImagePreviews(prev => ({...prev, [index]: URL.createObjectURL(file)}));
    }
  };

  const handleSettingsSubmit = async (data: AppSettingsFormValues) => {
    try {
        const updatedProfiles = await Promise.all((data.businessProfiles || []).map(async (profile, index) => {
            const file = imageFiles[index];
            if (file) {
                const logoUrl = await uploadImage(file, `business-logos/${profile.name.replace(/\s+/g, '-')}`);
                return { ...profile, logoUrl };
            }
            return { ...profile, logoUrl: appSettings?.businessProfiles?.[index]?.logoUrl || profile.logoUrl };
        }));

        const finalSettings: AppSettings = {
            ...appSettings,
            ...data,
            businessProfiles: updatedProfiles,
            partyTypes: data.partyTypes.map(t => t.value),
            partyGroups: data.partyGroups.map(g => g.value),
            inventoryLocations: (data.inventoryLocations || []).map(l => l.value),
            autoTransactionRules: (data.autoTransactionRules || []).map(rule => ({
                ...rule,
                via: rule.via === 'all' ? undefined : rule.via,
            })),
            expenseBooks: data.expenseBooks || [],
            tradeLicenceFieldOrder: data.tradeLicenceFieldOrder || [],
            // Ensure smsTemplates is an array of objects
            smsTemplates: (data.smsTemplates || []).map(t => ({ id: t.id, type: t.type, message: t.message })),
            newsCategories: appSettings?.newsCategories || [],
        };
        
        await saveAppSettings(cleanUndefined(finalSettings));
        setAppSettings(finalSettings); // Update local state so future changes use updated base
        
        localStorage.setItem('app-security-question', data.securityQuestion || '');
        localStorage.setItem('app-security-answer', data.securityAnswer || '');
        localStorage.setItem('autoLockTimeout', (data.autoLockTimeout || 0).toString());
        
        if (data.fontSize) {
            localStorage.setItem('app-font-size', data.fontSize.toString());
        }
        if (data.businessProfiles && data.businessProfiles.length > 0) {
          const themeName = data.businessProfiles[0]?.themeName || 'Default Gray';
          const theme = predefinedThemes.find(t => t.name === themeName);
          if (theme) {
              localStorage.setItem('activeThemeName', theme.name);
              localStorage.setItem('activeThemeColors', JSON.stringify(theme.colors));
          }
        }
  
      toast({ title: 'Success', description: 'Settings saved successfully.' });
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Error saving settings', description: error.message });
    }
  };

  const handleRecalculate = async () => {
      setIsRecalculating(true);
      toast({ title: 'Balance Recalculation Started', description: 'This may take a few moments...' });
      try {
          await recalculateBalancesFromTransaction();
          toast({ title: 'Success!', description: 'All account and party balances have been recalculated and synced successfully.' });
      } catch (error: any) {
           toast({ variant: 'destructive', title: 'Error', description: error.message });
      } finally {
          setIsRecalculating(false);
      }
  };

  const handleSaveService = (serviceData: CustomerService) => {
    const services = form.getValues('customerServices') || [];
    const existingIndex = services.findIndex(s => s.id === serviceData.id);

    if (existingIndex > -1) {
        const updatedServices = [...services];
        updatedServices[existingIndex] = serviceData;
        replaceServices(updatedServices);
    } else {
        const newServices = [...services, serviceData];
        replaceServices(newServices);
    }
  };
  
  const handleEditService = (service: CustomerService, type: 'product' | 'payment') => {
      setEditingService(service);
      setEditingServiceType(type);
      setIsServiceFormOpen(true);
  }

  const handleAddCategoryToBook = (bookIndex: number) => {
    const bookId = expenseBookFields[bookIndex].id;
    const categoryName = newCategoryInputs[bookId];
    if (categoryName && categoryName.trim()) {
      const currentCategories = expenseBookFields[bookIndex].categories || [];
      const newCategory = { id: `cat-${Date.now()}`, name: categoryName.trim() };
      updateExpenseBook(bookIndex, {
        ...expenseBookFields[bookIndex],
        categories: [...currentCategories, newCategory],
      });
      setNewCategoryInputs(prev => ({ ...prev, [bookId]: '' }));
    }
  };

  const handleRemoveCategory = (bookIndex: number, categoryIndex: number) => {
    const currentCategories = expenseBookFields[bookIndex].categories;
    const updatedCategories = currentCategories.filter((_, idx) => idx !== categoryIndex);
    updateExpenseBook(bookIndex, {
      ...expenseBookFields[bookIndex],
      categories: updatedCategories,
    });
  };

  const staffList = useMemo(() => parties.filter(p => p.partyType === 'Staff'), [parties]);
  
  const productServices = useMemo(() => (watchedSettings.customerServices || []).filter(s => s.type === 'sale' || s.type === 'income'), [watchedSettings.customerServices]);
  const paymentServices = useMemo(() => (watchedSettings.customerServices || []).filter(s => s.type === 'receive' || s.type === 'give'), [watchedSettings.customerServices]);


  if (loading) {
    return <div className="flex items-center justify-center h-screen"><Loader2 className="h-12 w-12 animate-spin text-primary" /></div>;
  }
  
  return (
    <div className="space-y-8">
       <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3"><Settings/> Application Settings</h1>
        <p className="text-muted-foreground mt-1">Manage central configurations for your application.</p>
      </div>

      <QrCodeCard 
        title="Portal Login QR Code"
        description="Share this QR code with users to let them log in to their portal."
        url={portalUrl}
      />

      <form onSubmit={form.handleSubmit(handleSettingsSubmit)} className="space-y-8">
        
         <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Clock/> Auto-Lock Settings</CardTitle>
            <CardDescription>Set a timer to automatically lock the app after a period of inactivity.</CardDescription>
          </CardHeader>
          <CardContent>
             <div className="max-w-xs space-y-2">
              <Label htmlFor="auto-lock-timeout">Lock after inactivity for</Label>
               <Controller
                  name="autoLockTimeout"
                  control={form.control}
                  render={({ field }) => (
                     <Select onValueChange={(v) => field.onChange(parseInt(v, 10))} value={String(field.value || 0)}>
                        <SelectTrigger id="auto-lock-timeout"><SelectValue /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="0">Never</SelectItem>
                            <SelectItem value="1">1 Minute</SelectItem>
                            <SelectItem value="2">2 Minutes</SelectItem>
                            <SelectItem value="3">3 Minutes</SelectItem>
                            <SelectItem value="4">4 Minutes</SelectItem>
                            <SelectItem value="5">5 Minutes</SelectItem>
                            <SelectItem value="6">6 Minutes</SelectItem>
                            <SelectItem value="7">7 Minutes</SelectItem>
                            <SelectItem value="8">8 Minutes</SelectItem>
                            <SelectItem value="9">9 Minutes</SelectItem>
                            <SelectItem value="10">10 Minutes</SelectItem>
                        </SelectContent>
                    </Select>
                  )}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><ShieldQuestion/> Security Settings</CardTitle>
            <CardDescription>Set up a security question to reset your PIN if you forget it.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
             <div className="space-y-2">
                <Button type="button" variant="outline" onClick={() => setIsChangePinOpen(true)}>
                    <KeyRound className="mr-2 h-4 w-4" /> Change PIN
                </Button>
             </div>
             <div className="space-y-2">
                <Button asChild variant="outline">
                    <Link href="/settings/page-lock"><Lock className="mr-2 h-4 w-4" /> Manage Page Locks</Link>
                </Button>
             </div>
             <div className="space-y-2">
                <Button asChild variant="outline">
                    <Link href="/settings/shop-start-close"><Store className="mr-2 h-4 w-4" /> Shop Start & Close</Link>
                </Button>
             </div>
            <div className="space-y-2">
              <Label htmlFor="securityQuestion">Security Question</Label>
              <Input id="securityQuestion" {...form.register('securityQuestion')} placeholder="e.g., What is your mother's maiden name?" />
            </div>
             <div className="space-y-2">
              <Label htmlFor="securityAnswer">Security Answer</Label>
              <Input id="securityAnswer" {...form.register('securityAnswer')} placeholder="Your answer (case-insensitive)" />
            </div>
          </CardContent>
        </Card>

        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2"><Smartphone/> SMS Service Configuration</CardTitle>
                <CardDescription>Configure how SMS messages are sent from your application.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="flex items-center space-x-2">
                    <Controller name="smsServiceEnabled" control={form.control} render={({ field }) => (<Switch id="sms-service-toggle" checked={field.value} onCheckedChange={field.onChange} />)}/>
                    <Label htmlFor="sms-service-toggle">Enable SMS Service</Label>
                </div>
                 <p className="text-sm text-muted-foreground pt-2">
                    The system will attempt to send SMS in the following priority: 1. Pushbullet, 2. SMSQ, 3. Twilio.
                    Please configure the credentials for the services you want to use.
                </p>
                <div className="space-y-4">
                    <div className="space-y-2 p-4 border rounded-md">
                        <h4 className="font-semibold">Pushbullet Credentials (Priority 1)</h4>
                        <div className="space-y-2">
                            <Label>Access Token</Label>
                            <Input type="password" {...form.register('pushbulletAccessToken')} />
                        </div>
                            <div className="space-y-2">
                            <Label>Device ID</Label>
                            <Input {...form.register('pushbulletDeviceId')} placeholder="Your phone's device ID from Pushbullet"/>
                        </div>
                    </div>

                    <div className="space-y-2 p-4 border rounded-md">
                        <h4 className="font-semibold">SMSQ Credentials (Priority 2)</h4>
                        <div className="space-y-2"><Label>API Key</Label><Input {...form.register('smsqApiKey')} /></div>
                        <div className="space-y-2"><Label>Client ID</Label><Input {...form.register('smsqClientId')} /></div>
                        <div className="space-y-2"><Label>Sender ID</Label><Input {...form.register('smsqSenderId')} /></div>
                    </div>

                    <div className="space-y-2 p-4 border rounded-md">
                        <h4 className="font-semibold">Twilio Credentials (Priority 3)</h4>
                        <div className="space-y-2"><Label>Twilio Account SID</Label><Input {...form.register('twilioAccountSid')} placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"/></div>
                        <div className="space-y-2"><Label>Twilio Auth Token</Label><Input type="password" {...form.register('twilioAuthToken')} /></div>
                        <div className="space-y-2"><Label>Twilio Messaging Service SID</Label><Input {...form.register('twilioMessagingServiceSid')} placeholder="MGxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" /></div>
                    </div>
                </div>
            </CardContent>
        </Card>
        
         <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Palette/> Appearance Settings</CardTitle>
            <CardDescription>Customize the look and feel of the application. Changes are applied live.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6 pt-6">
              <div className="space-y-2">
                <Label>Appearance Settings এ ফন্ট সাইজ পরিবর্তন করে Save All Settings দিলে সেভ হচ্ছে না এটি ঠিক করে দাও যেন সেভ হয় ({watchedSettings.fontSize}px)</Label>
                <Controller
                  name="fontSize"
                  control={form.control}
                  render={({ field }) => (
                    <Slider
                      value={[field.value || 16]}
                      onValueChange={(value) => field.onChange(value[0])}
                      min={12}
                      max={20}
                      step={1}
                    />
                  )}
                />
              </div>

               <div className="space-y-4">
                 <Label>Global Color Theme</Label>
                 <Controller
                    name="businessProfiles.0.themeName"
                    control={form.control}
                    render={({ field }) => (
                       <RadioGroup
                        onValueChange={field.onChange}
                        value={field.value || 'Default Gray'}
                        className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4"
                      >
                        {predefinedThemes.map(theme => (
                            <div key={theme.name}>
                                <RadioGroupItem value={theme.name} className="sr-only" id={theme.name} />
                                <Label htmlFor={theme.name} className={cn("block rounded-md border-2 p-4 cursor-pointer", field.value === theme.name ? 'border-primary' : 'border-muted hover:border-muted-foreground')}>
                                    <div className="flex items-center justify-between">
                                        <span className="font-semibold">{theme.name}</span>
                                        {field.value === theme.name && <div className="h-5 w-5 rounded-full bg-primary" />}
                                    </div>
                                    <div className="mt-2 flex gap-2">
                                        <div className="h-6 w-full rounded" style={{ backgroundColor: `hsl(${theme.colors.primary.h}, ${theme.colors.primary.s}%, ${theme.colors.primary.l}%)` }}></div>
                                        <div className="h-6 w-full rounded" style={{ backgroundColor: `hsl(${theme.colors.secondary.h}, ${theme.colors.secondary.s}%, ${theme.colors.secondary.l}%)` }}></div>
                                        <div className="h-6 w-full rounded" style={{ backgroundColor: `hsl(${theme.colors.accent.h}, ${theme.colors.accent.s}%, ${theme.colors.accent.l}%)` }}></div>
                                    </div>
                                </Label>
                            </div>
                        ))}
                      </RadioGroup>
                    )}
                 />
              </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><BookOpen/> Expense Books</CardTitle>
            <CardDescription>Manage predefined categories for different transaction types to speed up data entry.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {expenseBookFields.map((book, bookIndex) => (
              <Card key={book.id}>
                <CardHeader className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-3 gap-2">
                  <div className="flex-grow grid grid-cols-1 sm:grid-cols-3 gap-4 items-center">
                    <Input {...form.register(`expenseBooks.${bookIndex}.name`)} className="font-semibold text-base" />
                    <Controller
                      name={`expenseBooks.${bookIndex}.type`}
                      control={form.control}
                      render={({ field }) => (
                        <Select onValueChange={field.onChange} value={field.value}>
                          <SelectTrigger><SelectValue/></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="income">Income</SelectItem>
                            <SelectItem value="spent">Spent</SelectItem>
                            <SelectItem value="receive">Receive</SelectItem>
                            <SelectItem value="give">Give</SelectItem>
                          </SelectContent>
                        </Select>
                      )}
                    />
                     <Controller
                      name={`expenseBooks.${bookIndex}.via`}
                      control={form.control}
                      render={({ field }) => (
                        <Select onValueChange={field.onChange} value={field.value || 'all'}>
                          <SelectTrigger><SelectValue placeholder="All Profiles" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All Profiles</SelectItem>
                             {(appSettings?.businessProfiles || []).map(opt => <SelectItem key={opt.name} value={opt.name}>{opt.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      )}
                    />
                  </div>
                  <Button type="button" variant="destructive" size="sm" onClick={() => removeExpenseBook(bookIndex)} className="ml-0 sm:ml-4 mt-2 sm:mt-0"><Trash2 className="h-4 w-4"/></Button>
                </CardHeader>
                <CardContent className="p-3 space-y-2">
                   <Label className="text-xs">Categories</Label>
                  {(book.categories || []).map((category, catIndex) => (
                    <div key={category.id} className="flex items-center gap-2">
                      <Input defaultValue={category.name} onBlur={(e) => {
                          const updatedCategory = { ...category, name: e.target.value };
                          const updatedCategories = [...book.categories];
                          updatedCategories[catIndex] = updatedCategory;
                          updateExpenseBook(bookIndex, { ...book, categories: updatedCategories });
                      }}/>
                      <Button type="button" variant="ghost" size="icon" onClick={() => handleRemoveCategory(bookIndex, catIndex)}>
                        <X className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  ))}
                   <div className="flex items-center gap-2 pt-2">
                      <Input
                        placeholder="Add new category..."
                        value={newCategoryInputs[book.id] || ''}
                        onChange={(e) => setNewCategoryInputs(prev => ({ ...prev, [book.id]: e.target.value }))}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddCategoryToBook(bookIndex); } }}
                      />
                      <Button type="button" size="sm" onClick={() => handleAddCategoryToBook(bookIndex)}>Add</Button>
                    </div>
                </CardContent>
              </Card>
            ))}
            <Button type="button" variant="outline" onClick={() => appendExpenseBook({ id: `book-${Date.now()}`, name: 'New Expense Book', type: 'spent', categories: [] })}>
              <Plus className="mr-2 h-4 w-4"/> Add Expense Book
            </Button>
          </CardContent>
        </Card>

        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2"><Wrench/> Customer Service Settings</CardTitle>
                <CardDescription>Manage customer-facing services (e.g., product sales). These will appear in the customer portal.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                {productServices.map((service, index) => (
                    <Card key={service.id || index} className="p-4 relative">
                        <div className="flex justify-between items-start">
                           <div>
                             <h4 className="font-semibold">{service.name}</h4>
                             <p className="text-sm text-muted-foreground">{service.description}</p>
                           </div>
                           <div className="flex items-center gap-1">
                                <Button type="button" size="sm" variant="outline" onClick={() => handleEditService(service, 'product')}>Edit</Button>
                                <Button type="button" variant="destructive" size="sm" onClick={() => removeService(serviceFields.findIndex(s => s.id === service.id))}><Trash2 className="h-4 w-4" /></Button>
                           </div>
                        </div>
                    </Card>
                ))}
                 <Button type="button" variant="outline" onClick={() => { setEditingService(null); setEditingServiceType('product'); setIsServiceFormOpen(true); }}>
                    <Plus className="mr-2 h-4 w-4" /> Add New Product/Sale Service
                </Button>
            </CardContent>
        </Card>
        
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2"><CreditCard/> Customer Payment Service</CardTitle>
                <CardDescription>Manage services for receiving or giving money to customers.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                {paymentServices.map((service, index) => (
                    <Card key={service.id || index} className="p-4 relative">
                        <div className="flex justify-between items-start">
                           <div>
                             <h4 className="font-semibold">{service.name}</h4>
                             <p className="text-sm text-muted-foreground">{service.description}</p>
                           </div>
                           <div className="flex items-center gap-1">
                                <Button type="button" size="sm" variant="outline" onClick={() => handleEditService(service, 'payment')}>Edit</Button>
                                <Button type="button" variant="destructive" size="sm" onClick={() => removeService(serviceFields.findIndex(s => s.id === service.id))}><Trash2 className="h-4 w-4" /></Button>
                           </div>
                        </div>
                    </Card>
                ))}
                 <Button type="button" variant="outline" onClick={() => { setEditingService(null); setEditingServiceType('payment'); setIsServiceFormOpen(true); }}>
                    <Plus className="mr-2 h-4 w-4" /> Add New Payment Service
                </Button>
            </CardContent>
        </Card>

        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2"><Bot/> Auto Transaction Rules</CardTitle>
                <CardDescription>Automate transaction creation from SMS sync based on these rules.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                {autoTxFields.map((field, index) => (
                    <Card key={field.id} className="p-4 relative bg-muted/50">
                        <Button type="button" variant="destructive" size="icon" className="absolute top-2 right-2 h-7 w-7" onClick={() => removeAutoTx(index)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-1">
                                <Label>Rule Name</Label>
                                <Input {...form.register(`autoTransactionRules.${index}.name`)} placeholder="e.g., Salary from XYZ" />
                            </div>
                            <div className="space-y-1">
                                <Label>Sender Identifier (from SMS)</Label>
                                <Input {...form.register(`autoTransactionRules.${index}.senderIdentifier`)} placeholder="e.g., BKASH" />
                            </div>
                        </div>
                        <div className="space-y-1 mt-2">
                          <Label>Keyword for Amount</Label>
                          <Input {...form.register(`autoTransactionRules.${index}.amountKeyword`)} placeholder="e.g., You have received payment Tk" />
                          <p className="text-xs text-muted-foreground">The system will find the first number after this phrase.</p>
                        </div>
                        <div className="space-y-1 mt-2">
                             <Label>Additional Message Filter (Optional)</Label>
                            <Input {...form.register(`autoTransactionRules.${index}.messageFilter`)} placeholder="e.g., must contain 'salary'" />
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
                             <div className="space-y-1">
                                <Label>Transaction Type</Label>
                                <Controller control={form.control} name={`autoTransactionRules.${index}.transactionType`} render={({field}) => (
                                    <Select onValueChange={field.onChange} value={field.value}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="income">Income</SelectItem>
                                            <SelectItem value="spent">Expense</SelectItem>
                                            <SelectItem value="receive">Receive</SelectItem>
                                            <SelectItem value="give">Give</SelectItem>
                                        </SelectContent>
                                    </Select>
                                )} />
                            </div>
                             <div className="space-y-1">
                                <Label>Deposit/Withdraw To/From Account</Label>
                                 <Controller control={form.control} name={`autoTransactionRules.${index}.accountId`} render={({field}) => (
                                    <Select onValueChange={field.onChange} value={field.value}>
                                        <SelectTrigger><SelectValue placeholder="Select account..."/></SelectTrigger>
                                        <SelectContent>{accounts.map(acc => <SelectItem key={acc.id} value={acc.id}>{acc.name}</SelectItem>)}</SelectContent>
                                    </Select>
                                )} />
                            </div>
                            <div className="space-y-1">
                                <Label>Associate with Party (Optional)</Label>
                                 <Controller control={form.control} name={`autoTransactionRules.${index}.partyId`} render={({field}) => (
                                    <PartyCombobox parties={parties} value={field.value} onChange={field.onChange} />
                                )} />
                            </div>
                             <div className="space-y-1">
                                <Label>Business Profile (Via)</Label>
                                <Controller control={form.control} name={`autoTransactionRules.${index}.via`} render={({ field }) => (
                                    <Select onValueChange={field.onChange} value={field.value || 'all'}>
                                        <SelectTrigger><SelectValue placeholder="All Profiles"/></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="all">All Profiles</SelectItem>
                                            {(appSettings?.businessProfiles || []).map(opt => <SelectItem key={opt.name} value={opt.name}>{opt.name}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                )} />
                            </div>
                        </div>
                        <div className="flex items-center space-x-2 pt-4">
                            <Controller control={form.control} name={`autoTransactionRules.${index}.enabled`} render={({field}) => (<Switch id={`rule-enabled-${index}`} checked={field.value} onCheckedChange={field.onChange} />)} />
                            <Label htmlFor={`rule-enabled-${index}`}>Enable this rule</Label>
                        </div>
                    </Card>
                ))}
                 <Button type="button" variant="outline" onClick={() => appendAutoTx({ id: `auto-${Date.now()}`, name: '', enabled: true, senderIdentifier: '', amountKeyword: '', transactionType: 'income', accountId: '' })}>
                    <Plus className="mr-2 h-4 w-4" /> Add New Rule
                </Button>
            </CardContent>
        </Card>


        <Card>
          <CardHeader>
            <CardTitle>Business Profiles</CardTitle>
            <CardDescription>Manage your business entities.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {profileFields.map((field, index) => (
              <div key={field.id} className="p-4 border rounded-lg relative space-y-3">
                 <Button type="button" variant="destructive" size="sm" onClick={() => removeProfile(index)} className="absolute -top-3 -right-3 h-7 w-7 p-0">
                  <Trash2 className="h-4 w-4" />
                </Button>
                <div className="flex flex-col sm:flex-row items-center gap-4">
                    <Avatar className="h-24 w-24 rounded-md">
                        <AvatarImage src={imagePreviews[index]} />
                        <AvatarFallback className="rounded-md"><ImageIcon className="h-10 w-10 text-muted-foreground"/></AvatarFallback>
                    </Avatar>
                    <div className="w-full space-y-2">
                        <Label>Business Logo</Label>
                        <Input type="file" accept="image/*" onChange={(e) => handleLogoFileChange(e, index)} />
                    </div>
                </div>
                <Input {...form.register(`businessProfiles.${index}.name`)} placeholder="Profile Name (e.g. Rushaib Traders)" className="font-bold" />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                   <div className="space-y-1">
                      <Label>Address</Label>
                      <Input {...form.register(`businessProfiles.${index}.address`)} placeholder="Address" />
                   </div>
                   <div className="space-y-1">
                      <Label>Phone</Label>
                      <Input {...form.register(`businessProfiles.${index}.phone`)} placeholder="Phone" />
                   </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="space-y-1">
                       <Label>Email</Label>
                       <Input {...form.register(`businessProfiles.${index}.email`)} placeholder="Email" />
                    </div>
                    <div className="space-y-1">
                        <Label>Default Location</Label>
                         <Controller
                            name={`businessProfiles.${index}.location`}
                            control={form.control}
                            render={({ field }) => (
                                <Select onValueChange={field.onChange} value={field.value || 'default'}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select location..." />
                                    </SelectTrigger>
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
                </div>
                 <div className="p-3 border rounded-md space-y-2 bg-muted/50">
                    <Label className="text-sm font-semibold">Payment Instruction</Label>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <Input {...form.register(`businessProfiles.${index}.paymentInstruction.method`)} placeholder="Method (e.g., bKash)" />
                        <Input {...form.register(`businessProfiles.${index}.paymentInstruction.number`)} placeholder="Number" />
                        <Input {...form.register(`businessProfiles.${index}.paymentInstruction.type`)} placeholder="Type (e.g., Send Money)" />
                    </div>
                 </div>
              </div>
            ))}
            <Button type="button" variant="outline" onClick={() => appendProfile({ name: '', address: '', phone: '', email: '' })}>
              <Plus className="mr-2 h-4 w-4" /> Add Profile
            </Button>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <Card>
                <CardHeader>
                    <CardTitle>Party Types</CardTitle>
                    <CardDescription>Manage the types of parties you interact with.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                    {typeFields.map((field, index) => (
                        <div key={field.id} className="flex items-center gap-2">
                            <Input {...form.register(`partyTypes.${index}.value`)} />
                            <Button type="button" variant="ghost" size="icon" onClick={() => removeType(index)}><Trash2 className="h-4 w-4 text-destructive"/></Button>
                        </div>
                    ))}
                    <div className="flex items-center gap-2 pt-2">
                        <Input value={newPartyType} onChange={(e) => setNewPartyType(e.target.value)} placeholder="e.g. Retailer" />
                        <Button type="button" onClick={handleAddNewPartyType}><Plus className="h-4 w-4"/></Button>
                    </div>
                </CardContent>
            </Card>
             <Card>
                <CardHeader>
                    <CardTitle>Party Groups</CardTitle>
                    <CardDescription>Manage the groups for categorizing parties.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                    {groupFields.map((field, index) => (
                        <div key={field.id} className="flex items-center gap-2">
                            <Input {...form.register(`partyGroups.${index}.value`)} />
                            <Button type="button" variant="ghost" size="icon" onClick={() => removeGroup(index)}><Trash2 className="h-4 w-4 text-destructive"/></Button>
                        </div>
                    ))}
                     <div className="flex items-center gap-2 pt-2">
                        <Input value={newPartyGroup} onChange={(e) => setNewPartyGroup(e.target.value)} placeholder="e.g. Corporate" />
                        <Button type="button" onClick={handleAddNewPartyGroup}><Plus className="h-4 w-4"/></Button>
                    </div>
                </CardContent>
            </Card>
            <Card>
                <CardHeader>
                    <CardTitle>Warehouse Locations</CardTitle>
                    <CardDescription>Manage your inventory storage locations.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                    {(form.watch('inventoryLocations') || []).map((_, index) => (
                        <div key={index} className="flex items-center gap-2">
                            <Input {...form.register(`inventoryLocations.${index}.value`)} />
                            <Button type="button" variant="ghost" size="icon" onClick={() => removeLocation(index)}><Trash2 className="h-4 w-4 text-destructive"/></Button>
                        </div>
                    ))}
                     <div className="flex items-center gap-2 pt-2">
                        <Input value={newLocation} onChange={(e) => setNewLocation(e.target.value)} placeholder="e.g. Main Godown" />
                        <Button type="button" onClick={handleAddNewLocation}><Plus className="h-4 w-4"/></Button>
                    </div>
                </CardContent>
            </Card>
        </div>
        
        <div className="flex justify-end">
            <Button type="submit" size="lg" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Save className="mr-2 h-4 w-4"/>}
                Save All Settings
            </Button>
        </div>
      </form>

      <Card className="mt-8 border-orange-500/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Database/> Data Management</CardTitle>
            <CardDescription>Use these tools for data maintenance. Use with caution.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
              <div className="space-y-2">
                  <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="outline" disabled={isRecalculating}>
                            {isRecalculating ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <RefreshCcw className="mr-2 h-4 w-4"/>}
                            Recalculate & Sync Balances
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                          <AlertDialogHeader>
                              <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                              <AlertDialogDescription>
                                  This action will iterate through all of your transactions and recalculate the current balance for every account. This is useful if you find a balance discrepancy, but it can be a slow operation if you have thousands of transactions.
                              </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={handleRecalculate}
                                className={cn(buttonVariants({ variant: "destructive" }))}
                              >
                                Yes, Recalculate
                              </AlertDialogAction>
                          </AlertDialogFooter>
                      </AlertDialogContent>
                  </AlertDialog>
                  <p className="text-xs text-muted-foreground mt-2">
                    If an account balance seems incorrect, this will fix it by re-calculating
                    it from all of your transaction history.
                  </p>
              </div>
          </CardContent>
      </Card>
    </div>
  );
}