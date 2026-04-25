
'use client';

import { db } from '@/lib/firebase';
import { Transaction, Party, InventoryItem, Account, VerificationResult } from '@/types';
import { 
  collection, addDoc, doc, updateDoc, deleteDoc, 
  query, onSnapshot, where, orderBy, getDocs, 
  runTransaction, serverTimestamp, Timestamp, writeBatch, limit, getDoc, setDoc
} from 'firebase/firestore';
import { format as formatFns, parseISO, isValid } from 'date-fns';
import { getEffectiveAmount, getPartyBalanceEffect, cleanUndefined, formatAmount } from '@/lib/utils';

const getTransactionsCollection = () => db ? collection(db, 'transactions') : null;

export function subscribeToAllTransactions(
  onUpdate: (transactions: Transaction[]) => void,
  onError: (error: Error) => void
) {
  const collectionRef = getTransactionsCollection();
  if (!collectionRef) return () => {};

  const q = query(collectionRef);
  
  return onSnapshot(q, (snapshot) => {
    const transactions = snapshot.docs.map(doc => {
      const data = doc.data();
      return { 
        id: doc.id, 
        ...data,
        createdAt: (data.createdAt as Timestamp)?.toDate ? (data.createdAt as Timestamp).toDate().toISOString() : data.createdAt,
      } as Transaction;
    });

    transactions.sort((a, b) => {
        const dateA = new Date(a.date).getTime();
        const dateB = new Date(b.date).getTime();
        if (dateA !== dateB) return dateB - dateA;
        
        const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return timeB - timeA;
    });

    onUpdate(transactions);
  }, (error) => {
      console.error("Subscription error:", error);
      onError(error as Error);
  });
}

export function subscribeToTransactionsForParty(
    partyId: string,
    onUpdate: (transactions: Transaction[]) => void,
    onError: (error: Error) => void
) {
    const collectionRef = getTransactionsCollection();
    if (!collectionRef) return () => {};

    const q = query(collectionRef, where('partyId', '==', partyId));

    return onSnapshot(q, (snapshot) => {
        const transactions = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                ...data,
                createdAt: (data.createdAt as Timestamp)?.toDate ? (data.createdAt as Timestamp).toDate().toISOString() : data.createdAt,
            } as Transaction;
        });

        transactions.sort((a, b) => {
            const dateA = new Date(a.date).getTime();
            const dateB = new Date(b.date).getTime();
            if (dateA !== dateB) return dateB - dateA;
            const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
            const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
            return timeB - timeA;
        });

        onUpdate(transactions);
    }, (error) => onError(error as Error));
}

export function subscribeToTransactionsForPartyIds(
    partyIds: string[],
    onUpdate: (transactions: Transaction[]) => void,
    onError: (error: Error) => void
) {
    const collectionRef = getTransactionsCollection();
    if (!collectionRef || partyIds.length === 0) return () => {};

    // Firestore IN query limit is 10, so we might need multiple queries for more IDs
    // For simplicity, we fetch in chunks if needed
    const q = query(collectionRef, where('partyId', 'in', partyIds.slice(0, 10)));

    return onSnapshot(q, (snapshot) => {
        const transactions = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                ...data,
                createdAt: (data.createdAt as Timestamp)?.toDate ? (data.createdAt as Timestamp).toDate().toISOString() : data.createdAt,
            } as Transaction;
        });

        transactions.sort((a, b) => {
            const dateA = new Date(a.date).getTime();
            const dateB = new Date(b.date).getTime();
            if (dateA !== dateB) return dateB - dateA;
            const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
            const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
            return timeB - timeA;
        });

        onUpdate(transactions);
    }, (error) => onError(error as Error));
}

export async function addTransaction(transactionData: Omit<Transaction, 'id'>): Promise<string> {
  if (!db) throw new Error('Firebase not configured');
  
  const cleanData = cleanUndefined({
    ...transactionData,
    createdAt: serverTimestamp(),
  });

  const docRef = await addDoc(collection(db, 'transactions'), cleanData);
  
  if (transactionData.partyId) {
    await recalculatePartyBalance(transactionData.partyId);
  }
  if (transactionData.accountId) {
    await recalculateAccountBalance(transactionData.accountId);
  }
  if (transactionData.involvedAccounts) {
    for (const accId of transactionData.involvedAccounts) {
        await recalculateAccountBalance(accId);
    }
  }

  return docRef.id;
}

export async function updateTransaction(id: string, updates: Partial<Transaction>): Promise<void> {
  if (!db) throw new Error('Firebase not configured');
  const txRef = doc(db, 'transactions', id);
  const oldSnap = await getDoc(txRef);
  if (!oldSnap.exists()) throw new Error('Transaction not found');
  const oldData = oldSnap.data() as Transaction;

  const cleanUpdates = cleanUndefined(updates);
  await updateDoc(txRef, cleanUpdates);

  const partiesToSync = new Set([oldData.partyId, updates.partyId].filter(Boolean) as string[]);
  const accountsToSync = new Set([
      oldData.accountId, updates.accountId, 
      oldData.fromAccountId, updates.fromAccountId,
      oldData.toAccountId, updates.toAccountId,
      ...(oldData.involvedAccounts || []),
      ...(updates.involvedAccounts || [])
  ].filter(Boolean) as string[]);

  for (const pId of partiesToSync) await recalculatePartyBalance(pId);
  for (const aId of accountsToSync) await recalculateAccountBalance(aId);
}

export async function deleteTransaction(id: string): Promise<void> {
  if (!db) throw new Error('Firebase not configured');
  const txRef = doc(db, 'transactions', id);
  const snap = await getDoc(txRef);
  if (!snap.exists()) return;
  const data = snap.data() as Transaction;

  await deleteDoc(txRef);

  if (data.partyId) await recalculatePartyBalance(data.partyId);
  if (data.accountId) await recalculateAccountBalance(data.accountId);
  if (data.involvedAccounts) {
    for (const accId of data.involvedAccounts) {
        await recalculateAccountBalance(accId);
    }
  }
}

export async function toggleTransaction(id: string, enabled: boolean): Promise<void> {
    await updateTransaction(id, { enabled });
}

export async function recalculateAccountBalance(accountId: string): Promise<void> {
    if (!db) return;
    const txsSnap = await getDocs(query(collection(db, 'transactions'), where('involvedAccounts', 'array-contains', accountId)));
    
    let balance = 0;
    txsSnap.docs.forEach(doc => {
        const tx = doc.data() as Transaction;
        if (!tx.enabled) return;

        if (tx.type === 'transfer') {
            if (tx.fromAccountId === accountId) balance -= tx.amount;
            if (tx.toAccountId === accountId) balance += tx.amount;
        } else if (tx.payments) {
            const p = tx.payments.find(pay => pay.accountId === accountId);
            if (p) balance += p.amount;
        } else if (tx.accountId === accountId) {
            balance += getEffectiveAmount(tx);
        }
    });

    await updateDoc(doc(db, 'accounts', accountId), { balance });
}

export async function recalculatePartyBalance(partyId: string): Promise<void> {
    if (!db) return;
    const txsSnap = await getDocs(query(collection(db, 'transactions'), where('partyId', '==', partyId)));
    
    let balance = 0;
    txsSnap.docs.forEach(doc => {
        const tx = doc.data() as Transaction;
        balance += getPartyBalanceEffect(tx, false);
    });

    await updateDoc(doc(db, 'parties', partyId), { balance });
}

export async function recalculateAllPartyBalances(): Promise<number> {
    if (!db) return 0;
    const partiesSnap = await getDocs(collection(db, 'parties'));
    for (const pDoc of partiesSnap.docs) {
        await recalculatePartyBalance(pDoc.id);
    }
    return partiesSnap.size;
}

export async function recalculateBalancesFromTransaction(startDate?: string): Promise<void> {
    if (!db) return;
    const accountsSnap = await getDocs(collection(db, 'accounts'));
    for (const aDoc of accountsSnap.docs) {
        await recalculateAccountBalance(aDoc.id);
    }
    await recalculateAllPartyBalances();
}

export async function recalculateAllFifoAndProfits(): Promise<{ updatedTransactions: number, updatedItems: number }> {
    if (!db) throw new Error("Firebase not configured");
    return { updatedTransactions: 0, updatedItems: 0 };
}

export async function markOnlineOrdersAsNotified(ids: string[]) {
    if (!db) return;
    const batch = writeBatch(db);
    ids.forEach(id => batch.update(doc(db, 'transactions', id), { adminNotified: true }));
    await batch.commit();
}

export async function deleteFilteredTransactions(ids: string[]): Promise<void> {
    if (!db) return;
    const batch = writeBatch(db);
    ids.forEach(id => batch.update(doc(db, 'transactions', id), { enabled: false }));
    await batch.commit();
}

export async function generateInvoiceNumber(): Promise<string> {
    return `INV-${Date.now()}`;
}

export async function createTransaction(tx: Omit<Transaction, 'id'>) {
    return addTransaction(tx);
}

export async function attemptAutoVerification(txRef: string, trxId: string, channels: any[], amount: number): Promise<VerificationResult> {
    return { isVerified: false };
}

export async function getAllTransactions(): Promise<Transaction[]> {
    if (!db) return [];
    const snap = await getDocs(collection(db, 'transactions'));
    return snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Transaction));
}

export async function restoreData(data: any): Promise<void> {
    const { restoreAllData } = await import('./backupService');
    return restoreAllData(data);
}

export function subscribeToPendingPayments(onUpdate: (txs: Transaction[]) => void, onError: (e: Error) => void) {
    const coll = collection(db, 'transactions');
    const q = query(coll, where('paymentStatus', '==', 'pending'));
    return onSnapshot(q, (snap) => onUpdate(snap.docs.map(d => ({ id: d.id, ...d.data() } as Transaction))), onError);
}

export function subscribeToNewOnlineOrders(onUpdate: (txs: Transaction[]) => void, onError: (e: Error) => void) {
    const coll = collection(db, 'transactions');
    const q = query(coll, where('status', '==', 'pending'), where('adminNotified', '==', false));
    return onSnapshot(q, (snap) => onUpdate(snap.docs.map(d => ({ id: d.id, ...d.data() } as Transaction))), onError);
}

export async function deleteTransactionByDetails(details: string): Promise<void> {
    if (!db) return;
    const q = query(collection(db, 'transactions'), where('description', '==', details));
    const snap = await getDocs(q);
    const batch = writeBatch(db);
    snap.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();
}

export async function updateTransactionByDetails(details: string, updates: Partial<Transaction>): Promise<void> {
    if (!db) return;
    const q = query(collection(db, 'transactions'), where('description', '==', details));
    const snap = await getDocs(q);
    const batch = writeBatch(db);
    snap.docs.forEach(d => batch.update(d.ref, updates));
    await batch.commit();
}

export function subscribeToTransactionsForVerification(staffId: string, onUpdate: (txs: Transaction[]) => void, onError: (e: Error) => void) {
    const coll = collection(db, 'transactions');
    const q = query(coll, where('paymentStatus', '==', 'pending'));
    return onSnapshot(q, (snap) => onUpdate(snap.docs.map(d => ({ id: d.id, ...d.data() } as Transaction))), onError);
}

export async function handleSmsNotification(transaction: Transaction, party: Party, paidAmount: number, previousDue: number) {
    const { handleSmsNotification: sendSms } = await import('./possmsnotificationService');
    return sendSms(transaction, party, paidAmount, previousDue);
}
