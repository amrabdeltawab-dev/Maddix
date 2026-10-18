import { index, int, mysqlEnum, mysqlTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 128 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }).unique(),
  username: varchar("username", { length: 80 }).unique(),
  passwordHash: varchar("passwordHash", { length: 128 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  active: int("active").default(1).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export const materials = mysqlTable("materials", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 160 }).notNull(),
  normalizedName: varchar("normalizedName", { length: 160 }).notNull(),
  unit: varchar("unit", { length: 40 }).notNull(),
  description: text("description"),
  category: varchar("category", { length: 80 }).notNull().default("مواد أخرى"),
  allowDecimal: int("allowDecimal").default(0).notNull(),
  packagingType: mysqlEnum("packagingType", ["CARTON", "BAG", "JERRY_CAN"]).default("CARTON").notNull(),
  active: int("active").default(1).notNull(),
  createdBy: int("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => ({
  materialNameIdx: uniqueIndex("materials_name_unit_idx").on(table.normalizedName, table.unit),
  activeIdx: index("materials_active_idx").on(table.active),
}));

export const orders = mysqlTable("orders", {
  id: int("id").autoincrement().primaryKey(),
  orderNumber: varchar("orderNumber", { length: 32 }).notNull().unique(),
  userId: int("userId").notNull(),
  userNameSnapshot: varchar("userNameSnapshot", { length: 160 }).notNull(),
  status: mysqlEnum("status", ["NEW", "PROCESSING", "READY", "DELIVERED", "REJECTED"]).default("NEW").notNull(),
  notes: text("notes"),
  totalItems: int("totalItems").default(0).notNull(),
  idempotencyKey: varchar("idempotencyKey", { length: 96 }).notNull().unique(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastStatusChangedAt: timestamp("lastStatusChangedAt"),
  lastStatusChangedBy: int("lastStatusChangedBy"),
}, table => ({
  userIdx: index("orders_user_idx").on(table.userId, table.createdAt),
  statusIdx: index("orders_status_idx").on(table.status, table.createdAt),
}));

export const orderItems = mysqlTable("order_items", {
  id: int("id").autoincrement().primaryKey(),
  orderId: int("orderId").notNull(),
  materialId: int("materialId").notNull(),
  materialNameSnapshot: varchar("materialNameSnapshot", { length: 160 }).notNull(),
  unitSnapshot: varchar("unitSnapshot", { length: 40 }).notNull(),
  quantity: int("quantity").notNull(),
  quantityDecimal: varchar("quantityDecimal", { length: 32 }),
  allowDecimalSnapshot: int("allowDecimalSnapshot").default(0).notNull(),
  packagingTypeSnapshot: mysqlEnum("packagingTypeSnapshot", ["CARTON", "BAG", "JERRY_CAN"]).default("CARTON").notNull(),
  status: mysqlEnum("status", ["PENDING", "PREPARING", "PREPARED"]).default("PENDING").notNull(),
  startedAt: timestamp("startedAt"),
  startedBy: int("startedBy"),
  preparedAt: timestamp("preparedAt"),
  preparedBy: int("preparedBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => ({
  orderIdx: index("order_items_order_idx").on(table.orderId),
}));

export const orderStatusHistory = mysqlTable("order_status_history", {
  id: int("id").autoincrement().primaryKey(),
  orderId: int("orderId").notNull(),
  oldStatus: varchar("oldStatus", { length: 32 }),
  newStatus: varchar("newStatus", { length: 32 }).notNull(),
  changedBy: int("changedBy").notNull(),
  note: text("note"),
  changedAt: timestamp("changedAt").defaultNow().notNull(),
}, table => ({
  orderHistoryIdx: index("order_status_history_order_idx").on(table.orderId, table.changedAt),
}));

export const notifications = mysqlTable("notifications", {
  id: int("id").autoincrement().primaryKey(),
  recipientId: int("recipientId").notNull(),
  type: varchar("type", { length: 48 }).notNull(),
  title: varchar("title", { length: 200 }).notNull(),
  body: text("body").notNull(),
  orderId: int("orderId"),
  read: int("read").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => ({
  recipientIdx: index("notifications_recipient_idx").on(table.recipientId, table.createdAt),
}));

export const adminLogs = mysqlTable("admin_logs", {
  id: int("id").autoincrement().primaryKey(),
  adminId: int("adminId").notNull(),
  action: varchar("action", { length: 96 }).notNull(),
  targetType: varchar("targetType", { length: 48 }).notNull(),
  targetId: varchar("targetId", { length: 96 }).notNull(),
  metadata: text("metadata"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => ({
  adminLogIdx: index("admin_logs_admin_idx").on(table.adminId, table.createdAt),
}));

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type Material = typeof materials.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type OrderItem = typeof orderItems.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
