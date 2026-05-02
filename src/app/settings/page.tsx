
'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { getAppSettings, saveAppSettings } from '@/services/settingsService';
import { recalculateBalancesFromTransaction } from '@/services/transactionService';
import type { AppSettings, BusinessProfile, ColorTheme, CustomerService, InventoryItem, Party, Account, ExpenseBook, ExpenseCategory, AutoTransactionRule, SmsTemplate } from '@/types';
import { Loader2, Plus, Trash2, Save, Settings, Palette, Database, RefreshCcw, Wrench, ChevronsUpDown, Check, Edit, X, Bot, Smartphone, CreditCard, ImageIcon, Upload, Camera, BookOpen, ShieldQuestion, Clock, Lock, KeyRound, Store, MessageSquare, QrCode } from 'lucide-react';
import { useFieldArray, useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Slider } from '@/components/ui/slider';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription as AlertDialogDescriptionComponent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { cn, cleanUndefined, formatAmount } from '@/lib/utils';
import { Switch } from '@/components/ui/switch';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { subscribeToParties } from '@/services/partyService';
import { subscribeToAccounts } from '@/services/accountService';
import { subscribeToInventoryItems } from '@/services/inventoryService';
import QrCodeCard from '@/components/QrCodeCard';
import { predefinedThemes } from '@/lib/themes';
import Link from 'next/link';

const paymentInstructionSchema = z.object({
  method: z.string().default(''),
  number: z.string().default(''),
  type: z.string().default(''),
});

const businessProfileSchema = z.object({
  name: z.string().min(1, 'Profile name is required'),
  address: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  logoUrl: z.string().optional(),
  location: z.string().optional(),
  paymentInstruction: paymentInstructionSchema.optional(),
});

const appSettingsSchema = z.object({
  businessProfiles: z.array(businessProfileSchema),
  partyTypes: z.array(z.object({ value: z.string() })),
  partyGroups: z.array(z.object({ value: z.string() })),
  inventoryLocations: z.array(z.object({ value: z.string() })),
  fontSize: z.number().min(12).max(20),
  securityQuestion: z.string().optional(),
  securityAnswer: z.string().optional(),
  autoLockTimeout: z.coerce.number().optional(),
  smsServiceEnabled: z.boolean().optional(),
  pushbulletAccessToken: z.string().optional(),
  pushbulletDeviceId: z.string().optional(),
  smsqApiKey: z.string().optional(),
  smsqClientId: z.string().optional(),
  smsqSenderId: z.string().optional(),
  twilioAccountSid: z.string().optional(),
  twilioAuthToken: z.string().optional(),
  twilioMessagingServiceSid: z.string().optional(),
});

type AppSettingsFormValues = z.infer<typeof appSettingsSchema>;

export default function SettingsPage() {
  const [loading, setLoading] = useState(true);
  const [isRecalculating, setIsRecalculating] = useState(false);
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [parties, setParties] = useState<Party[]>([]);
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
  const { toast } = useToast();

  const form = useForm<AppSettingsFormValues>({
    resolver: zodResolver(appSettingsSchema),
    defaultValues: {
      businessProfiles: [],
      partyTypes: [],
      partyGroups: [],
      inventoryLocations: [],
      fontSize: 16,
    }
  });

  const { fields: profileFields, append: appendProfile, remove: removeProfile } = useFieldArray({ control: form.control, name: "businessProfiles" });
  const { fields: typeFields, append: appendType, remove: removeType } = useFieldArray({ control: form.control, name: "partyTypes" });
  const { fields: groupFields, append: appendGroup, remove: removeGroup } = useFieldArray({ control: form.control, name: "partyGroups" });
  const { fields: locationFields, append: appendLocation, remove: removeLocation } = useFieldArray({ control: form.control, name: "inventoryLocations" });

  useEffect(() => {
    async function load() {
      const settings = await getAppSettings();
      if (settings) {
        setAppSettings(settings);
        form.reset({
          ...settings,
          partyTypes: (settings.partyTypes || []).map(t => ({ value: t })),
          partyGroups: (settings.partyGroups || []).map(g => ({ value: g })),
          inventoryLocations: (settings.inventoryLocations || []).map(l => ({ value: l })),
        });
      }
      subscribeToAccounts(setAccounts, console.error);
      subscribeToParties(setParties, console.error);
      subscribeToInventoryItems(setInventoryItems, console.error);
      setLoading(false);
    }
    load();
  }, [form]);

  const handleSaveAll = async (data: AppSettingsFormValues) => {
    try {
      const finalSettings: Partial<AppSettings> = {
        ...appSettings,
        ...data,
        partyTypes: data.partyTypes.map(t => t.value),
        partyGroups: data.partyGroups.map(g => g.value),
        inventoryLocations: data.inventoryLocations.map(l => l.value),
      };
      await saveAppSettings(finalSettings);
      toast({ title: "Success", description: "Settings saved successfully." });
    } catch (error: any) {
      toast({ variant: 'destructive', title: "Error", description: error.message });
    }
  };

  const handleRecalculate = async () => {
    setIsRecalculating(true);
    try {
      await recalculateBalancesFromTransaction();
      toast({ title: "Success", description: "All balances recalculated and synced." });
    } catch (error: any) {
      toast({ variant: 'destructive', title: "Failed", description: error.message });
    } finally {
      setIsRecalculating(false);
    }
  };

  if (loading) return <div className="flex h-screen items-center justify-center"><Loader2 className="animate-spin h-10 w-10 text-primary" /></div>;

  return (
    <div className="container mx-auto p-4 md:p-8 space-y-8 max-w-5xl">
      <header className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Application Settings</h1>
          <p className="text-muted-foreground">Manage central configurations for your application.</p>
        </div>
        <Button onClick={form.handleSubmit(handleSaveAll)} className="gap-2">
          <Save className="h-4 w-4" /> Save All Settings
        </Button>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Sidebar Nav Shortcuts */}
        <div className="md:col-span-1 space-y-4">
            <Card>
                <CardHeader><CardTitle className="text-lg">Portal Login QR Code</CardTitle></CardHeader>
                <CardContent className="flex justify-center">
                    <QrCodeCard 
                        title="Portal Access" 
                        description="Scan to login" 
                        url={`${typeof window !== 'undefined' ? window.location.origin : ''}/portal/login`} 
                    />
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2"><Clock className="h-5 w-5"/> Auto-Lock Settings</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-2">
                        <Label>Lock after inactivity for</Label>
                        <Controller
                            name="autoLockTimeout"
                            control={form.control}
                            render={({ field }) => (
                                <Select onValueChange={v => field.onChange(Number(v))} value={String(field.value || 0)}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="0">Never</SelectItem>
                                        <SelectItem value="1">1 Minute</SelectItem>
                                        <SelectItem value="5">5 Minutes</SelectItem>
                                        <SelectItem value="15">15 Minutes</SelectItem>
                                        <SelectItem value="30">30 Minutes</SelectItem>
                                        <SelectItem value="60">1 Hour</SelectItem>
                                    </SelectContent>
                                </Select>
                            )}
                        />
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2"><Lock className="h-5 w-5"/> Security Settings</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                    <Button variant="outline" className="w-full justify-start" asChild>
                        <Link href="/pin-login"><KeyRound className="mr-2 h-4 w-4"/> Change PIN</Link>
                    </Button>
                    <Button variant="outline" className="w-full justify-start" asChild>
                        <Link href="/settings/page-lock"><Settings className="mr-2 h-4 w-4"/> Manage Page Locks</Link>
                    </Button>
                    <Button variant="outline" className="w-full justify-start" asChild>
                        <Link href="/settings/shop-start-close"><Store className="mr-2 h-4 w-4"/> Shop Start & Close</Link>
                    </Button>
                    <div className="space-y-1 mt-4 pt-4 border-t">
                        <Label>Security Question</Label>
                        <Input {...form.register('securityQuestion')} placeholder="What's your secret question?" />
                    </div>
                    <div className="space-y-1">
                        <Label>Security Answer</Label>
                        <Input {...form.register('securityAnswer')} placeholder="Enter answer" />
                    </div>
                </CardContent>
            </Card>
        </div>

        {/* Main Content Area */}
        <div className="md:col-span-2 space-y-6">
            {/* SMS Config */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2"><Smartphone/> SMS Service Configuration</CardTitle>
                    <CardDescription>Configure how SMS messages are sent from your application.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    <div className="flex items-center space-x-2">
                        <Controller
                            name="smsServiceEnabled"
                            control={form.control}
                            render={({ field }) => (
                                <Switch checked={field.value} onCheckedChange={field.onChange} />
                            )}
                        />
                        <Label>Enable SMS Service</Label>
                    </div>

                    <div className="space-y-4 pt-4 border-t">
                        <h4 className="font-bold text-sm">Pushbullet Credentials (Priority 1)</h4>
                        <div className="grid grid-cols-1 gap-4">
                            <div className="space-y-1"><Label>Access Token</Label><Input type="password" {...form.register('pushbulletAccessToken')} /></div>
                            <div className="space-y-1"><Label>Device ID</Label><Input {...form.register('pushbulletDeviceId')} /></div>
                        </div>
                    </div>

                    <div className="space-y-4 pt-4 border-t">
                        <h4 className="font-bold text-sm">SMSQ Credentials (Priority 2)</h4>
                        <div className="grid grid-cols-1 gap-4">
                            <div className="space-y-1"><Label>API Key</Label><Input type="password" {...form.register('smsqApiKey')} /></div>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-1"><Label>Client ID</Label><Input {...form.register('smsqClientId')} /></div>
                                <div className="space-y-1"><Label>Sender ID</Label><Input {...form.register('smsqSenderId')} /></div>
                            </div>
                        </div>
                    </div>

                    <div className="space-y-4 pt-4 border-t">
                        <h4 className="font-bold text-sm">Twilio Credentials (Priority 3)</h4>
                        <div className="grid grid-cols-1 gap-4">
                            <div className="space-y-1"><Label>Account SID</Label><Input {...form.register('twilioAccountSid')} /></div>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-1"><Label>Auth Token</Label><Input type="password" {...form.register('twilioAuthToken')} /></div>
                                <div className="space-y-1"><Label>Messaging SID</Label><Input {...form.register('twilioMessagingServiceSid')} /></div>
                            </div>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Appearance */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2"><Palette/> Appearance Settings</CardTitle>
                    <CardDescription>Customize the look and feel of the application.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    <div className="space-y-4">
                        <Label>Font Size ({form.watch('fontSize')}px)</Label>
                        <Controller
                            name="fontSize"
                            control={form.control}
                            render={({ field }) => (
                                <Slider 
                                    value={[field.value || 16]} 
                                    min={12} 
                                    max={20} 
                                    step={1} 
                                    onValueChange={(v) => field.onChange(v[0])} 
                                />
                            )}
                        />
                    </div>
                    <div className="space-y-4">
                        <Label>Global Color Theme</Label>
                        <div className="grid grid-cols-3 gap-2">
                            {predefinedThemes.map(theme => (
                                <Button 
                                    key={theme.name} 
                                    variant="outline" 
                                    className="h-10 text-xs justify-start"
                                    onClick={() => {
                                        applyTheme(theme);
                                        localStorage.setItem('activeThemeColors', JSON.stringify(theme.colors));
                                    }}
                                >
                                    <div className="w-3 h-3 rounded-full mr-2" style={{ backgroundColor: `hsl(${theme.colors.primary.h} ${theme.colors.primary.s}% ${theme.colors.primary.l}%)` }} />
                                    {theme.name}
                                </Button>
                            ))}
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Business Profiles */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2"><Store/> Business Profiles</CardTitle>
                    <CardDescription>Manage your business entities.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    {profileFields.map((field, index) => (
                        <div key={field.id} className="p-4 border rounded-lg relative space-y-4 bg-muted/10">
                            <Button 
                                type="button" 
                                variant="ghost" 
                                size="icon" 
                                className="absolute top-2 right-2 text-destructive"
                                onClick={() => removeProfile(index)}
                            >
                                <Trash2 className="h-4 w-4"/>
                            </Button>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="space-y-1"><Label>Name</Label><Input {...form.register(`businessProfiles.${index}.name`)} /></div>
                                <div className="space-y-1"><Label>Phone</Label><Input {...form.register(`businessProfiles.${index}.phone`)} /></div>
                                <div className="space-y-1"><Label>Email</Label><Input {...form.register(`businessProfiles.${index}.email`)} /></div>
                                <div className="space-y-1"><Label>Address</Label><Input {...form.register(`businessProfiles.${index}.address`)} /></div>
                            </div>
                            <div className="p-3 border rounded bg-white dark:bg-black space-y-3">
                                <Label className="text-xs font-bold uppercase text-muted-foreground">Payment Instruction</Label>
                                <div className="grid grid-cols-3 gap-2">
                                    <Input {...form.register(`businessProfiles.${index}.paymentInstruction.method`)} placeholder="Method" />
                                    <Input {...form.register(`businessProfiles.${index}.paymentInstruction.number`)} placeholder="Number" />
                                    <Input {...form.register(`businessProfiles.${index}.paymentInstruction.type`)} placeholder="Type" />
                                </div>
                            </div>
                        </div>
                    ))}
                    <Button type="button" variant="outline" onClick={() => appendProfile({ name: '', address: '', phone: '', email: '', paymentInstruction: { method: '', number: '', type: '' } })}>
                        <Plus className="mr-2 h-4 w-4"/> Add Profile
                    </Button>
                </CardContent>
            </Card>

            {/* Taxonomies */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card>
                    <CardHeader className="p-4"><CardTitle className="text-sm">Party Types</CardTitle></CardHeader>
                    <CardContent className="p-4 pt-0 space-y-2">
                        {typeFields.map((f, i) => (
                            <div key={f.id} className="flex gap-1">
                                <Input {...form.register(`partyTypes.${i}.value`)} className="h-8 text-xs" />
                                <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => removeType(i)}><X className="h-3 w-3"/></Button>
                            </div>
                        ))}
                        <Button variant="ghost" size="sm" className="w-full text-xs" onClick={() => appendType({ value: '' })}>+ Add</Button>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="p-4"><CardTitle className="text-sm">Party Groups</CardTitle></CardHeader>
                    <CardContent className="p-4 pt-0 space-y-2">
                        {groupFields.map((f, i) => (
                            <div key={f.id} className="flex gap-1">
                                <Input {...form.register(`partyGroups.${i}.value`)} className="h-8 text-xs" />
                                <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => removeGroup(i)}><X className="h-3 w-3"/></Button>
                            </div>
                        ))}
                        <Button variant="ghost" size="sm" className="w-full text-xs" onClick={() => appendGroup({ value: '' })}>+ Add</Button>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="p-4"><CardTitle className="text-sm">Warehouse Locations</CardTitle></CardHeader>
                    <CardContent className="p-4 pt-0 space-y-2">
                        {locationFields.map((f, i) => (
                            <div key={f.id} className="flex gap-1">
                                <Input {...form.register(`inventoryLocations.${i}.value`)} className="h-8 text-xs" />
                                <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => removeLocation(i)}><X className="h-3 w-3"/></Button>
                            </div>
                        ))}
                        <Button variant="ghost" size="sm" className="w-full text-xs" onClick={() => appendLocation({ value: '' })}>+ Add</Button>
                    </CardContent>
                </Card>
            </div>

            {/* Data Management */}
            <Card className="border-primary/20 bg-primary/5">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2"><Database/> Data Management</CardTitle>
                    <CardDescription>Advanced tools to fix data inconsistencies and sync records.</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-4">
                    <Button onClick={handleRecalculate} disabled={isRecalculating} variant="default" className="bg-primary hover:bg-primary/90">
                        {isRecalculating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCcw className="mr-2 h-4 w-4" />}
                        Recalculate & Sync Balances
                    </Button>
                    <Button variant="outline" asChild>
                        <Link href="/toolkit">Open System Toolkit</Link>
                    </Button>
                </CardContent>
            </Card>
        </div>
      </div>
    </div>
  );
}
