'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Save, ShieldCheck, Plus, FileText, ScrollText } from 'lucide-react';
import { getRulesContent, appendRule, saveFullRules } from './actions';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export default function RulesPrivacyPage() {
  const [rules, setRules] = useState('');
  const [newRule, setNewRule] = useState('');
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const { toast } = useToast();

  const fetchRules = async () => {
    setLoading(true);
    const result = await getRulesContent();
    if (result.success) {
      setRules(result.content || '');
    } else {
      toast({ variant: 'destructive', title: 'Error', description: result.error });
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchRules();
  }, []);

  const handleAppendRule = async () => {
    if (!newRule.trim()) return;
    setIsSaving(true);
    const result = await appendRule(newRule);
    if (result.success) {
      toast({ title: 'সফল হয়েছে!', description: 'নতুন নিয়ম RULES.md ফাইলে যুক্ত করা হয়েছে।' });
      setNewRule('');
      fetchRules();
    } else {
      toast({ variant: 'destructive', title: 'ব্যর্থ হয়েছে', description: result.error });
    }
    setIsSaving(false);
  };

  const handleSaveFull = async () => {
    setIsSaving(true);
    const result = await saveFullRules(rules);
    if (result.success) {
      toast({ title: 'সফল হয়েছে!', description: 'RULES.md ফাইলটি আপডেট করা হয়েছে।' });
    } else {
      toast({ variant: 'destructive', title: 'ব্যর্থ হয়েছে', description: result.error });
    }
    setIsSaving(false);
  };

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-4xl py-8 space-y-6">
      <div className="flex items-center gap-3 mb-4">
        <ShieldCheck className="h-10 w-10 text-primary" />
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Rules & Privacy Policy</h1>
          <p className="text-muted-foreground">প্রোজেক্টের কোডিং নিয়মাবলী এবং প্রাইভেসি পলিসি ম্যানেজমেন্ট।</p>
        </div>
      </div>

      <Tabs defaultValue="view" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="view">
            <ScrollText className="mr-2 h-4 w-4" /> বর্তমান নিয়মাবলী
          </TabsTrigger>
          <TabsTrigger value="add">
            <Plus className="mr-2 h-4 w-4" /> নতুন নিয়ম যোগ করুন
          </TabsTrigger>
          <TabsTrigger value="edit">
            <FileText className="mr-2 h-4 w-4" /> পূর্ণাঙ্গ এডিট
          </TabsTrigger>
        </TabsList>

        {/* View Tab */}
        <TabsContent value="view">
          <Card>
            <CardHeader>
              <CardTitle>RULES.md কন্টেন্ট</CardTitle>
              <CardDescription>নিচে প্রোজেক্টের জন্য বর্তমানে সেট করা রুলসগুলো দেওয়া হলো।</CardDescription>
            </CardHeader>
            <CardContent>
              <pre className="p-4 bg-muted rounded-lg whitespace-pre-wrap font-mono text-sm border overflow-auto max-h-[60vh]">
                {rules}
              </pre>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Add New Rule Tab */}
        <TabsContent value="add">
          <Card>
            <CardHeader>
              <CardTitle>নতুন নিয়ম সংযোজন</CardTitle>
              <CardDescription>আপনি এখানে নতুন কোনো নিয়ম লিখলে তা স্বয়ংক্রিয়ভাবে RULES.md ফাইলের নিচে যুক্ত হবে।</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="new-rule">নিচের বক্সে আপনার নিয়মটি লিখুন</Label>
                <Textarea
                  id="new-rule"
                  placeholder="যেমন: সব নতুন পেজে মোবাইল রেসপনসিভনেস নিশ্চিত করতে হবে..."
                  value={newRule}
                  onChange={(e) => setNewRule(e.target.value)}
                  rows={5}
                />
              </div>
            </CardContent>
            <CardFooter>
              <Button onClick={handleAppendRule} disabled={isSaving || !newRule.trim()}>
                {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                নিয়ম যুক্ত করুন
              </Button>
            </CardFooter>
          </Card>
        </TabsContent>

        {/* Edit Full Content Tab */}
        <TabsContent value="edit">
          <Card>
            <CardHeader>
              <CardTitle>ফাইল এডিটর</CardTitle>
              <CardDescription>সতর্কতা: এখান থেকে পরিবর্তন করলে সরাসরি সম্পূর্ণ ফাইলটি ওভাররাইট হবে।</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="full-rules">RULES.md সম্পূর্ণ কন্টেন্ট</Label>
                <Textarea
                  id="full-rules"
                  value={rules}
                  onChange={(e) => setRules(e.target.value)}
                  rows={15}
                  className="font-mono text-sm"
                />
              </div>
            </CardContent>
            <CardFooter>
              <Button onClick={handleSaveFull} variant="destructive" disabled={isSaving}>
                {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                সম্পূর্ণ ফাইল সেভ করুন
              </Button>
            </CardFooter>
          </Card>
        </TabsContent>
      </Tabs>

      <Card className="bg-blue-50 border-blue-200 dark:bg-blue-900/20">
        <CardHeader>
          <CardTitle className="text-blue-800 dark:text-blue-200 text-lg">AI-কে নির্দেশ দেওয়ার নিয়ম</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-blue-700 dark:text-blue-300">
          <p>আমি (AI) যাতে এই রুলসগুলো ফলো করি, তার জন্য আমাকে এভাবে ইন্সট্রাকশন দিন:</p>
          <div className="mt-2 p-3 bg-white dark:bg-gray-800 rounded border border-blue-300 font-bold italic">
            "RULES.md ফাইলটি ফলো করে [আপনার কাজের বিবরণ] সম্পন্ন করো।"
          </div>
          <p className="mt-2 text-xs opacity-80">* এটি বললে আমি স্বয়ংক্রিয়ভাবে আপনার সব কাস্টম রুলস মেনে কোড লিখবো।</p>
        </CardContent>
      </Card>
    </div>
  );
}
