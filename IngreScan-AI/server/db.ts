import { eq, desc, and } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { 
  InsertUser, users, 
  userProfiles, InsertUserProfile,
  medicalConditions, InsertMedicalCondition,
  medications, InsertMedication,
  foodScans, InsertFoodScan,
  scanIngredients, InsertScanIngredient,
  alternatives, InsertAlternative,
  chatMessages, InsertChatMessage,
  ingredientDatabase, InsertIngredientData
} from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

// ============= User Management =============

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

// ============= User Profile =============

export async function getUserProfile(userId: number) {
  const db = await getDb();
  if (!db) return null;
  
  const result = await db.select().from(userProfiles).where(eq(userProfiles.userId, userId)).limit(1);
  return result.length > 0 ? result[0] : null;
}

export async function upsertUserProfile(profile: InsertUserProfile) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const existing = await getUserProfile(profile.userId);
  
  if (existing) {
    await db.update(userProfiles)
      .set({ ...profile, updatedAt: new Date() })
      .where(eq(userProfiles.userId, profile.userId));
  } else {
    await db.insert(userProfiles).values(profile);
  }
  
  return getUserProfile(profile.userId);
}

// ============= Medical Conditions =============

export async function getMedicalConditions(userId: number) {
  const db = await getDb();
  if (!db) return [];
  
  return db.select().from(medicalConditions).where(eq(medicalConditions.userId, userId));
}

export async function addMedicalCondition(condition: InsertMedicalCondition) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.insert(medicalConditions).values(condition);
  return result;
}

export async function deleteMedicalCondition(id: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.delete(medicalConditions).where(
    and(eq(medicalConditions.id, id), eq(medicalConditions.userId, userId))
  );
}

// ============= Medications =============

export async function getMedications(userId: number, currentOnly: boolean = false) {
  const db = await getDb();
  if (!db) return [];
  
  const conditions = currentOnly 
    ? and(eq(medications.userId, userId), eq(medications.isCurrent, true))
    : eq(medications.userId, userId);
  
  return db.select().from(medications).where(conditions).orderBy(desc(medications.startDate));
}

export async function addMedication(medication: InsertMedication) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.insert(medications).values(medication);
  return result;
}

export async function updateMedication(id: number, userId: number, updates: Partial<InsertMedication>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(medications)
    .set({ ...updates, updatedAt: new Date() })
    .where(and(eq(medications.id, id), eq(medications.userId, userId)));
}

export async function deleteMedication(id: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.delete(medications).where(
    and(eq(medications.id, id), eq(medications.userId, userId))
  );
}

// ============= Food Scans =============

export async function createFoodScan(scan: InsertFoodScan) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.insert(foodScans).values(scan);
  const result = await db.select().from(foodScans)
    .where(eq(foodScans.userId, scan.userId))
    .orderBy(desc(foodScans.createdAt))
    .limit(1);
  return result[0]?.id;
}

export async function getFoodScan(scanId: number, userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  
  const result = await db.select().from(foodScans).where(
    and(eq(foodScans.id, scanId), eq(foodScans.userId, userId))
  ).limit(1);
  
  return result.length > 0 ? result[0] : undefined;
}

export async function getUserScans(userId: number, limit: number = 50) {
  const db = await getDb();
  if (!db) return [];
  
  return db.select().from(foodScans)
    .where(eq(foodScans.userId, userId))
    .orderBy(desc(foodScans.createdAt))
    .limit(limit);
}

export async function updateFoodScan(scanId: number, userId: number, updates: Partial<InsertFoodScan>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(foodScans)
    .set({ ...updates, updatedAt: new Date() })
    .where(and(eq(foodScans.id, scanId), eq(foodScans.userId, userId)));
}

// ============= Scan Ingredients =============

export async function addScanIngredient(ingredient: InsertScanIngredient) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.insert(scanIngredients).values(ingredient);
  return result;
}

export async function getScanIngredients(scanId: number) {
  const db = await getDb();
  if (!db) return [];
  
  return db.select().from(scanIngredients).where(eq(scanIngredients.scanId, scanId));
}

// ============= Alternatives =============

export async function addAlternative(alternative: InsertAlternative) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.insert(alternatives).values(alternative);
  return result;
}

export async function getAlternatives(scanId: number) {
  const db = await getDb();
  if (!db) return [];
  
  return db.select().from(alternatives).where(eq(alternatives.scanId, scanId));
}

// ============= Chat Messages =============

export async function addChatMessage(message: InsertChatMessage) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.insert(chatMessages).values(message);
  return result;
}

export async function getChatHistory(userId: number, scanId?: number, limit: number = 100) {
  const db = await getDb();
  if (!db) return [];
  
  const conditions = scanId 
    ? and(eq(chatMessages.userId, userId), eq(chatMessages.scanId, scanId))
    : eq(chatMessages.userId, userId);
  
  return db.select().from(chatMessages)
    .where(conditions)
    .orderBy(chatMessages.createdAt)
    .limit(limit);
}

// ============= Ingredient Database =============

export async function getIngredientByName(name: string) {
  const db = await getDb();
  if (!db) return undefined;
  
  const result = await db.select().from(ingredientDatabase)
    .where(eq(ingredientDatabase.name, name))
    .limit(1);
  
  return result.length > 0 ? result[0] : undefined;
}

export async function upsertIngredient(ingredient: InsertIngredientData) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.insert(ingredientDatabase).values(ingredient).onDuplicateKeyUpdate({
    set: {
      ...ingredient,
      lastUpdated: new Date(),
    },
  });
}
