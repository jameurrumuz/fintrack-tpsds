
import { db } from '@/lib/firebase';
import type { SmsSettings, AppSettings, CustomerService, SmsSyncLog, InventoryCategory, ExpenseBook, ExpenseCategory, SalesTarget, SheetRow, SmsBlocklistRule, TradeLicenceField, SmsPackage, MemberCategoryConfig, PageSecurity, NewsCategory, SmsTemplate } from '@/types';
import { doc, getDoc, setDoc, collection, getDocs, updateDoc, arrayUnion, onSnapshot, runTransaction, arrayRemove } from 'firebase/firestore';
import { cleanUndefined } from '@/lib/utils';

const settingsCollectionName = 'settings';
const mainAppSettingsDocName = 'main';

export async function saveAppSettings(settings: Partial<AppSettings>): Promise<void> {
  if (!db) throw new Error('Firebase is not configured.');
  const settingsDocRef = doc(db, settingsCollectionName, mainAppSettingsDocName);
  const cleanSettings = cleanUndefined(settings);
  await setDoc(settingsDocRef, cleanSettings, { merge: true });
}

export function subscribeToAppSettings(
  onUpdate: (settings: AppSettings | null) => void,
  onError: (error: Error) => void
) {
  if (!db) {
    onError(new Error('Firebase not configured.'));
    return () => {};
  }
  const settingsDocRef = doc(db, settingsCollectionName, mainAppSettingsDocName);
  
  const unsubscribe = onSnapshot(settingsDocRef, (settingsSnap) => {
    if (settingsSnap.exists()) {
      onUpdate(settingsSnap.data() as AppSettings);
    } else {
      onUpdate(null);
    }
  }, onError);

  return unsubscribe;
}

export async function getAppSettings(): Promise<AppSettings | null> {
  if (!db) throw new Error('Firebase is not configured.');
  
  const settingsDocRef = doc(db, settingsCollectionName, mainAppSettingsDocName);
  const categoriesColRef = collection(db, 'inventoryCategories');
  const newsCategoriesColRef = collection(db, 'newsCategories');

  try {
    const [settingsSnap, categoriesSnap, newsCategoriesSnap] = await Promise.all([
      getDoc(settingsDocRef),
      getDocs(categoriesColRef),
      getDocs(newsCategoriesColRef),
    ]);

    const categories: InventoryCategory[] = categoriesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as InventoryCategory));
    const newsCategories: NewsCategory[] = newsCategoriesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as NewsCategory));
    
    const defaults: AppSettings = {
        businessProfiles: [{ name: 'Personal' }],
        partyTypes: ['Customer', 'Supplier', 'Friend', 'Family', 'Retailer', 'Others'],
        partyGroups: [],
        fontSize: 16,
        customerServices: [],
        autoTransactionRules: [],
        lastSyncResult: null,
        smsServiceEnabled: true,
        inventoryCategories: categories,
        newsCategories: newsCategories.length > 0 ? newsCategories : [],
        adminLockedPages: [],
        userLockedPages: [],
        pageSecurity: {},
        autoLockTimeout: 0,
        salesTargets: [],
        smsBlocklist: [],
        doneSms: [],
        projectionReceivablePartyIds: [],
        projectionPayablePartyIds: [],
        smsTemplates: [],
        smsPackages: [],
        smsAlertSettings: {
            lowBalanceThreshold: 500,
            expiryWarningDays: 7,
        },
        memberCategoryConfig: [
            { id: 'General', name: 'General', profitPercentage: 0, joiningFee: 0, subscriptionDays: 365 },
            { id: 'VIP', name: 'VIP', profitPercentage: 0, joiningFee: 0, subscriptionDays: 365 },
            { id: 'Founder', name: 'Founder', profitPercentage: 0, joiningFee: 0, subscriptionDays: 365 * 10 },
            { id: 'Monthly', name: 'Monthly', profitPercentage: 0, joiningFee: 0, subscriptionDays: 30 },
            { id: 'Yearly', name: 'Yearly', profitPercentage: 0, joiningFee: 0, subscriptionDays: 365 },
            { id: '5 Year', name: '5 Year', profitPercentage: 0, joiningFee: 0, subscriptionDays: 365 * 5 },
            { id: 'Lifetime', name: 'Lifetime', profitPercentage: 0, joiningFee: 0, subscriptionDays: 365 * 99 },
            { id: 'Bronze', name: 'Bronze', profitPercentage: 0, joiningFee: 0, subscriptionDays: 365 },
            { id: 'Silver', name: 'Silver', profitPercentage: 0, joiningFee: 0, subscriptionDays: 365 },
            { id: 'Titanium', name: 'Titanium', profitPercentage: 0, joiningFee: 0, subscriptionDays: 365 },
            { id: 'Gold', name: 'Gold', profitPercentage: 0, joiningFee: 0, subscriptionDays: 365 },
            { id: 'Platinum', name: 'Platinum', profitPercentage: 0, joiningFee: 0, subscriptionDays: 365 },
            { id: 'Diamond', name: 'Diamond', profitPercentage: 0, joiningFee: 0, subscriptionDays: 365 },
        ],
    };

    if (settingsSnap.exists()) {
      const data = settingsSnap.data() as AppSettings;
      return { 
        ...defaults,
        ...data,
        inventoryCategories: categories,
        newsCategories: data.newsCategories?.length ? data.newsCategories : defaults.newsCategories,
        autoTransactionRules: data.autoTransactionRules || [],
        businessProfiles: data.businessProfiles?.length ? data.businessProfiles : defaults.businessProfiles,
        partyTypes: data.partyTypes?.length ? data.partyTypes : defaults.partyTypes,
        partyGroups: data.partyGroups || [],
        adminLockedPages: data.adminLockedPages || [],
        userLockedPages: data.userLockedPages || [],
        pageSecurity: data.pageSecurity || {},
        smsBlocklist: data.smsBlocklist || [],
        doneSms: data.doneSms || [],
        projectionReceivablePartyIds: data.projectionReceivablePartyIds || [],
        projectionPayablePartyIds: data.projectionPayablePartyIds || [],
        smsTemplates: Array.isArray(data.smsTemplates) ? data.smsTemplates : [],
        smsPackages: data.smsPackages || [],
        smsAlertSettings: data.smsAlertSettings || defaults.smsAlertSettings,
        memberCategoryConfig: data.memberCategoryConfig || defaults.memberCategoryConfig,
      };
    }
    
    return defaults;

  } catch (error) {
      console.error("Failed to fetch app settings:", error);
      return null;
  }
}

export async function addExpenseCategoryToBook(bookId: string, categoryName: string): Promise<void> {
  if (!db) throw new Error('Firebase is not configured.');
  const settings = await getAppSettings();
  if (!settings || !settings.expenseBooks) throw new Error('Expense books not found.');

  const bookIndex = settings.expenseBooks.findIndex(book => book.id === bookId);
  if (bookIndex === -1) throw new Error('Specified expense book not found.');

  const newCategory: ExpenseCategory = {
    id: `cat-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    name: categoryName,
  };

  settings.expenseBooks[bookIndex].categories.push(newCategory);
  await saveAppSettings(settings);
}

export async function addSmsToDoneList(sms: SheetRow): Promise<void> {
  if (!db) throw new Error('Firebase is not configured.');
  const settingsDocRef = doc(db, settingsCollectionName, mainAppSettingsDocName);
  
  await runTransaction(db, async (transaction) => {
    const settingsDoc = await transaction.get(settingsDocRef);
    const existingDoneSms: SheetRow[] = settingsDoc.exists() ? settingsDoc.data().doneSms || [] : [];
    const isDuplicate = existingDoneSms.some((s: SheetRow) => s.date === sms.date && s.message === sms.message);
    
    if (!isDuplicate) {
      const newDoneSms = [sms, ...existingDoneSms];
      if (settingsDoc.exists()) {
        transaction.update(settingsDocRef, { doneSms: newDoneSms });
      } else {
        transaction.set(settingsDocRef, { doneSms: newDoneSms });
      }
    }
  });
}

export async function removeSmsFromDoneList(smsToRemove: SheetRow): Promise<void> {
    if (!db) throw new Error('Firebase is not configured.');
    const settingsDocRef = doc(db, settingsCollectionName, mainAppSettingsDocName);
    await runTransaction(db, async (transaction) => {
        const settingsDoc = await transaction.get(settingsDocRef);
        if (!settingsDoc.exists()) return;
        const existingDoneSms: SheetRow[] = settingsDoc.data().doneSms || [];
        const newDoneSms = existingDoneSms.filter(s => s.date !== smsToRemove.date || s.message !== smsToRemove.message);
        transaction.update(settingsDocRef, { doneSms: newDoneSms });
    });
}

export async function addSmsBlockRule(rule: Omit<SmsBlocklistRule, 'id'>): Promise<void> {
    if (!db) throw new Error('Firebase is not configured.');
    const settingsDocRef = doc(db, settingsCollectionName, mainAppSettingsDocName);
    const newRule = { ...rule, id: `block-${Date.now()}`};
    await updateDoc(settingsDocRef, { smsBlocklist: arrayUnion(newRule) });
}

export async function removeSmsBlockRule(ruleId: string): Promise<void> {
    if (!db) throw new Error('Firebase is not configured.');
    const settingsDocRef = doc(db, settingsCollectionName, mainAppSettingsDocName);
    await runTransaction(db, async (transaction) => {
        const settingsDoc = await transaction.get(settingsDocRef);
        if (!settingsDoc.exists()) return;
        const existingRules: SmsBlocklistRule[] = settingsDoc.data().smsBlocklist || [];
        const newRules = existingRules.filter(rule => rule.id !== ruleId);
        transaction.update(settingsDocRef, { smsBlocklist: newRules });
    });
}
