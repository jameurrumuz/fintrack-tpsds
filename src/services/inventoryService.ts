'use client';

import { db } from '@/lib/firebase';
import type { InventoryItem, InventoryCategory, Transaction, InventoryMovement } from '@/types';
import { 
  collection, doc, getDocs, addDoc, updateDoc, 
  deleteDoc, query, where, orderBy, runTransaction,
  serverTimestamp, onSnapshot, Timestamp, writeBatch, getDoc
} from 'firebase/firestore';

const getInventoryCollection = () => {
    if (!db) return null;
    return collection(db, 'inventory');
}
const getInventoryCategoriesCollection = () => {
    if (!db) return null;
    return collection(db, 'inventoryCategories');
}
const getInventoryMovementsCollection = () => {
    if (!db) return null;
    return collection(db, 'inventoryMovements');
}
const getTransactionsCollection = () => {
    if (!db) return null;
    return collection(db, 'transactions');
}

// Helper to convert Firestore Timestamps
export const mapDocToInventoryItem = (doc: any): InventoryItem => {
    const data = doc.data();
    return {
        id: doc.id,
        ...data,
        price: parseFloat(data.price) || 0,
        cost: parseFloat(data.cost) || 0,
        quantity: parseFloat(data.quantity) || 0,
        minStockLevel: parseFloat(data.minStockLevel) || 0,
        createdAt: (data.createdAt as Timestamp)?.toDate ? (data.createdAt as Timestamp).toDate().toISOString() : data.createdAt,
        updatedAt: (data.updatedAt as Timestamp)?.toDate ? (data.updatedAt as Timestamp).toDate().toISOString() : data.updatedAt,
        stock: data.stock || {},
        costHistory: data.costHistory || [],
    } as InventoryItem;
}

// --- Inventory Items ---
export function subscribeToInventoryItems(
  onUpdate: (items: InventoryItem[]) => void,
  onError: (error: Error) => void
) {
  const inventoryCollection = getInventoryCollection();
  if (!inventoryCollection) {
    onError(new Error('Firebase not configured.'));
    return () => {};
  }
  const q = query(inventoryCollection, orderBy('name'));
  return onSnapshot(q, (snapshot) => {
    onUpdate(snapshot.docs.map(mapDocToInventoryItem));
  }, (error) => onError(error as Error));
}

export async function addInventoryItem(item: Omit<InventoryItem, 'id'>): Promise<string> {
  const inventoryCollection = getInventoryCollection();
  if (!inventoryCollection) throw new Error('Firebase is not configured.');
  const now = serverTimestamp();
  
  const docData = {
    ...item,
    imageUrl: item.imageUrl || null,
    createdAt: now,
    updatedAt: now,
  };

  const docRef = await addDoc(inventoryCollection, docData);
  return docRef.id;
}

export async function updateInventoryItem(id: string, data: Partial<Omit<InventoryItem, 'id'>>): Promise<void> {
  if (!db) throw new Error('Firebase is not configured.');
  try {
    const docRef = doc(db, "inventory", id);
    
    const updateData: Record<string, any> = {
        updatedAt: serverTimestamp()
    };
    
    Object.keys(data).forEach(key => {
        const typedKey = key as keyof typeof data;
        if (data[typedKey] !== undefined) {
            updateData[key] = data[typedKey];
        }
    });

    if (updateData.price !== undefined) updateData.price = Number(updateData.price) || 0;
    if (updateData.cost !== undefined) updateData.cost = Number(updateData.cost) || 0;
    if (updateData.minStockLevel !== undefined) updateData.minStockLevel = Number(updateData.minStockLevel) || 0;
    if (updateData.wholesalePrice !== undefined) updateData.wholesalePrice = Number(updateData.wholesalePrice) || 0;

    await updateDoc(docRef, updateData);
  } catch (error) {
    console.error("Error updating inventory item:", error);
    throw new Error("Failed to update inventory item");
  }
}

export async function batchUpdateInventoryPrices(updates: { id: string; price: number; wholesalePrice: number; cost: number; }[]): Promise<void> {
  if (!db) throw new Error("Firebase not configured.");
  
  const batch = writeBatch(db);
  
  updates.forEach(update => {
    const docRef = doc(db, "inventory", update.id);
    batch.update(docRef, { 
      price: update.price, 
      wholesalePrice: update.wholesalePrice,
      cost: update.cost,
      updatedAt: serverTimestamp()
    });
  });

  await batch.commit();
}


export async function deleteInventoryItem(id: string): Promise<void> {
  if (!db) throw new Error('Firebase is not configured.');
  await deleteDoc(doc(db, 'inventory', id));
}

// --- Inventory Movements ---
export async function recordInventoryMovement(
  itemId: string,
  type: InventoryMovement['type'],
  quantityChange: number,
  notes: string = '',
  reference?: string,
  location?: string
): Promise<void> {
  if (!db) throw new Error('Firebase is not configured.');
  const inventoryMovementsCollection = getInventoryMovementsCollection();
  if (!inventoryMovementsCollection) throw new Error('Firebase not configured');

  await runTransaction(db, async (transaction) => {
    const itemRef = doc(db, 'inventory', itemId);
    const itemSnap = await transaction.get(itemRef);
    
    if (!itemSnap.exists()) {
      throw new Error('Inventory item not found');
    }
    
    const itemData = itemSnap.data();
    const currentStock = itemData.stock || {};
    const defaultLocation = location || itemData.location || 'default';
    
    const locationQty = currentStock[defaultLocation] || 0;
    const newLocationQty = locationQty + quantityChange;

    currentStock[defaultLocation] = newLocationQty;

    const totalQuantity = Object.values(currentStock).reduce((sum: number, qty: any) => sum + (Number(qty) || 0), 0);
    
    transaction.update(itemRef, { stock: currentStock, quantity: totalQuantity, updatedAt: serverTimestamp() });
    
    const movementRef = doc(inventoryMovementsCollection);
    transaction.set(movementRef, {
      itemId,
      type,
      quantity: quantityChange,
      date: serverTimestamp(),
      reference: reference || `ADJ-${Date.now()}`,
      notes,
      location: defaultLocation,
    });
  });
}

export async function updateStockAdjustment(adjustmentId: string, newQuantity: number, newNotes: string): Promise<void> {
    const inventoryMovementsCollection = getInventoryMovementsCollection();
    if (!db || !inventoryMovementsCollection) throw new Error("Firebase not configured.");
    
    const adjustmentRef = doc(inventoryMovementsCollection, adjustmentId);

    await runTransaction(db, async (transaction) => {
        const adjSnap = await transaction.get(adjustmentRef);
        if (!adjSnap.exists()) throw new Error("Adjustment record not found.");
        
        const oldAdjustment = adjSnap.data() as InventoryMovement;
        const { itemId, location, quantity: oldQuantity } = oldAdjustment;
        
        const itemRef = doc(db, 'inventory', itemId);
        const itemSnap = await transaction.get(itemRef);
        if (!itemSnap.exists()) throw new Error("Inventory item not found.");
        
        const itemData = itemSnap.data();
        const currentStock = itemData.stock || {};
        const defaultLocation = location || 'default';
        const locationQty = currentStock[defaultLocation] || 0;
        
        const newLocationQty = locationQty - oldQuantity + newQuantity;
        currentStock[defaultLocation] = newLocationQty;
        const totalQuantity = Object.values(currentStock).reduce((sum: number, qty: any) => sum + (Number(qty) || 0), 0);

        transaction.update(itemRef, { stock: currentStock, quantity: totalQuantity, updatedAt: serverTimestamp() });
        transaction.update(adjustmentRef, { quantity: newQuantity, notes: newNotes, date: serverTimestamp() });
    });
}

export async function deleteStockAdjustment(adjustmentId: string): Promise<void> {
    const inventoryMovementsCollection = getInventoryMovementsCollection();
    if (!db || !inventoryMovementsCollection) throw new Error("Firebase not configured.");

    const adjustmentRef = doc(inventoryMovementsCollection, adjustmentId);

    await runTransaction(db, async (transaction) => {
        const adjSnap = await transaction.get(adjustmentRef);
        if (!adjSnap.exists()) throw new Error("Adjustment record not found.");

        const { itemId, location, quantity } = adjSnap.data() as InventoryMovement;

        const itemRef = doc(db, 'inventory', itemId);
        const itemSnap = await transaction.get(itemRef);

        if (itemSnap.exists()) {
            const itemData = itemSnap.data();
            const currentStock = itemData.stock || {};
            const defaultLocation = location || 'default';
            const locationQty = currentStock[defaultLocation] || 0;

            const newLocationQty = locationQty - quantity;
            currentStock[defaultLocation] = newLocationQty;
            const totalQuantity = Object.values(currentStock).reduce((sum: number, qty: any) => sum + (Number(qty) || 0), 0);
            
            transaction.update(itemRef, { stock: currentStock, quantity: totalQuantity, updatedAt: serverTimestamp() });
        }
        
        transaction.delete(adjustmentRef);
    });
}

export const getInventoryEffect = (type: Transaction['type']): 'in' | 'out' | null => {
    if (['purchase', 'credit_purchase', 'sale_return'].includes(type)) return 'in';
    if (['sale', 'credit_sale', 'purchase_return'].includes(type)) return 'out';
    return null;
}

export async function recalculateStockForItem(itemId: string): Promise<void> {
  if (!db) throw new Error('Firebase is not configured.');

  // Fetch data
  const [txSnap, movSnap] = await Promise.all([
      getDocs(collection(db, 'transactions')),
      getDocs(query(collection(db, 'inventoryMovements'), where('itemId', '==', itemId)))
  ]);
  
  const stockByLocation: { [location: string]: number } = {};

  // Process Transactions
  txSnap.docs.forEach(doc => {
    const tx = doc.data() as Transaction;
    if (!tx.enabled || !tx.items) return;
    if (tx.status === 'cancelled') return;

    tx.items.forEach(item => {
      if (item.id === itemId) {
        const loc = item.location || 'default';
        if (!stockByLocation[loc]) stockByLocation[loc] = 0;
        
        const effect = getInventoryEffect(tx.type);
        if (effect === 'in') stockByLocation[loc] += Number(item.quantity) || 0;
        else if (effect === 'out') stockByLocation[loc] -= Number(item.quantity) || 0;
      }
    });
  });

  // Process Adjustments
  movSnap.docs.forEach(doc => {
    const mov = doc.data() as InventoryMovement;
    const loc = mov.location || 'default';
    if (!stockByLocation[loc]) stockByLocation[loc] = 0;
    stockByLocation[loc] += (Number(mov.quantity) || 0);
  });

  const totalQuantity = Object.values(stockByLocation).reduce((sum, q) => sum + q, 0);

  const itemRef = doc(db, 'inventory', itemId);
  await updateDoc(itemRef, {
    stock: stockByLocation,
    quantity: totalQuantity,
    updatedAt: serverTimestamp(),
  });
}

export async function recalculateAllStocks(): Promise<{ updatedItems: number }> {
    if (!db) throw new Error("Firebase not configured.");
    
    // Fetch everything once to be efficient
    const [itemsSnap, txSnap, movSnap] = await Promise.all([
        getDocs(collection(db, 'inventory')),
        getDocs(collection(db, 'transactions')),
        getDocs(collection(db, 'inventoryMovements'))
    ]);

    const batch = writeBatch(db);
    let updatedCount = 0;

    itemsSnap.docs.forEach(itemDoc => {
        const itemId = itemDoc.id;
        const stockByLocation: { [location: string]: number } = {};

        // Transactions pass
        txSnap.docs.forEach(tDoc => {
            const tx = tDoc.data() as Transaction;
            if (!tx.enabled || !tx.items) return;
            if (tx.status === 'cancelled') return;

            tx.items.forEach(it => {
                if (it.id === itemId) {
                    const loc = it.location || 'default';
                    if (!stockByLocation[loc]) stockByLocation[loc] = 0;
                    const effect = getInventoryEffect(tx.type);
                    if (effect === 'in') stockByLocation[loc] += Number(it.quantity) || 0;
                    else if (effect === 'out') stockByLocation[loc] -= Number(it.quantity) || 0;
                }
            });
        });

        // Adjustments pass
        movSnap.docs.forEach(mDoc => {
            const mov = mDoc.data() as InventoryMovement;
            if (mov.itemId === itemId) {
                const loc = mov.location || 'default';
                if (!stockByLocation[loc]) stockByLocation[loc] = 0;
                stockByLocation[loc] += (Number(mov.quantity) || 0);
            }
        });

        const totalQty = Object.values(stockByLocation).reduce((sum, q) => sum + q, 0);

        batch.update(itemDoc.ref, {
            stock: stockByLocation,
            quantity: totalQty,
            updatedAt: serverTimestamp()
        });
        updatedCount++;
    });

    await batch.commit();
    return { updatedItems: updatedCount };
}

export function subscribeToStockAdjustments(
  onUpdate: (movements: InventoryMovement[]) => void,
  onError: (error: Error) => void
) {
  const inventoryMovementsCollection = getInventoryMovementsCollection();
  if (!inventoryMovementsCollection) {
    onError(new Error('Firebase not configured.'));
    return () => {};
  }
  
  const q = query(inventoryMovementsCollection, where('type', 'in', ['adjustment', 'transfer']));
  
  return onSnapshot(q, (snapshot) => {
    const movements = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        date: (data.date as Timestamp)?.toDate ? (data.date as Timestamp).toDate().toISOString() : data.date,
      } as InventoryMovement;
    });
    movements.sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    onUpdate(movements);
  }, onError as any);
}

// --- Categories ---
export function subscribeToInventoryCategories(
  onUpdate: (categories: InventoryCategory[]) => void,
  onError: (error: Error) => void
) {
  const inventoryCategoriesCollection = getInventoryCategoriesCollection();
  if (!inventoryCategoriesCollection) {
    onError(new Error('Firebase not configured.'));
    return () => {};
  }
  const q = query(inventoryCategoriesCollection, orderBy('name'));
  return onSnapshot(q, (snapshot) => {
    onUpdate(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as InventoryCategory)));
  }, (error) => onError(error as Error));
}

export async function addInventoryCategory(category: Omit<InventoryCategory, 'id'>): Promise<string> {
    const inventoryCategoriesCollection = getInventoryCategoriesCollection();
    if(!inventoryCategoriesCollection) throw new Error('Firebase not configured');
    const docRef = await addDoc(inventoryCategoriesCollection, category);
    return docRef.id;
}

export async function deleteInventoryCategory(id: string): Promise<void> {
  if (!db) throw new Error('Firebase is not configured.');
  await deleteDoc(doc(db, 'inventoryCategories', id));
}


// --- CSV Import ---
export async function importInventoryFromCSV(data: any[]): Promise<void> {
  const inventoryCollection = getInventoryCollection();
  const movementsCollection = getInventoryMovementsCollection();
  if (!db || !inventoryCollection || !movementsCollection) throw new Error("Firebase not configured.");

  const batch = writeBatch(db);

  const existingItemsSnap = await getDocs(inventoryCollection);
  existingItemsSnap.forEach(doc => batch.delete(doc.ref));

  data.forEach(row => {
    const newItemRef = doc(inventoryCollection);
    const itemId = newItemRef.id;
    
    const initialQty = Number(row.quantity) || 0;
    const location = row.location || 'default';

    const stockMap = {
        [location]: initialQty
    };

    const newItem: any = {
      name: row.name || 'Unnamed Item',
      sku: row.sku || `SKU-${Date.now()}-${Math.random()}`,
      category: row.category || 'Uncategorized',
      price: parseFloat(row.price) || 0,
      cost: parseFloat(row.cost) || 0,
      quantity: initialQty,
      stock: stockMap,
      minStockLevel: parseInt(row.minStockLevel) || 0,
      brand: row.brand || '',
      description: row.description || '',
      location: location,
      barcode: row.barcode || '',
      supplier: row.supplier || '',
      wholesalePrice: parseFloat(row.wholesalePrice) || 0,
      imageUrl: row.imageUrl || '',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    batch.set(newItemRef, newItem);

    if (initialQty !== 0) {
        const moveRef = doc(movementsCollection);
        batch.set(moveRef, {
            itemId: itemId,
            type: 'adjustment',
            quantity: initialQty,
            date: serverTimestamp(),
            reference: 'CSV-IMPORT',
            notes: 'Initial Import',
            location: location
        });
    }
  });

  await batch.commit();
}