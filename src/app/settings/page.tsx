'use client';

import React, { useState, useEffect, useMemo, Suspense } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { getAppSettings, saveAppSettings } from '@/services/settingsService';
import { recalculateBalancesFromTransaction } from '@/services/transactionService';
import type { AppSettings, BusinessProfile, ColorTheme, CustomerService, InventoryItem, Party, PaymentInstruction, Account, DepositChannel, AutoTransactionRule, ExpenseBook, ExpenseCategory, ChargeRule, SmsBlocklistRule, SmsTemplate, MemberCategoryConfig } from '@/types';
import { Loader2, Plus, Trash2, Save, Settings, Palette, Database, RefreshCcw, Wrench, ChevronsUpDown, Check, Edit, X, Bot, Smartphone, CreditCard, ImageIcon, Upload, Camera, BookOpen, ShieldQuestion, Clock, Lock, KeyRound, Store, MessageSquare } from 'lucide-react';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableFooter,
} from "@/components/ui/table";

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
  price: z.coerce.number().min(0).optional(),
  amountType: z.enum(['fixed', 'any']).optional(),
  depositChannels: z.array(depositChannelSchema).optional(),
  productId: z.string().optional(),
  productName: z.string().optional(),
  quantity: z.coerce.number().min(1).optional(),
  usageLimit: z.coerce.number().min(0).optional(),
  type: z.enum(['income', 'sale', 'receive', 'give']),
  enabled: z.boolean(),
  isUnlimited: z.boolean().optional(),
  verifiableBy: z.array(z.string()).optional(),
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
  type: z.string(),
  message: z.string().min(1, 'Template message cannot be empty.'),
});

const memberCategoryConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  joiningFee: z.coerce.number(),
  profitPercentage: z.coerce.number(),
  subscriptionDays: z.coerce.number(),
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
  memberCategoryConfig: z.array(memberCategoryConfigSchema).optional(),
  securityQuestion: z.string().optional(),
  securityAnswer: z.string().optional(),
  autoLockTimeout: z.coerce.number().optional(),
  twilioAccountSid: z.string().optional(),
  twilioAuthToken: z.string().optional(),
  twilioMessagingServiceSid: z.string().optional(),
  smsqApiKey: z.string().optional(),
  smsqClientId: z.string().optional(),
  smsqSenderId: z.string().optional(),
  pushbulletAccessToken: z.string().optional(),
  pushbulletDeviceId: z.string().optional(),
});

type AppSettingsFormValues = z.infer<typeof appSettingsSchema>;

export default function SettingsPage() {
  const [loading, setLoading] = useState(true);
  const [isRecalculating, setIsRecalculating] = useState(false);
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [parties, setParties] = useState<Party[]>([]);
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);
  const [imageFiles, setImageFiles] = useState<Record<number, File | null>>({});
  const [imagePreviews, setImagePreviews] = useState<Record<number, string>>({});
  const [isServiceFormOpen, setIsServiceFormOpen] = useState(false);
  const [editingService, setEditingService] = useState<CustomerService | null>(null);
  const { toast } = useToast();

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
      smsTemplates: [],
      memberCategoryConfig: [],
    },
  });
  
  const { fields: profileFields, append: appendProfile, remove: removeProfile } = useFieldArray({ control: form.control, name: "businessProfiles" });
  const { fields: typeFields, append: appendType, remove: removeType } = useFieldArray({ control: form.control, name: "partyTypes" });
  const { fields: groupFields, append: appendGroup, remove: removeGroup } = useFieldArray({ control: form.control, name: "partyGroups" });
  const { fields: locationFields, append: appendLocation, remove: removeLocation } = useFieldArray({ control: form.control, name: "inventoryLocations" });
  const { fields: templateFields, append: appendTemplate, remove: removeTemplate } = useFieldArray({ control: form.control, name: "smsTemplates" });
  const { fields: memberCatFields, append: appendMemberCat, remove: removeMemberCat } = useFieldArray({ control: form.control, name: "memberCategoryConfig" });

  useEffect(() => {
    async function loadSettings() {
      setLoading(true);
      const settings = await getAppSettings();
      if (settings) {
        setAppSettings(settings);
        form.reset({
          ...settings,
          partyTypes: (settings.partyTypes || []).map(t => ({value: t})),
          partyGroups: (settings.partyGroups || []).map(g => ({value: g})),
          inventoryLocations: (settings.inventoryLocations || []).map(l => ({value: l})),
          smsTemplates: settings.smsTemplates || [],
          memberCategoryConfig: settings.memberCategoryConfig || [],
        });
        const previews: Record<number, string> = {};
        (settings.businessProfiles || []).forEach((p, i) => { if (p.logoUrl) previews[i] = p.logoUrl; });
        setImagePreviews(previews);
      }
      subscribeToInventoryItems(setInventoryItems, console.error);
      subscribeToParties(setParties, console.error);
      subscribeToAccounts(setAccounts, console.error);
      setLoading(false);
    }
    loadSettings();
  }, [form]);

  const handleSettingsSubmit = async (data: AppSettingsFormValues) => {
    try {
        const updatedProfiles = await Promise.all((data.businessProfiles || []).map(async (profile, index) => {
            const file = imageFiles[index];
            if (file) {
                const logoUrl = await uploadImage(file, `business-logos/${profile.name.replace(/\s+/g, '-')}`);
                return { ...profile, logoUrl };
            }
            return profile;
        }));

        const finalSettings: AppSettings = {
            ...appSettings,
            ...data,
            businessProfiles: updatedProfiles,
            partyTypes: data.partyTypes.map(t => t.value),
            partyGroups: data.partyGroups.map(g => g.value),
            inventoryLocations: (data.inventoryLocations || []).map(l => l.value),
        };
        
        await saveAppSettings(cleanUndefined(finalSettings));
        toast({ title: 'Success', description: 'Settings saved.' });
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Error', description: error.message });
    }
  };

  if (loading) return <div className="flex items-center justify-center h-screen"><Loader2 className="animate-spin" /></div>;

  return (
    <div className="space-y-8 pb-20">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold flex items-center gap-2"><Settings/> Settings</h1>
        <Button onClick={form.handleSubmit(handleSettingsSubmit)}><Save className="mr-2 h-4 w-4"/>Save All</Button>
      </div>

      <form className="space-y-8">
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Store/> Business Profiles</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {profileFields.map((field, index) => (
              <div key={field.id} className="p-4 border rounded-lg relative space-y-3 bg-muted/20">
                <Button type="button" variant="destructive" size="icon" className="absolute top-2 right-2" onClick={() => removeProfile(index)}><Trash2 className="h-4 w-4"/></Button>
                <div className="flex items-center gap-4">
                    <Avatar className="h-16 w-16 rounded-md border"><AvatarImage src={imagePreviews[index]}/><AvatarFallback><ImageIcon/></AvatarFallback></Avatar>
                    <Input type="file" accept="image/*" onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                            setImageFiles(prev => ({...prev, [index]: file}));
                            setImagePreviews(prev => ({...prev, [index]: URL.createObjectURL(file)}));
                        }
                    }} />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1"><Label>Name</Label><Input {...form.register(`businessProfiles.${index}.name`)} /></div>
                    <div className="space-y-1"><Label>Address</Label><Input {...form.register(`businessProfiles.${index}.address`)} /></div>
                </div>
                <div className="p-3 border rounded-md bg-white dark:bg-black space-y-2">
                    <Label className="text-xs font-bold uppercase">Payment Instructions</Label>
                    <div className="grid grid-cols-3 gap-2">
                        <Input {...form.register(`businessProfiles.${index}.paymentInstruction.method`)} placeholder="Method" />
                        <Input {...form.register(`businessProfiles.${index}.paymentInstruction.number`)} placeholder="Number" />
                        <Input {...form.register(`businessProfiles.${index}.paymentInstruction.type`)} placeholder="Type" />
                    </div>
                </div>
              </div>
            ))}
            <Button type="button" variant="outline" onClick={() => appendProfile({ name: '', address: '', phone: '', email: '' })}><Plus className="mr-2 h-4 w-4"/>Add Profile</Button>
          </CardContent>
        </Card>

        <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Smartphone/> SMS Provider Config</CardTitle></CardHeader>
            <CardContent className="space-y-6">
                <div className="p-4 border rounded-lg space-y-3">
                    <h3 className="font-bold">Twilio</h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <Input {...form.register('twilioAccountSid')} placeholder="Account SID" />
                        <Input {...form.register('twilioAuthToken')} type="password" placeholder="Auth Token" />
                        <Input {...form.register('twilioMessagingServiceSid')} placeholder="Messaging SID" />
                    </div>
                </div>
                <div className="p-4 border rounded-lg space-y-3">
                    <h3 className="font-bold">Pushbullet</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <Input {...form.register('pushbulletAccessToken')} type="password" placeholder="Access Token" />
                        <Input {...form.register('pushbulletDeviceId')} placeholder="Device ID" />
                    </div>
                </div>
                <div className="p-4 border rounded-lg space-y-3">
                    <h3 className="font-bold">SMSQ</h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <Input {...form.register('smsqApiKey')} placeholder="API Key" />
                        <Input {...form.register('smsqClientId')} placeholder="Client ID" />
                        <Input {...form.register('smsqSenderId')} placeholder="Sender ID" />
                    </div>
                </div>
            </CardContent>
        </Card>

        <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><MessageSquare/> SMS টেমপ্লেটসমূহ</CardTitle></CardHeader>
            <CardContent className="space-y-4">
                {templateFields.map((field, index) => (
                    <div key={field.id} className="p-4 border rounded-lg space-y-2 bg-muted/10">
                        <div className="flex justify-between items-center">
                            <Badge variant="secondary">{form.watch(`smsTemplates.${index}.type`)}</Badge>
                            <Button type="button" variant="ghost" size="icon" onClick={() => removeTemplate(index)}><Trash2 className="h-4 w-4 text-red-500"/></Button>
                        </div>
                        <Textarea {...form.register(`smsTemplates.${index}.message`)} rows={3} />
                    </div>
                ))}
                <Button type="button" variant="outline" onClick={() => appendTemplate({ id: Date.now().toString(), type: 'cashSale', message: '' })}><Plus className="mr-2 h-4 w-4"/>Add Template</Button>
            </CardContent>
        </Card>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
                <CardHeader><CardTitle>Party & Location Types</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-2">
                        <Label>Party Types</Label>
                        {typeFields.map((f, i) => (
                            <div key={f.id} className="flex gap-2"><Input {...form.register(`partyTypes.${i}.value`)}/><Button type="button" variant="ghost" onClick={() => removeType(i)}><X/></Button></div>
                        ))}
                        <Button type="button" size="sm" variant="ghost" onClick={() => appendType({value: ''})}>+ Add Type</Button>
                    </div>
                    <div className="space-y-2">
                        <Label>Locations</Label>
                        {locationFields.map((f, i) => (
                            <div key={f.id} className="flex gap-2"><Input {...form.register(`inventoryLocations.${i}.value`)}/><Button type="button" variant="ghost" onClick={() => removeLocation(i)}><X/></Button></div>
                        ))}
                        <Button type="button" size="sm" variant="ghost" onClick={() => appendLocation({value: ''})}>+ Add Location</Button>
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader><CardTitle>Security & Auto-Lock</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-1">
                        <Label>Lock Timeout (Minutes)</Label>
                        <Input type="number" {...form.register('autoLockTimeout')} />
                    </div>
                    <div className="space-y-1">
                        <Label>Security Question</Label>
                        <Input {...form.register('securityQuestion')} />
                    </div>
                    <div className="space-y-1">
                        <Label>Security Answer</Label>
                        <Input {...form.register('securityAnswer')} />
                    </div>
                </CardContent>
            </Card>
        </div>

        <Card>
            <CardHeader><CardTitle>Elite Club Category Config</CardTitle></CardHeader>
            <CardContent>
                <Table>
                    <TableHeader><TableRow><TableHead>Category</TableHead><TableHead>Joining Fee</TableHead><TableHead>Profit %</TableHead><TableHead>Days</TableHead></TableRow></TableHeader>
                    <TableBody>
                        {memberCatFields.map((f, i) => (
                            <TableRow key={f.id}>
                                <TableCell><Input {...form.register(`memberCategoryConfig.${i}.name`)}/></TableCell>
                                <TableCell><Input type="number" {...form.register(`memberCategoryConfig.${i}.joiningFee`)}/></TableCell>
                                <TableCell><Input type="number" {...form.register(`memberCategoryConfig.${i}.profitPercentage`)}/></TableCell>
                                <TableCell><Input type="number" {...form.register(`memberCategoryConfig.${i}.subscriptionDays`)}/></TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </CardContent>
        </Card>
      </form>
    </div>
  );
}
