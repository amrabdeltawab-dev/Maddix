import { and, asc, count, desc, eq, inArray, like, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { InsertUser, Material, User, adminLogs, materials, notifications, orderItems, orderStatusHistory, orders, users } from "../drizzle/schema";

let _db: ReturnType<typeof drizzle> | null = null;
let seedPromise: Promise<void> | null = null;

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

const PASSWORD_HASH_PREFIX = "scrypt$";

export function hashPassword(password: string) {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 32);
  return `${PASSWORD_HASH_PREFIX}${salt.toString("hex")}$${derived.toString("hex")}`;
}

export function verifyPassword(password: string, passwordHash: string | null) {
  if (!passwordHash) return false;
  if (!passwordHash.startsWith(PASSWORD_HASH_PREFIX)) {
    const legacy = createHash("sha256").update(`maddix:${password}`).digest("hex");
    const stored = Buffer.from(passwordHash);
    const expected = Buffer.from(legacy);
    return stored.length === expected.length && timingSafeEqual(expected, stored);
  }
  const [, saltHex, expectedHex] = passwordHash.split("$");
  if (!saltHex || !expectedHex || expectedHex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(saltHex) || !/^[0-9a-f]+$/i.test(expectedHex)) return false;
  const actual = scryptSync(password, Buffer.from(saltHex, "hex"), expectedHex.length / 2);
  return actual.length === expectedHex.length / 2 && timingSafeEqual(actual, Buffer.from(expectedHex, "hex"));
}

function isModernPasswordHash(passwordHash: string | null): boolean {
  return Boolean(passwordHash?.startsWith(PASSWORD_HASH_PREFIX));
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) return;
  const values: InsertUser = { openId: user.openId, name: user.name ?? null, email: user.email ?? null, loginMethod: user.loginMethod ?? null, role: user.role ?? "user", lastSignedIn: new Date() };
  const updateSet: Record<string, unknown> = { lastSignedIn: new Date() };
  if (user.name !== undefined) updateSet.name = user.name;
  if (user.email !== undefined) updateSet.email = user.email;
  if (user.loginMethod !== undefined) updateSet.loginMethod = user.loginMethod;
  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result[0];
}

export async function getUserById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return result[0];
}

export async function getUserByEmail(email: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.email, email.toLowerCase())).limit(1);
  return result[0];
}

export async function listUsers() {
  const db = await getDb();
  if (!db) return [];
  return db.select({ id: users.id, name: users.name, email: users.email, username: users.username, role: users.role, active: users.active, createdAt: users.createdAt, lastSignedIn: users.lastSignedIn }).from(users).orderBy(desc(users.createdAt));
}

export async function setUserActive(userId: number, active: boolean, adminId: number) {
  const db = await getDb();
  if (!db) throw new Error("DATABASE_UNAVAILABLE");
  if (userId === adminId) throw new Error("CANNOT_DEACTIVATE_SELF");
  await db.update(users).set({ active: active ? 1 : 0 }).where(and(eq(users.id, userId), eq(users.role, "user")));
  return { success: true } as const;
}

export async function deleteUser(userId: number, adminId: number) {
  const db = await getDb();
  if (!db) throw new Error("DATABASE_UNAVAILABLE");
  if (userId === adminId) throw new Error("CANNOT_DELETE_SELF");
  await db.delete(users).where(and(eq(users.id, userId), eq(users.role, "user")));
  return { success: true } as const;
}

export async function getOrCreateLocalUser(input: { name: string; email: string; password: string }) {
  const db = await getDb();
  if (!db) throw new Error("DATABASE_UNAVAILABLE");
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim().slice(0, 160);
  const existing = await getUserByEmail(email);
  if (existing) {
    if (existing.role === "admin") throw new Error("ADMIN_LOGIN_REQUIRED");
    if (!existing.active) throw new Error("USER_INACTIVE");
    if (!verifyPassword(input.password, existing.passwordHash)) throw new Error("INVALID_CREDENTIALS");
    const lastSignedIn = new Date();
    await db.update(users).set({ lastSignedIn, ...(isModernPasswordHash(existing.passwordHash) ? {} : { passwordHash: hashPassword(input.password) }) }).where(eq(users.id, existing.id));
    return { ...existing, lastSignedIn };
  }
  const [created] = await db.insert(users).values({ openId: `local-user-${randomUUID()}`, name, email, username: `user-${randomUUID().slice(0, 12)}`, passwordHash: hashPassword(input.password), role: "user", active: 1, loginMethod: "password" }).$returningId();
  return getUserById(Number(created.id));
}

async function seedMaddix() {
  const db = await getDb();
  if (!db) return;
  const admin = await getUserByEmail("abdo@gmail.com");
  if (!admin) {
    await db.insert(users).values({ openId: "local-admin-abdo", name: "عبدالله", email: "abdo@gmail.com", username: "admin", passwordHash: hashPassword("abdo"), role: "admin", active: 1, loginMethod: "password" });
  }
  const user = await getUserByEmail("ahmed@glassbyfarm.local");
  if (!user) {
    await db.insert(users).values({ openId: "local-user-ahmed", name: "أحمد", email: "ahmed@glassbyfarm.local", username: "ahmed", passwordHash: hashPassword("user1234"), role: "user", active: 1, loginMethod: "password" });
  }
  const chocolateMaterials = [
    { name: "لبن منزوع الدسم", normalizedName: "لبن منزوع الدسم", unit: "وحدة", category: "خامات الشوكولاتة", description: null, allowDecimal: 0, packagingType: "BAG" as const, active: 1 },
    { name: "لبن كامل الدسم", normalizedName: "لبن كامل الدسم", unit: "وحدة", category: "خامات الشوكولاتة", description: null, allowDecimal: 0, packagingType: "BAG" as const, active: 1 },
    { name: "سكر", normalizedName: "سكر", unit: "وحدة", category: "خامات الشوكولاتة", description: null, allowDecimal: 0, packagingType: "BAG" as const, active: 1 },
    { name: "زيت", normalizedName: "زيت", unit: "وحدة", category: "خامات الشوكولاتة", description: null, allowDecimal: 0, packagingType: "JERRY_CAN" as const, active: 1 },
    { name: "كاكاو", normalizedName: "كاكاو", unit: "وحدة", category: "خامات الشوكولاتة", description: null, allowDecimal: 0, packagingType: "BAG" as const, active: 1 },
    { name: "زبدة كاكاو", normalizedName: "زبدة كاكاو", unit: "وحدة", category: "خامات الشوكولاتة", description: null, allowDecimal: 0, packagingType: "CARTON" as const, active: 1 },
    { name: "فانيليا", normalizedName: "فانيليا", unit: "وحدة", category: "خامات الشوكولاتة", description: null, allowDecimal: 0, packagingType: "CARTON" as const, active: 1 },
    { name: "مكسرات", normalizedName: "مكسرات", unit: "وحدة", category: "خامات الشوكولاتة", description: null, allowDecimal: 0, packagingType: "BAG" as const, active: 1 },
  ];
  const existingMaterials = await db.select({ id: materials.id, name: materials.name, category: materials.category }).from(materials);
  const chocolateNames = new Set(chocolateMaterials.map(material => material.name));
  for (const row of existingMaterials) {
    if (!chocolateNames.has(row.name) && row.category !== "خامات الشوكولاتة") await db.update(materials).set({ active: 0 }).where(eq(materials.id, row.id));
  }
  for (const material of chocolateMaterials) {
    const existing = await db.select({ id: materials.id }).from(materials).where(eq(materials.normalizedName, material.normalizedName)).limit(1);
    if (existing.length) {
      await db.update(materials).set({ unit: "وحدة", category: "خامات الشوكولاتة", description: null, allowDecimal: 0, packagingType: material.packagingType, active: 1 }).where(eq(materials.id, existing[0].id));
    } else {
      await db.insert(materials).values(material);
    }
  }
}

export async function listMaterials(search?: string, includeInactive = false) {
  const db = await getDb();
  if (!db) return [];
  const filters = [];
  if (!includeInactive) filters.push(eq(materials.active, 1));
  if (search?.trim()) {
    const q = `%${search.trim()}%`;
    filters.push(like(materials.name, q));
  }
  return db.select().from(materials).where(filters.length ? and(...filters) : undefined).orderBy(asc(materials.id));
}

export async function createMaterial(input: { name: string; packagingType: "CARTON" | "BAG" | "JERRY_CAN"; createdBy: number }) {
  const db = await getDb();
  if (!db) throw new Error("DATABASE_UNAVAILABLE");
  const name = input.name.trim();
  if (!name) throw new Error("INVALID_MATERIAL");
  const [created] = await db.insert(materials).values({ name, normalizedName: name.toLocaleLowerCase("ar-EG"), unit: "وحدة", category: "خامات الشوكولاتة", description: null, allowDecimal: 0, packagingType: input.packagingType, active: 1, createdBy: input.createdBy }).$returningId();
  const [row] = await db.select().from(materials).where(eq(materials.id, Number(created.id))).limit(1);
  return row;
}

export async function updateMaterial(input: { id: number; name: string; packagingType: "CARTON" | "BAG" | "JERRY_CAN" }) {
  const db = await getDb();
  if (!db) throw new Error("DATABASE_UNAVAILABLE");
  const name = input.name.trim();
  if (!name) throw new Error("INVALID_MATERIAL");
  await db.update(materials).set({ name, normalizedName: name.toLocaleLowerCase("ar-EG"), unit: "وحدة", category: "خامات الشوكولاتة", description: null, allowDecimal: 0, packagingType: input.packagingType }).where(eq(materials.id, input.id));
  const [row] = await db.select().from(materials).where(eq(materials.id, input.id)).limit(1);
  return row;
}

export async function deleteMaterial(id: number) {
  const db = await getDb();
  if (!db) throw new Error("DATABASE_UNAVAILABLE");
  await db.update(materials).set({ active: 0 }).where(eq(materials.id, id));
  return { success: true } as const;
}

export async function listOrders(userId?: number, status?: string) {
  const db = await getDb();
  if (!db) return [];
  const filters = [];
  if (userId) filters.push(eq(orders.userId, userId));
  if (status && status !== "ALL") filters.push(eq(orders.status, status as any));
  const rows = await db.select().from(orders).where(filters.length ? and(...filters) : undefined).orderBy(desc(orders.createdAt));
  if (!rows.length) return rows.map(row => ({ ...row, packagingKinds: ["default"] as const }));
  const owners = await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, rows.map(row => row.userId)));
  const ownerNames = new Map(owners.map(owner => [owner.id, owner.name]));
  const items = await db.select({ orderId: orderItems.orderId, packagingType: orderItems.packagingTypeSnapshot }).from(orderItems).where(inArray(orderItems.orderId, rows.map(row => row.id)));
  const byOrder = new Map<number, Set<string>>();
  for (const item of items) {
    const kind = item.packagingType === "BAG" ? "sack" : item.packagingType === "JERRY_CAN" ? "jerrycan" : item.packagingType === "CARTON" ? "carton" : "default";
    if (!byOrder.has(item.orderId)) byOrder.set(item.orderId, new Set());
    byOrder.get(item.orderId)!.add(kind);
  }
  return rows.map(row => ({ ...row, userNameSnapshot: ownerNames.get(row.userId) || row.userNameSnapshot, packagingKinds: Array.from(byOrder.get(row.id) || new Set(["default"])) }));
}

export async function getOrderDetails(orderId: number) {
  const db = await getDb();
  if (!db) return null;
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!order) return null;
  const [owner] = await db.select({ name: users.name }).from(users).where(eq(users.id, order.userId)).limit(1);
  const canonicalOrder = { ...order, userNameSnapshot: owner?.name || order.userNameSnapshot };
  const items = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId)).orderBy(asc(orderItems.id));
  const history = await db.select().from(orderStatusHistory).where(eq(orderStatusHistory.orderId, orderId)).orderBy(asc(orderStatusHistory.changedAt));
  return { order: canonicalOrder, items, history };
}

export function ensureMaddixSeed() {
  if (!seedPromise) {
    seedPromise = seedMaddix().catch(error => {
      seedPromise = null;
      throw error;
    });
  }
  return seedPromise;
}

export async function createOrder(input: { userId: number; notes?: string; idempotencyKey?: string; items: Array<{ materialId: number; quantity: number }> }) {
  const db = await getDb();
  if (!db) throw new Error("DATABASE_UNAVAILABLE");
  const idempotencyKey = input.idempotencyKey || randomUUID();
  return db.transaction(async tx => {
    const [existingOrder] = await tx.select({ orderId: orders.id, orderNumber: orders.orderNumber }).from(orders).where(and(eq(orders.idempotencyKey, idempotencyKey), eq(orders.userId, input.userId))).limit(1);
    if (existingOrder) return existingOrder;
    const [owner] = await tx.select({ id: users.id, name: users.name }).from(users).where(and(eq(users.id, input.userId), eq(users.active, 1))).limit(1);
    if (!owner) throw new Error("USER_NOT_FOUND");
    const ownerName = owner.name?.trim() || "مستخدم Maddix";
    const ids = input.items.map(item => item.materialId);
    if (new Set(ids).size !== ids.length) throw new Error("DUPLICATE_ORDER_ITEM");
    const materialRows = await tx.select().from(materials).where(and(inArray(materials.id, ids), eq(materials.active, 1)));
    if (materialRows.length !== ids.length) throw new Error("INVALID_MATERIAL");
    const materialMap = new Map(materialRows.map(row => [row.id, row]));
    for (const item of input.items) {
      const material = materialMap.get(item.materialId);
      if (!material || !Number.isFinite(item.quantity) || item.quantity <= 0 || (!material.allowDecimal && !Number.isInteger(item.quantity))) throw new Error("INVALID_QUANTITY");
    }
    const orderNumber = `ORD-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 8).toUpperCase()}`;
    const [inserted] = await tx.insert(orders).values({ orderNumber, userId: input.userId, userNameSnapshot: ownerName, status: "NEW", notes: input.notes?.trim() || null, totalItems: input.items.length, idempotencyKey, lastStatusChangedAt: new Date(), lastStatusChangedBy: input.userId }).$returningId();
    const orderId = Number(inserted.id);
    await tx.insert(orderItems).values(input.items.map(item => {
      const material = materialMap.get(item.materialId)!;
      const asText = String(item.quantity);
      return { orderId, materialId: material.id, materialNameSnapshot: material.name, unitSnapshot: material.unit, quantity: Math.round(item.quantity), quantityDecimal: asText, allowDecimalSnapshot: material.allowDecimal, packagingTypeSnapshot: material.packagingType, status: "PENDING" as const };
    }));
    await tx.insert(orderStatusHistory).values({ orderId, oldStatus: null, newStatus: "NEW", changedBy: input.userId, note: "تم إنشاء الطلب" });
    const admins = await tx.select({ id: users.id }).from(users).where(and(eq(users.role, "admin"), eq(users.active, 1)));
    if (admins.length) await tx.insert(notifications).values(admins.map(admin => ({ recipientId: admin.id, type: "NEW_ORDER", title: "طلب جديد", body: `${ownerName} أرسل طلب خامات جديد رقم ${orderNumber}.`, orderId, read: 0 })));
    return { orderId, orderNumber };
  });
}

export const orderStatusTransitions: Record<string, string[]> = { NEW: ["PROCESSING", "REJECTED"], PROCESSING: ["READY", "REJECTED"], READY: ["DELIVERED"], DELIVERED: [], REJECTED: [] };

export function canTransitionOrderStatus(current: string, next: string) {
  return current === next || Boolean(orderStatusTransitions[current]?.includes(next));
}

export async function updateOrderStatus(orderId: number, status: "NEW" | "PROCESSING" | "READY" | "DELIVERED" | "REJECTED", adminId: number) {
  const db = await getDb();
  if (!db) throw new Error("DATABASE_UNAVAILABLE");
  return db.transaction(async tx => {
    const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).limit(1);
    if (!order) throw new Error("ORDER_NOT_FOUND");
    const [owner] = await tx.select({ name: users.name }).from(users).where(eq(users.id, order.userId)).limit(1);
    const ownerName = owner?.name?.trim() || order.userNameSnapshot;
    if (!canTransitionOrderStatus(order.status, status)) throw new Error("INVALID_STATUS_TRANSITION");
    if (status === "READY") {
      const items = await tx.select({ status: orderItems.status }).from(orderItems).where(eq(orderItems.orderId, orderId));
      if (!items.length || items.some(item => item.status !== "PREPARED")) throw new Error("ITEMS_NOT_PREPARED");
    }
    const now = new Date();
    await tx.update(orders).set({ status, updatedAt: now, lastStatusChangedAt: now, lastStatusChangedBy: adminId }).where(eq(orders.id, orderId));
    await tx.insert(orderStatusHistory).values({ orderId, oldStatus: order.status, newStatus: status, changedBy: adminId });
    await tx.insert(adminLogs).values({ adminId, action: "CHANGE_ORDER_STATUS", targetType: "ORDER", targetId: String(orderId), metadata: JSON.stringify({ oldStatus: order.status, newStatus: status }) });
    if (status === "DELIVERED") {
      const existingCompletion = await tx.select({ id: notifications.id }).from(notifications).where(and(eq(notifications.recipientId, order.userId), eq(notifications.orderId, orderId), eq(notifications.type, "ORDER_COMPLETED"))).limit(1);
      if (!existingCompletion.length) await tx.insert(notifications).values({ recipientId: order.userId, type: "ORDER_COMPLETED", title: "تم التسليم", body: `تم تسليم طلب ${ownerName} رقم ${order.orderNumber} بنجاح.`, orderId, read: 0 });
    }
    return { success: true };
  });
}

export async function updateOrderItemPreparation(itemId: number, status: "PREPARING" | "PREPARED", adminId: number) {
  const db = await getDb();
  if (!db) throw new Error("DATABASE_UNAVAILABLE");
  return db.transaction(async tx => {
    const [item] = await tx.select().from(orderItems).where(eq(orderItems.id, itemId)).limit(1);
    if (!item) throw new Error("ORDER_ITEM_NOT_FOUND");
    if (item.status === status || (item.status === "PREPARED" && status === "PREPARING")) return { success: true, orderId: item.orderId, status: item.status } as const;
    if (status === "PREPARING" && item.status !== "PENDING") throw new Error("INVALID_ITEM_STATUS_TRANSITION");
    if (status === "PREPARED" && item.status !== "PREPARING") throw new Error("INVALID_ITEM_STATUS_TRANSITION");
    const now = new Date();
    await tx.update(orderItems).set(status === "PREPARING" ? { status, startedAt: now, startedBy: adminId } : { status, preparedAt: now, preparedBy: adminId }).where(eq(orderItems.id, itemId));
    return { success: true, orderId: item.orderId, status } as const;
  });
}

export async function getStats(userId?: number) {
  const db = await getDb();
  if (!db) return { total: 0, new: 0, processing: 0, ready: 0, delivered: 0, rejected: 0, users: 0, materials: 0 };
  const filters = userId ? eq(orders.userId, userId) : undefined;
  const rows = await db.select({ status: orders.status, total: count() }).from(orders).where(filters).groupBy(orders.status);
  const result = { total: 0, new: 0, processing: 0, ready: 0, delivered: 0, rejected: 0, users: 0, materials: 0 };
  for (const row of rows) {
    const value = Number(row.total);
    result.total += value;
    if (row.status === "NEW") result.new = value;
    if (row.status === "PROCESSING") result.processing = value;
    if (row.status === "READY") result.ready = value;
    if (row.status === "DELIVERED") result.delivered = value;
    if (row.status === "REJECTED") result.rejected = value;
  }
  const [m] = await db.select({ total: count() }).from(materials).where(eq(materials.active, 1));
  result.materials = Number(m?.total ?? 0);
  if (!userId) {
    const [u] = await db.select({ total: count() }).from(users).where(eq(users.active, 1));
    result.users = Number(u?.total ?? 0);
  }
  return result;
}

export async function listNotifications(recipientId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select({ id: notifications.id, recipientId: notifications.recipientId, type: notifications.type, title: notifications.title, body: notifications.body, orderId: notifications.orderId, orderNumber: orders.orderNumber, requesterName: users.name, read: notifications.read, createdAt: notifications.createdAt }).from(notifications).leftJoin(orders, eq(notifications.orderId, orders.id)).leftJoin(users, eq(orders.userId, users.id)).where(eq(notifications.recipientId, recipientId)).orderBy(desc(notifications.createdAt)).limit(30);
}

export async function deleteNotification(id: number, recipientId: number) {
  const db = await getDb();
  if (!db) throw new Error("DATABASE_UNAVAILABLE");
  await db.delete(notifications).where(and(eq(notifications.id, id), eq(notifications.recipientId, recipientId)));
  return { success: true } as const;
}

export async function markNotificationRead(id: number, recipientId: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(notifications).set({ read: 1 }).where(and(eq(notifications.id, id), eq(notifications.recipientId, recipientId)));
}

export async function deletePreparedOrder(orderId: number, adminId: number) {
  const db = await getDb();
  if (!db) throw new Error("DATABASE_UNAVAILABLE");
  return db.transaction(async tx => {
    const [order] = await tx.select({ id: orders.id, status: orders.status }).from(orders).where(eq(orders.id, orderId)).limit(1);
    if (!order) throw new Error("ORDER_NOT_FOUND");
    if (order.status !== "READY" && order.status !== "DELIVERED") throw new Error("ONLY_PREPARED_ORDERS_CAN_BE_DELETED");
    await tx.delete(notifications).where(eq(notifications.orderId, orderId));
    await tx.delete(orderStatusHistory).where(eq(orderStatusHistory.orderId, orderId));
    await tx.delete(orderItems).where(eq(orderItems.orderId, orderId));
    await tx.delete(orders).where(eq(orders.id, orderId));
    await tx.insert(adminLogs).values({ adminId, action: "DELETE_PREPARED_ORDER", targetType: "ORDER", targetId: String(orderId), metadata: JSON.stringify({ status: order.status }) });
    return { success: true, orderId } as const;
  });
}

export async function resetAllOrders() {
  const db = await getDb();
  if (!db) throw new Error("DATABASE_UNAVAILABLE");
  return db.transaction(async tx => {
    const existing = await tx.select({ id: orders.id }).from(orders);
    const orderIds = existing.map(order => order.id);
    await tx.delete(notifications);
    if (!orderIds.length) return { success: true, deletedCount: 0 } as const;
    await tx.delete(orderStatusHistory).where(inArray(orderStatusHistory.orderId, orderIds));
    await tx.delete(orderItems).where(inArray(orderItems.orderId, orderIds));
    await tx.delete(orders).where(inArray(orders.id, orderIds));
    console.log(`[Weekly order reset] Deleted ${orderIds.length} orders and related records.`);
    return { success: true, deletedCount: orderIds.length } as const;
  });
}
